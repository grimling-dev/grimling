import { expect, mock, test } from 'claude-code/testing'
import { envHome, HOME, PROJ, slash } from './paths'
import type { AgentStatus } from 'claude-code'

const PANE = {
  plugin: 'grimling',
  component: 'Pane',
  requestId: 'grimling',
  props: {
    title: 'Grimling',
    isFocused: true,
    bodyColumns: 78,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const AGENT_FILE = [
  '---',
  'name: ops-admin',
  'description: Network administrator and defender. Audits the firewall.',
  'model: sonnet',
  '---',
  'You are the network administrator.',
].join('\n')
const CUSTOM_FILE = [
  '---',
  'name: paper-scout',
  'description: Finds and summarises research papers on a topic.',
  '---',
  'You find papers.',
].join('\n')

type On = Parameters<Parameters<typeof test>[1]>[1]

// What session.usage answers; a test sets it before the session starts.
let usageReading: Record<string, unknown> = {}

// The engine hands file hooks Windows paths; compare them with slashes.

// Lets the first polls and the dex load land, then draws again: the stub
// clock never advances, so the pane is not redrawn on its own.
const settle = async (ui: { redraw: () => Promise<unknown> }) => {
  await new Promise(resolve => setTimeout(resolve, 50))
  await ui.redraw()
}

// Stands in for the engine: a home folder with two agent files, a run log
// that collects writes, and quiet answers for the rest. `clock: false` leaves
// the clock to the test's mock.clock, so polls run only when it advances.
function stubs(
  on: On,
  files: Record<string, string> = {},
  opts: { clock?: boolean; dirs?: Record<string, string[]> } = {},
) {
  const dirs = opts.dirs ?? {}
  const seen = { toasts: [] as string[], status: [] as string[] }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({ value: {} }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(JSON.stringify(e))
    return { value: {} }
  })
  if (opts.clock !== false) {
    on('clock.every', () => ({ value: {} }))
    on('clock.now', () => ({ value: 1_000_000 }))
  }
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.usage', () => ({ value: usageReading }))
  on('ui.status', (_, e) => {
    seen.status.push(String(e.text ?? ''))
    return { value: {} }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', (_, e) =>
    slash(e.path) in dirs
      ? { value: (dirs[slash(e.path)] ?? []).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
      : slash(e.path) === `${HOME}/.claude/agents`
      ? {
          value: [
            { name: 'ops-admin.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
            { name: 'paper-scout.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
          ],
        }
      : { value: [] },
  )
  on('fs.read', (_, e) => {
    const path = slash(e.path)
    if (path in files) return { value: files[path] }
    if (path.endsWith('ops-admin.md')) return { value: AGENT_FILE }
    if (path.endsWith('paper-scout.md')) return { value: CUSTOM_FILE }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    files[slash(e.path)] = String(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slash(e.path) in files }))
  return seen
}

test('/grimling opens the deck', async ($, on) => {
  stubs(on)
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const command of ['grimling']) {
    const out = await $.command.run({ command, args: '' })
    expect(JSON.stringify(out)).toContain('Grimling focused')
  }
})

test('/grimling-tour starts the tour', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  stubs(on, {}, { clock: false })
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const command of ['grimling-tour']) {
    const out = await $.command.run({ command, args: '' })
    expect(JSON.stringify(out)).toContain('Tour started')
  }
})

test('the dex lists built-ins and agent files; Enter on a card then the launch box spawns it', async ($, on) => {
  const spawned: { prompt: string; type?: string }[] = []
  stubs(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', (_, e) => {
    // The harness hands the hook the Agent tool's spelling, subagent_type.
    const raw = e as unknown as { subagent_type?: string }
    spawned.push({ prompt: e.prompt, type: e.subagentType ?? raw.subagent_type })
    return { model: 'test', agentId: 'a1' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)

  expect(await ui.find({ type: 'Button', key: 'card-scout' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'card-agent-ops-admin' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'card-agent-paper-scout' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'tab-flow' })).toBeTruthy()

  await ui.press({ key: 'card-scout' })
  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeTruthy()
  await ui.input({ key: 'launch-input', text: 'find the auth middleware', kind: 'submit' })

  expect(spawned[0]?.prompt).toBe('find the auth middleware')
  expect(spawned[0]?.type).toBe('Explore')
  await ui.unmount()
})

test('a category chip filters the dex', async ($, on) => {
  stubs(on)
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'cat-ops' })

  expect(await ui.find({ type: 'Button', key: 'card-agent-ops-admin' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'card-scout' })).toBeUndefined()
  await ui.unmount()
})

test('the Swarm card only fills the prompt, with a default text that names no path; no GPU card by default', async ($, on) => {
  const filled: string[] = []
  let spawns = 0
  stubs(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => {
    spawns += 1
    return { model: 'test', agentId: 'x' }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  expect(await ui.find({ type: 'Button', key: 'card-gpu' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'card-gpu-swarm' })).toBeUndefined()
  await ui.press({ key: 'card-swarm' })
  await ui.input({ key: 'launch-input', text: 'compare 7B adapters', kind: 'submit' })

  expect(spawns).toBe(0)
  expect(filled[0]).toContain('research swarm on: compare 7B adapters')
  expect(filled[0]).toContain('a source for each claim')
  expect(filled[0]).not.toMatch(/(Desktop|Projects)/)
  await ui.unmount()
})

test('a short docked pane cuts Grimoire rows, never the tab bar (B4)', async ($, on) => {
  stubs(on)
  on('agent.list', () => ({
    value: [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }],
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const tall = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(tall)
  const all = (await tall.findAll({ type: 'Button' })).filter(b => String(b.key ?? '').startsWith('card-')).length
  await tall.unmount()

  const short = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, bodyColumns: 44, scroll: { offset: 0, bodyRows: 30 } },
  })
  await settle(short)
  const cards = (await short.findAll({ type: 'Button' })).filter(b => String(b.key ?? '').startsWith('card-')).length
  expect(await short.find({ type: 'Button', key: 'tab-deck' })).toBeTruthy()
  expect(await short.find({ type: 'Button', key: 'agent-ag1' })).toBeTruthy()
  expect(cards).toBeGreaterThan(0)
  expect(cards).toBeLessThan(all)
  expect(await short.find({ type: 'Text', text: /more cards?: find/ })).toBeTruthy()
  await short.unmount()
})

test('a running agent card sends the typed message to that agent', async ($, on) => {
  const sent: { to: unknown; text: string }[] = []
  stubs(on)
  on('agent.list', () => ({
    value: [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }],
  }))
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'agent-ag1' })
  await ui.input({ key: 'deck-input', text: 'stop after this file', kind: 'submit' })

  expect(sent[0]?.text).toBe('stop after this file')
  // The event carries the address as the agent's id.
  expect(JSON.stringify(sent[0]?.to)).toContain('ag1')
  await ui.unmount()
})

test('a spawn is logged to the run log', async ($, on) => {
  const files: Record<string, string> = {}
  stubs(on, files)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'test', agentId: 'a9' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'You are a patent claims reviewer. Check claim 1.', subagentType: 'general-purpose' })
  await new Promise(resolve => setTimeout(resolve, 50))

  const log = files[`${HOME}/.claude/grimling/runs/1970-01-01.jsonl`] ?? ''
  expect(log).toContain('"agentId":"a9"')
  expect(log).toContain('patent claims reviewer')
})

// A person moving the ring onto an element the deck drew.
const ringTo = (element: string) => ({
  component: 'Pane' as const,
  requestId: 'grimling',
  element,
  origin: { kind: 'person' as const },
})

test('a failed send says so instead of "Sent"', async ($, on) => {
  const seen = stubs(on)
  on('agent.list', () => ({
    value: [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }],
  }))
  on('session.send', () => ({ isDelivered: false, reason: 'agent-ended' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'agent-ag1' })
  await ui.input({ key: 'deck-input', text: 'stop after this file', kind: 'submit' })

  expect(seen.toasts.join('\n')).toContain('Not sent: agent-ended')
  expect(seen.toasts.join('\n')).not.toContain('Sent to')
  await ui.unmount()
})

test('pods: lower-case done leaves the status line; -1 shows as -; a stale file is flagged', async ($, on) => {
  // 2026-10-28 12:00Z: US Eastern is on daylight time (UTC-4).
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 28, 12, 0) })
  const now = clock.now() / 1000
  // Pods reads only the files pods.files names (the owner's legacy file here).
  const files: Record<string, string> = {
    [`${HOME}/.claude/grimling/settings.json`]:
      '{"pods": {"files": ["~/.claude/pod-status.json"]}, "time": {"zone": "America/Toronto", "showUtc": true}}',
  }
  const seen = stubs(on, files, { clock: false })
  on('agent.list', () => ({ value: [] }))
  const write = (phase: string, updated: number) => {
    files[`${HOME}/.claude/pod-status.json`] = JSON.stringify({
      pod: 'abc123', pct: -1, phase, runs: [], reachable: true, gpu: -1, cpu: 0, cost: 1.5,
      deadline: '03:15', updated,
    })
  }

  write('running', now)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-pods' })
  expect(await ui.find({ type: 'Text', text: /GPU -/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /03:15Z \(23:15 EDT\)/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /STALE/ })).toBeUndefined()
  expect(seen.status.at(-1)).toContain('pod - RUNNING kill-by 03:15Z (23:15 EDT)')

  // The watcher stopped writing 10 minutes ago.
  write('running', now - 600)
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: /STALE/ })).toBeTruthy()
  expect(seen.status.at(-1)).toContain('pod STALE')

  write('done', now)
  await clock.advance(10_000)
  expect(seen.status.at(-1)).not.toContain('pod')
  expect(await ui.find({ type: 'Text', text: /DONE/ })).toBeTruthy()
  await ui.unmount()
})

test('button hotkeys are off while an Input has the ring', async ($, on) => {
  stubs(on)
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'tab-flow' }))?.props.hotkey).toBe('f')
  expect((await ui.find({ type: 'Button', key: 'card-scout' }))?.props.hotkey).toBe('1')

  for (const input of ['launch-input', 'filter-input']) {
    await $.ui.focus(ringTo(input))
    await ui.redraw()
    for (const key of ['tab-deck', 'tab-flow', 'tab-table', 'tab-pods', 'tab-mermaid', 'tab-help', 'card-scout']) {
      expect((await ui.find({ type: 'Button', key }))?.props.hotkey).toBeUndefined()
    }
  }

  await $.ui.focus(ringTo('card-scout'))
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'tab-flow' }))?.props.hotkey).toBe('f')
  await ui.unmount()
})

test('result box: c copies with a toast, a failed copy says why, Enter on the card again fills (B1, B2)', async ($, on) => {
  const fills: string[] = []
  let copied: { isCopied: true } | { isCopied: false; reason: 'no-clipboard' } = { isCopied: true }
  const seen = stubs(on)
  on('agent.list', () => ({
    value: [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'completed' }],
  }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.copy', () => ({ value: copied }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({
    answer: 'found the middleware in auth.ts',
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    agentId: 'ag1',
    reason: 'answer',
    category: null,
    explanation: null,
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'agent-ag1' })

  await ui.press({ key: 'ans-copy' })
  expect(seen.toasts.join('\n')).toContain('copied (31 characters)')
  copied = { isCopied: false, reason: 'no-clipboard' }
  await ui.press({ key: 'ans-copy' })
  expect(seen.toasts.join('\n')).toContain('Answer not copied (no-clipboard)')

  // The ring stayed on the card: Enter there again puts the answer in the prompt.
  await ui.press({ key: 'agent-ag1' })
  expect(fills[0]).toContain('found the middleware in auth.ts')
  expect(seen.toasts.join('\n')).toContain('Answer from scan repo is in the prompt')
  expect(await ui.find({ type: 'Button', key: 'ans-prompt' })).toBeUndefined()
  await ui.unmount()
})

test('answers and agent names reach the pane with no escape sequences (S3)', async ($, on) => {
  const fills: string[] = []
  const ESC = String.fromCharCode(27)
  const BEL = String.fromCharCode(7)
  stubs(on)
  on('agent.list', () => ({
    value: [{ id: 'ag1', description: `scan${ESC}]0;owned${BEL} repo`, type: 'Explore', status: 'completed' }],
  }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({
    answer: `found it${ESC}]52;c;ZXZpbA==${BEL}${ESC}[2J\n\tin auth.ts\u202e${String.fromCharCode(0x9b)}1A`,
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    agentId: 'ag1',
    reason: 'answer',
    category: null,
    explanation: null,
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'agent-ag1' })
  expect(await ui.find({ type: 'Text', text: /found it$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /scan repo/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e]/ })).toBeUndefined()
  await ui.press({ key: 'ans-prompt' })
  expect(fills[0]).toContain('found it\n\tin auth.ts')
  expect(fills[0]).not.toContain(ESC)
  await ui.unmount()
})

test('an answer goes into the prompt after the draft; a refused fill says so; truncation is marked', async ($, on) => {
  const fills: { text: string; mode?: string }[] = []
  let take = false
  const seen = stubs(on)
  on('agent.list', () => ({
    value: [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'completed' }],
  }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.fill', (_, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: take }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete({
    answer: `found it\n${'x'.repeat(9000)}`,
    durationMs: 5,
    isAborted: false,
    turnId: 't1',
    agentId: 'ag1',
    reason: 'answer',
    category: null,
    explanation: null,
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The move onto "put in prompt" is the engine's to grant (the harness pane
  // holds no keyboard), so it is checked on screen, not here.
  await ui.press({ key: 'agent-ag1' })
  expect(await ui.find({ type: 'Text', text: /truncated/ })).toBeTruthy()

  // Refused (a dialog is up): the view stays and the toast says so.
  await ui.press({ key: 'ans-prompt' })
  expect(fills[0]?.mode).toBe('append')
  expect(seen.toasts.join('\n')).toContain('not put in the prompt')
  expect(await ui.find({ type: 'Button', key: 'ans-prompt' })).toBeTruthy()

  take = true
  await ui.press({ key: 'ans-prompt' })
  expect(fills[1]?.text).toContain('found it')
  expect(fills[1]?.text).toContain('[truncated: first 8000 of 9009 characters]')
  expect(seen.toasts.join('\n')).toContain('is in the prompt (truncated)')
  expect(await ui.find({ type: 'Button', key: 'ans-prompt' })).toBeUndefined()
  await ui.unmount()
})

test('moving the ring over cards keeps the target; a refused spawn keeps the draft', async ($, on) => {
  const spawned: string[] = []
  stubs(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', (_, e) => {
    const raw = e as unknown as { subagent_type?: string }
    spawned.push(e.subagentType ?? raw.subagent_type ?? '')
    return { deny: 'agent limit reached' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.ui.focus(ringTo('card-swarm'))
  await $.ui.focus(ringTo('card-planner'))
  await ui.input({ key: 'launch-input', text: 'refactor the parser', kind: 'submit' })

  // Builder (general-purpose) is still the target: the ring moves did not retarget.
  expect(spawned[0]).toBe('general-purpose')
  expect((await ui.find({ type: 'Input', key: 'launch-input' }))?.text).toBe('refactor the parser')
  await ui.unmount()
})

test('an agent missing from agent.list for 5 polls is marked gone', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let listed = [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }]
  stubs(on, {}, { clock: false })
  on('agent.list', () => ({ value: listed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-table' })
  expect(await ui.find({ type: 'Text', text: /running/ })).toBeTruthy()

  listed = []
  await clock.advance(2000 * 4)
  expect(await ui.find({ type: 'Text', text: /gone/ })).toBeUndefined()
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /gone/ })).toBeTruthy()
  await ui.unmount()
})

test('Flow and Table windows follow the focused row and count the rows cut off', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  stubs(on, {}, { clock: false })
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `ag${i}`,
    description: `task ${i}`,
    type: 'Explore',
    status: 'running',
  }))
  on('agent.list', () => ({ value: many }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const view of ['tab-table', 'tab-flow']) {
    await ui.press({ key: view })
    await $.ui.focus(ringTo(view))
    await ui.redraw()
    // Newest rows in view; the oldest are counted above.
    expect(await ui.find({ type: 'Button', key: 'row-ag29' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'row-ag0' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /↑ \d+ more/ })).toBeTruthy()

    await $.ui.focus(ringTo('row-ag1'))
    await ui.redraw()
    expect(await ui.find({ type: 'Button', key: 'row-ag0' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'row-ag2' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /↓ \d+ more/ })).toBeTruthy()
  }
  await ui.unmount()
})

test('a project agent file wins over a user one; folded descriptions are read whole', async ($, on) => {
  const files: Record<string, string> = {
    [`${PROJ}/.claude/agents/ops-admin.md`]: [
      '---',
      'name: ops-admin',
      'description: >',
      '  Project ops helper',
      '  for this repo only.',
      '---',
      'Body.',
    ].join('\n'),
  }
  stubs(on, files, { dirs: { [`${PROJ}/.claude/agents`]: ['ops-admin.md'] } })
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-agent-ops-admin' })
  expect(await ui.find({ type: 'Text', text: /Project ops helper for this repo only · ops-admin · project/ })).toBeTruthy()
  await ui.unmount()
})


test('recent runs from the run log load their task and agent into the launch box', async ($, on) => {
  const files: Record<string, string> = {
    [`${HOME}/.claude/grimling/runs.jsonl`]:
      '{"kind":"spawn","at":"1970-01-01T00:00:00.000Z","agentId":"r1","type":"Explore","description":"find auth","prompt":"find the auth middleware"}\n',
  }
  stubs(on, files)
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', key: 'recent-0' })).toBeTruthy()
  await ui.press({ key: 'recent-0' })
  const box = await ui.find({ type: 'Input', key: 'launch-input' })
  expect(JSON.stringify(box)).toContain('find the auth middleware')
  expect(JSON.stringify(box)).toContain('Scout')
  await ui.unmount()
})

// Live check B6: a long brief from the recent list went out cut at 2000
// characters ("after editin"), and the deck's own launches left no spawn row.
const LONG_BRIEF = `Build the Halloween layer. ${'Check each step and write it down. '.repeat(90)}Stop after editing.`
const spawnRow = (id: string, prompt: string) =>
  `${JSON.stringify({ kind: 'spawn', at: '1970-01-01T00:00:00.000Z', agentId: id, type: 'general-purpose', description: 'halloween', prompt })}\n`

test('a recent run relaunches its whole brief and the launch writes a spawn row', async ($, on) => {
  const files: Record<string, string> = { [`${HOME}/.claude/grimling/runs.jsonl`]: spawnRow('r1', LONG_BRIEF) }
  const spawned: string[] = []
  stubs(on, files)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', (_, e) => {
    spawned.push(e.prompt)
    // The Agent tool's output shape carries the id (the harness drops it otherwise).
    return { model: 'test', agentId: 'n1', result: { status: 'async_launched', agentId: 'n1', description: 'x', prompt: e.prompt, outputFile: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'recent-0' })
  const box = (await ui.find({ type: 'Input', key: 'launch-input' }))?.props.value
  expect(String(box)).toBe(LONG_BRIEF)
  await ui.input({ key: 'launch-input', text: String(box), kind: 'submit' })
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(LONG_BRIEF.length).toBeGreaterThan(3000)
  expect(spawned).toEqual([LONG_BRIEF])
  const rows = (files[`${HOME}/.claude/grimling/runs/1970-01-01.jsonl`] ?? '')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as { kind: string; agentId: string; prompt: string })
  const mine = rows.filter(r => r.kind === 'spawn' && r.agentId === 'n1')
  expect(mine.length).toBe(1)
  expect(mine[0]?.prompt).toBe(LONG_BRIEF)
  await ui.unmount()
})

test('a launch that repeats a running brief or worktree warns first; Enter again launches', async ($, on) => {
  const tree = 'C:\\Users\\T\\myapp-worktrees\\halloween'
  const files: Record<string, string> = {
    [`${HOME}/.claude/grimling/runs.jsonl`]: spawnRow('r1', LONG_BRIEF) + spawnRow('r2', `Work in ${tree} on the site.`),
  }
  const spawned: string[] = []
  const seen = stubs(on, files)
  on('agent.list', () => ({
    value: [
      { id: 'r1', description: 'halloween', type: 'general-purpose', status: 'running' },
      { id: 'r2', description: 'site work', type: 'general-purpose', status: 'running' },
    ],
  }))
  on('agent.spawn', (_, e) => {
    spawned.push(e.prompt)
    return { model: 'test', agentId: 'n1' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-builder' })

  await ui.input({ key: 'launch-input', text: LONG_BRIEF, kind: 'submit' })
  expect(spawned.length).toBe(0)
  expect(seen.toasts.join('\n')).toContain('halloween is still running this same brief: Enter again to launch anyway')
  expect(String((await ui.find({ type: 'Input', key: 'launch-input' }))?.props.value)).toBe(LONG_BRIEF)
  await ui.input({ key: 'launch-input', text: LONG_BRIEF, kind: 'submit' })
  expect(spawned).toEqual([LONG_BRIEF])

  const other = `Fix the footer in ${tree.replaceAll('\\', '/')}/site/index.html`
  await ui.input({ key: 'launch-input', text: other, kind: 'submit' })
  expect(spawned.length).toBe(1)
  expect(seen.toasts.join('\n')).toContain('site work is still running in c:/users/t/myapp-worktrees/halloween')
  await ui.unmount()
})

test('editing the task after a clash warning warns again before launching', async ($, on) => {
  const files: Record<string, string> = { [`${HOME}/.claude/grimling/runs.jsonl`]: spawnRow('r1', LONG_BRIEF) }
  const spawned: string[] = []
  const seen = stubs(on, files)
  on('agent.list', () => ({
    value: [{ id: 'r1', description: 'halloween', type: 'general-purpose', status: 'running' }],
  }))
  on('agent.spawn', (_, e) => {
    spawned.push(e.prompt)
    return { model: 'test', agentId: 'n1' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-builder' })
  const warned = () => seen.toasts.filter(t => t.includes('Enter again to launch anyway')).length

  await ui.input({ key: 'launch-input', text: LONG_BRIEF, kind: 'submit' })
  expect(warned()).toBe(1)
  // The draft changes and comes back: the earlier warning no longer counts.
  await ui.input({ key: 'launch-input', text: 'something else', kind: 'change' })
  await ui.input({ key: 'launch-input', text: LONG_BRIEF, kind: 'change' })
  await ui.input({ key: 'launch-input', text: LONG_BRIEF, kind: 'submit' })
  expect(spawned.length).toBe(0)
  expect(warned()).toBe(2)
  // Enter on the unchanged task launches.
  await ui.input({ key: 'launch-input', text: LONG_BRIEF, kind: 'submit' })
  expect(spawned).toEqual([LONG_BRIEF])
  await ui.unmount()
})

test('the meter shows the status line figures as bars: context, plan limits, cost and time', async ($, on) => {
  usageReading = {
      startedAt: 1_000_000 - 90_000,
      context: { tokens: 144_000, window: 200_000, percent: 72 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 31, resetsAt: '2026-10-29T03:00:00Z' },
        { kind: 'seven_day', percentUsed: 88 },
      ],
      cost: { usd: 1.25 },
  }
  // Times in the user's zone (time.zone); the default is the system's.
  stubs(on, { [`${HOME}/.claude/grimling/settings.json`]: '{"time": {"zone": "America/Toronto"}}' })
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /ctx\s+█{7}░{3}\s+72% 144\.0k\/200\.0k/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /5h\s+█{3}░{7}\s+31% resets Wed 23:00 EDT/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /7d\s+█{9}░\s+88%/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /\$1\.25 · 1m30s/ })).toBeTruthy()
  await ui.unmount()
  usageReading = {}
})

test('the 5h meter row shows the new window after its reset, not nothing (B5)', async ($, on) => {
  const t0 = Date.UTC(2026, 9, 29, 20, 59)
  usageReading = {
    startedAt: t0,
    context: { tokens: 1000, window: 200_000, percent: 1 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 7, resetsAt: '2026-10-29T21:00:00Z' },
      { kind: 'seven_day', percentUsed: 40 },
    ],
    cost: { usd: 0 },
  }
  const clock = mock.clock(on, { now: t0 })
  stubs(on, {}, { clock: false })
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  // After the reset the host leaves the 5h window out of its reading.
  usageReading = { ...usageReading, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] }
  await clock.advance(62_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /5h\s+░{10}\s+0% new window/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /7d\s+█{4}░{6}\s+40%/ })).toBeTruthy()
  await ui.unmount()
  usageReading = {}
})

test('arena: two cards fight on a keyed task; the right answer wins and both are rated', async ($, on) => {
  const files: Record<string, string> = {}
  const spawned: string[] = []
  const live: { id: string; description: string; type: string; status: string }[] = []
  stubs(on, files)
  // The harness drops agentId from a plugin's own spawn answer: the arena
  // finds its fighters by the tag in their description instead.
  on('agent.list', () => ({ value: live }))
  on('agent.spawn', (_, e) => {
    const raw = e as unknown as { model?: string }
    spawned.push(String(raw.model ?? e.model))
    const id = spawned.length === 1 ? 'red1' : 'blue1'
    live.push({ id, description: e.description, type: 'Explore', status: 'running' })
    return { model: 'haiku', agentId: id }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-arena' })
  expect(await ui.find({ type: 'Button', key: 'arena-fight' })).toBeTruthy()
  await ui.press({ key: 'arena-fight' })
  // The press handler spawns both and then records the battle: let it land.
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(spawned).toEqual(['haiku', 'haiku'])

  const done = { durationMs: 2000, isAborted: false, turnId: 't', reason: 'answer' as const }
  await $.turn.complete({ ...done, agentId: 'red1', answer: 'Thinking...\nANSWER: 10 cents' })
  await $.turn.complete({ ...done, agentId: 'blue1', answer: 'ANSWER: 5' })
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(await ui.find({ type: 'Text', text: /Builder wins · Bat and ball/ })).toBeTruthy()
  const saved = JSON.parse(files[`${HOME}/.claude/grimling/arena.json`] ?? '{}') as Record<string, { wins: number; rating: number }>
  expect(saved.builder?.wins).toBe(1)
  expect(saved.scout?.rating).toBeLessThan(1500)
  await ui.unmount()
})

type Listed = { id: string; description: string; type: string; status: AgentStatus }
const pause = (ms: number) => new Promise<void>(resolve => globalThis.setTimeout(resolve, ms))
declare global {
  // The test runtime has timers; the mod's lib does not declare them.
  var setTimeout: (fn: (...args: never[]) => void, ms: number) => unknown
}

// Any of Grim's lines for Scout finishing.
const GRIM_DONE = /Scout's work is done|Scout finished in|Scout wrapped up|Scout returns from/

test('Grim pops up with a line when an agent finishes or fails, then goes after 8 s', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let listed: Listed[] = [
    { id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' },
    { id: 'ag2', description: 'fix parser', type: 'general-purpose', status: 'running' },
  ]
  stubs(on, {}, { clock: false })
  on('agent.list', () => ({ value: listed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: GRIM_DONE })).toBeUndefined()

  listed = [{ ...listed[0]!, status: 'completed' }, listed[1]!]
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: GRIM_DONE })).toBeTruthy()

  // The next event replaces the line.
  listed = [listed[0]!, { ...listed[1]!, status: 'failed' }]
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Builder (has met its end|failed after|\(general-purpose\) did not survive)/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: GRIM_DONE })).toBeUndefined()

  await clock.advance(9000)
  expect(await ui.find({ type: 'Text', text: /Builder (has met its end|failed after|\(general-purpose\) did not survive)/ })).toBeUndefined()
  await ui.unmount()
})

test('"grim": false in settings.json keeps Grim hidden', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let listed: Listed[] = [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }]
  stubs(on, { [`${HOME}/.claude/grimling/settings.json`]: '{"grim": false}' }, { clock: false })
  on('agent.list', () => ({ value: listed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  listed = [{ ...listed[0]!, status: 'completed' }]
  await clock.advance(2000)

  expect(await ui.find({ type: 'Text', text: GRIM_DONE })).toBeUndefined()
  await ui.unmount()
})

test('arena: s / SHARE copies a result card with the winner and reason; a fight is logged; s is off while typing', async ($, on) => {
  const files: Record<string, string> = {}
  const copied: string[] = []
  const live: Listed[] = []
  const seen = stubs(on, files)
  on('agent.list', () => ({ value: live }))
  on('agent.spawn', (_, e) => {
    const id = live.length === 0 ? 'red1' : 'blue1'
    live.push({ id, description: e.description, type: 'Explore', status: 'running' })
    return { model: 'haiku', agentId: id }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-arena' })
  expect(await ui.find({ type: 'Button', key: 'arena-share' })).toBeUndefined()
  await ui.press({ key: 'arena-fight' })
  await pause(50)

  // Both right: the faster one (Scout, red) wins on speed.
  const done = { isAborted: false, turnId: 't', reason: 'answer' as const }
  await $.turn.complete({ ...done, durationMs: 2450, agentId: 'red1', answer: 'ANSWER: 5' })
  await $.turn.complete({ ...done, durationMs: 4770, agentId: 'blue1', answer: 'ANSWER: 5 cents' })
  await pause(50)

  const share = await ui.find({ type: 'Button', key: 'arena-share' })
  expect(share?.props.hotkey).toBe('s')
  await ui.press({ key: 'arena-share' })
  const card = copied[0] ?? ''
  expect(card).toContain('GRIMLING ARENA')
  expect(card).toContain('Bat and ball · haiku')
  expect(card).toContain('Winner: Scout (speed)')
  expect(card).toMatch(/Red {2}Scout +✓ 2\.45 s/)
  expect(card).toMatch(/Scout 1-0-0 · 15\d\d/)
  for (const line of card.split('\n')) expect([...line].length).toBeLessThan(44)
  expect(seen.toasts.join('\n')).toContain('Arena result copied')

  const log = files[`${HOME}/.claude/grimling/runs/1970-01-01.jsonl`] ?? ''
  expect(log).toContain('"kind":"arena"')
  expect(log).toContain('"reason":"speed"')

  await $.ui.focus(ringTo('launch-input'))
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'arena-share' }))?.props.hotkey).toBeUndefined()
  await ui.unmount()
})

test('notify: only the events in notify.events toast; desktop notifications only when on', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let listed: Listed[] = [
    { id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' },
    { id: 'ag2', description: 'fix parser', type: 'general-purpose', status: 'running' },
  ]
  const settingsFile = `${HOME}/.claude/grimling/settings.json`
  const files: Record<string, string> = { [settingsFile]: '{"notify": {"events": ["failed"], "desktop": true}}' }
  const seen = stubs(on, files, { clock: false })
  const desktop: { text: string; title?: string }[] = []
  on('ui.notify', (_, e) => {
    desktop.push({ text: e.text, title: e.title })
    return { value: { isSent: true as const, channel: 'terminal' } }
  })
  on('agent.list', () => ({ value: listed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  listed = [{ ...listed[0]!, status: 'completed' }, listed[1]!]
  await clock.advance(2000)
  expect(seen.toasts.join('\n')).not.toContain('Agent done')
  expect(desktop).toEqual([])

  listed = [listed[0]!, { ...listed[1]!, status: 'failed' }]
  await clock.advance(2000)
  expect(seen.toasts.join('\n')).toContain('Agent failed: fix parser')
  expect(desktop).toEqual([{ text: 'Agent failed: fix parser', title: 'Grimling' }])
})

test('notify: by default every event toasts and nothing goes to the desktop', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let listed: Listed[] = [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }]
  const seen = stubs(on, {}, { clock: false })
  let desktop = 0
  on('ui.notify', () => {
    desktop++
    return { value: { isSent: true as const, channel: 'terminal' } }
  })
  on('agent.list', () => ({ value: listed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  listed = [{ ...listed[0]!, status: 'completed' }]
  await clock.advance(2000)
  expect(seen.toasts.join('\n')).toContain('Agent done: scan repo')
  expect(desktop).toBe(0)
})

test('arena: arena.model picks the model; a puzzles file adds tasks, its accept list counts, bad entries are skipped', async ($, on) => {
  const files: Record<string, string> = {
    [`${HOME}/.claude/grimling/settings.json`]:
      '{"arena": {"model": "sonnet", "puzzlesFile": "~/.claude/grimling/puzzles.json"}}',
    [`${HOME}/.claude/grimling/puzzles.json`]: JSON.stringify([
      { id: 'bat-ball', title: 'Capital', question: 'What is the capital of France?', answer: 'Paris', accept: ['Paris, France'] },
      { id: 'broken', title: 'No answer', question: '?' },
    ]),
  }
  const spawned: string[] = []
  const prompts: string[] = []
  const live: Listed[] = []
  const seen = stubs(on, files)
  on('agent.list', () => ({ value: live }))
  on('agent.spawn', (_, e) => {
    const raw = e as unknown as { model?: string }
    spawned.push(String(raw.model ?? e.model))
    prompts.push(e.prompt)
    const id = spawned.length === 1 ? 'red1' : 'blue1'
    live.push({ id, description: e.description, type: 'Explore', status: 'running' })
    return { model: 'sonnet', agentId: id }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(seen.toasts.join('\n')).toContain('Grimling settings: 1 problem')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-arena' })
  expect(await ui.find({ type: 'Text', text: /arena · sonnet/ })).toBeTruthy()
  await ui.press({ key: 'arena-fight' })
  await pause(50)
  expect(spawned).toEqual(['sonnet', 'sonnet'])
  expect(prompts[0]).toContain('capital of France')

  const done = { durationMs: 2000, isAborted: false, turnId: 't', reason: 'answer' as const }
  await $.turn.complete({ ...done, agentId: 'red1', answer: 'ANSWER: Paris, France' })
  await $.turn.complete({ ...done, agentId: 'blue1', answer: 'ANSWER: Lyon' })
  await pause(50)
  expect(await ui.find({ type: 'Text', text: /Scout wins · Capital/ })).toBeTruthy()
  const log = files[`${HOME}/.claude/grimling/runs/1970-01-01.jsonl`] ?? ''
  expect(log).toContain('"model":"sonnet"')
  await ui.unmount()
})

test('meter.sessionsFile: off by default the count is not shown; set, the meter shows it', async ($, on) => {
  usageReading = { startedAt: 1_000_000, context: { tokens: 1000, window: 200_000, percent: 1 }, cost: { usd: 0 } }
  const files: Record<string, string> = { [`${HOME}/.claude/.session-count`]: '{"n": 3}' }
  const clock = mock.clock(on, { now: 1_000_000 })
  stubs(on, files, { clock: false })
  on('agent.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(12_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /3 sessions/ })).toBeUndefined()

  // Settings are checked every 30 s; the pod poll reads the count every 10 s.
  files[`${HOME}/.claude/grimling/settings.json`] = '{"meter": {"sessionsFile": "~/.claude/.session-count"}}'
  await clock.advance(30_000)
  await clock.advance(10_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /3 sessions/ })).toBeTruthy()
  await ui.unmount()
  usageReading = {}
})

// The stop button: only for agents the deck launched, only after a confirm,
// through TaskStop and its permission check. The harness has no real agents: these check the deck's side (who gets a button, the confirm, the
// TaskStop call, what a result or a denial shows), not that an agent dies.

// Any of Grim's lines for Scout being stopped.
const GRIM_STOPPED = /Scout was stopped|Scout was laid to rest|Scout got called off/
const RUN_LOG = `${HOME}/.claude/grimling/runs/1970-01-01.jsonl`

// a1 is the one the deck launches (Scout); m1 the model spawned. TaskStop is
// allowed unless a test says otherwise; each test answers tool.call itself.
function stopStubs(on: On, files: Record<string, string> = {}, opts: { clock?: boolean } = {}) {
  const seen = stubs(on, files, opts)
  const listed: Listed[] = [
    { id: 'a1', description: 'scan repo', type: 'Explore', status: 'running' },
    { id: 'm1', description: 'model job', type: 'general-purpose', status: 'running' },
  ]
  on('agent.list', () => ({ value: listed }))
  // The harness drops agentId from a plugin's own spawn answer but reads it
  // from the Agent tool's output shape, so the deck's launch gets its id.
  const launchedAs = { status: 'async_launched', agentId: 'a1', description: 'scan repo', prompt: 'scan repo', outputFile: '' }
  on('agent.spawn', () => ({ model: 'test', agentId: 'a1', result: launchedAs }))
  return { seen, listed }
}

test('stop: only a running card the deck launched gets STOP; x is its key while the ring is on it', async ($, on) => {
  stopStubs(on)
  on('tool.check', () => ({ decision: 'allow' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  // Before the launch neither card is the deck's.
  expect(await ui.find({ type: 'Button', key: 'stop-a1' })).toBeUndefined()

  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)
  await settle(ui)
  expect(await ui.find({ type: 'Button', key: 'stop-a1' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'stop-m1' })).toBeUndefined()

  await $.ui.focus(ringTo('agent-a1'))
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'stop-a1' }))?.props.hotkey).toBe('x')
  expect(await ui.find({ type: 'Text', text: /x: stop it/ })).toBeTruthy()
  await $.ui.focus(ringTo('agent-m1'))
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'stop-a1' }))?.props.hotkey).toBeUndefined()
  await ui.unmount()
})

test('stop: STOP opens Stop / Keep with Keep under the ring; Keep calls nothing', async ($, on) => {
  stopStubs(on)
  const calls: unknown[] = []
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', (_, e) => {
    calls.push(e)
    return { result: { message: 'Successfully stopped task: a1', task_id: 'a1', task_type: 'local_agent' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)

  await ui.press({ key: 'stop-a1' })
  expect(await ui.find({ type: 'Text', text: /Stop scan repo\?/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /only stops an agent when you confirm/ })).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'confirm-keep' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'confirm-keep' })
  await pause(50)
  expect(calls).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'confirm-stop' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'stop-a1' })).toBeTruthy()
  await ui.unmount()
})

test('stop: Stop raises TaskStop with the card id and the press as consent; toast, Grim and a stop row', async ($, on) => {
  const files: Record<string, string> = {}
  const { seen } = stopStubs(on, files)
  const calls: unknown[] = []
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', (_, e) => {
    calls.push(e)
    return { result: { message: 'Successfully stopped task: a1', task_id: 'a1', task_type: 'local_agent' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)
  await ui.press({ key: 'stop-a1' })
  await ui.press({ key: 'confirm-stop' })
  await settle(ui)

  expect(calls.length).toBe(1)
  expect(JSON.stringify(calls[0])).toContain('"tool":"TaskStop"')
  expect(JSON.stringify(calls[0])).toContain('"task_id":"a1"')
  expect(JSON.stringify(calls[0])).toContain('The user pressed \\"Stop\\"')
  expect(seen.toasts.join('\n')).toContain('Agent stopped: scan repo')
  expect(await ui.find({ type: 'Text', text: GRIM_STOPPED })).toBeTruthy()
  const log = files[RUN_LOG] ?? ''
  expect(log).toContain('"kind":"stop"')
  expect(log).toContain('"ok":true')
  // The card says it was stopped and offers no second stop.
  expect(await ui.find({ type: 'Button', key: 'stop-a1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^stopped$/ })).toBeTruthy()
  await ui.unmount()
})

test('stop: a denied permission check gives "Not stopped" and leaves STOP to try again', async ($, on) => {
  const files: Record<string, string> = {}
  const { seen } = stopStubs(on, files)
  // An ask with no person to say yes: the call resolves isError, it does not throw.
  on('tool.check', () => ({ decision: 'ask', reason: 'stop agent a1?' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)
  await ui.press({ key: 'stop-a1' })
  await ui.press({ key: 'confirm-stop' })
  await settle(ui)

  expect(seen.toasts.join('\n')).toContain('Not stopped: Permission to use TaskStop has been denied')
  expect(seen.toasts.join('\n')).not.toContain('Agent stopped')
  expect(await ui.find({ type: 'Text', text: GRIM_STOPPED })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'stop-a1' })).toBeTruthy()
  expect(files[RUN_LOG] ?? '').toContain('"ok":false')
  await ui.unmount()
})

test("stop: a hook's deny gives \"Not stopped: <reason>\"", async ($, on) => {
  const { seen } = stopStubs(on)
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ deny: 'blocked by a rule' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)
  await ui.press({ key: 'stop-a1' })
  await ui.press({ key: 'confirm-stop' })
  await settle(ui)

  expect(seen.toasts.join('\n')).toContain('Not stopped: blocked by a rule')
  await ui.unmount()
})

test('stop: no double stop: once asked, the card has no STOP and x on it starts nothing', async ($, on) => {
  stopStubs(on)
  const calls: unknown[] = []
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', (_, e) => {
    calls.push(e)
    return { result: { message: 'Successfully stopped task: a1', task_id: 'a1', task_type: 'local_agent' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)
  await ui.press({ key: 'stop-a1' })
  await ui.press({ key: 'confirm-stop' })
  await settle(ui)

  await $.ui.focus(ringTo('agent-a1'))
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'stop-a1' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'confirm-stop' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /x: stop it/ })).toBeUndefined()
  expect(calls.length).toBe(1)
  await ui.unmount()
})

test('stop: the poll seeing killed after the button stopped it does not toast or pop Grim again', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { seen, listed } = stopStubs(on, {}, { clock: false })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: { message: 'Successfully stopped task: a1', task_id: 'a1', task_type: 'local_agent' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)
  await ui.press({ key: 'stop-a1' })
  await ui.press({ key: 'confirm-stop' })
  await settle(ui)
  expect(seen.toasts.join('\n')).toContain('Agent stopped: scan repo')

  listed[0] = { ...listed[0]!, status: 'killed' }
  await clock.advance(2000)
  expect(seen.toasts.join('\n')).not.toContain('Agent killed: scan repo')
  // A model-spawned agent that is killed elsewhere still gets the usual toast.
  listed[1] = { ...listed[1]!, status: 'killed' }
  await clock.advance(2000)
  expect(seen.toasts.join('\n')).toContain('Agent killed: model job')
  await ui.unmount()
})

test('stop: stop.enabled false hides STOP', async ($, on) => {
  const files: Record<string, string> = {
    [`${HOME}/.claude/grimling/settings.json`]: '{"stop": {"enabled": false}}',
  }
  stopStubs(on, files)
  on('tool.check', () => ({ decision: 'allow' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await ui.press({ key: 'card-scout' })
  await ui.input({ key: 'launch-input', text: 'scan repo', kind: 'submit' })
  await settle(ui)
  expect(await ui.find({ type: 'Button', key: 'agent-a1' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'stop-a1' })).toBeUndefined()
  await ui.unmount()
})
