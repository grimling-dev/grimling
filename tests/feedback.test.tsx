import { expect, mock, test } from 'claude-code/testing'
import { envHome, escapeRe, HOME, PROJ, slash } from './paths'
import type { AgentSpawnInput, AgentStatus, CommandRunInput } from 'claude-code'

import { MAX_URL, buildFeedback, diagnosticsText, failurePrefill, kindFromArgs } from '../hooks/feedback'

// /grimling-feedback: a preview of exactly what is sent, a pre-filled GitHub
// link opened in the browser (the mod sends nothing), Grim's thanks, the
// one-time hint, and `f` on a failed agent's Grim bubble.

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const PANE = {
  plugin: 'grimling',
  component: 'Pane',
  requestId: 'grimling',
  surface: 'terminal',
  props: {
    title: 'Grimling',
    isFocused: true,
    bodyColumns: 78,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

type Seen = { toasts: string[]; runs: string[][]; copied: string[]; store: Record<string, unknown>; files: Record<string, string> }

function engine(on: On, opts: { open?: boolean; store?: Record<string, unknown>; files?: Record<string, string> } = {}): Seen {
  const seen: Seen = { toasts: [], runs: [], copied: [], store: { ...opts.store }, files: { ...opts.files } }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({}))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.copy', (_, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('env.get', (_, e) => ({ value: envHome(e.name) ?? (e.name === 'OS' ? 'Windows_NT' : undefined) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.version', () => ({ value: { version: '2.1.312', base: '2.1.312', builtAt: '2026-10-01T00:00:00Z' } }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const p = slash(e.path)
    if (p in seen.files) return { value: seen.files[p] ?? '' }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    seen.files[slash(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slash(e.path) in seen.files }))
  on('store.get', (_, e) => ({ value: seen.store[e.key] }))
  on('store.set', (_, e) => {
    seen.store[e.key] = e.value
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    seen.runs.push([...e.argv])
    return { value: { exitCode: opts.open === false ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return seen
}

const DIAG = {
  grimling: 'v0.4.3',
  claudeCode: '2.1.312',
  os: 'windows',
  paneWidth: 78,
  cards: { builtin: 7, pack: 12, user: 1 },
  settingsProblems: ['grim.seconds', '.claude/grimling.json log.runs'],
}

test('diagnostics: versions, OS, width, card counts and problem keys only', () => {
  const text = diagnosticsText(DIAG, HOME)
  expect(text).toContain('Grimling: v0.4.3')
  expect(text).toContain('Claude Code: 2.1.312')
  expect(text).toContain('Cards: 7 built-in, 12 pack, 1 user, 0 project')
  expect(text).toContain('Settings problems: 2 (grim.seconds, log.runs)')
  expect(text).not.toContain('grimling.json')
  expect(text).not.toContain(HOME)
})

test('the link is encoded, under the limit, and carries the fields the preview shows', () => {
  const out = buildFeedback({ kind: 'bug', message: 'Cards vanish & Grim #2 shows?', diagnostics: diagnosticsText(DIAG), repo: 'grimling-dev/grimling' })
  expect(out.isTooLong).toBe(false)
  expect(out.url.length).toBeLessThan(MAX_URL)
  expect(out.url.startsWith('https://github.com/grimling-dev/grimling/issues/new?template=bug.yml&title=')).toBe(true)
  expect(out.url).toContain(`&what=${encodeURIComponent('Cards vanish & Grim #2 shows?')}`)
  expect(out.url).not.toContain(' ')
  const params = new URLSearchParams(out.url.split('?')[1] ?? '')
  expect(params.get('what')).toBe(out.fields[0]?.text ?? '')
  expect(params.get('diagnostics')).toBe(out.fields[1]?.text ?? '')
  expect(params.get('title')).toBe(out.title)
})

test('ideas and praise go to Discussions', () => {
  const idea = buildFeedback({ kind: 'idea', message: 'A dark theme', diagnostics: 'd', repo: 'o/r' })
  expect(idea.url.startsWith('https://github.com/o/r/discussions/new?category=ideas&')).toBe(true)
  const praise = buildFeedback({ kind: 'praise', message: 'Love Grim', diagnostics: 'd', repo: 'o/r' })
  expect(praise.url).toContain('category=show-and-tell')
})

test('long text falls back: the short link plus the text to copy', () => {
  const out = buildFeedback({ kind: 'bug', message: 'x'.repeat(5000), diagnostics: 'd', repo: 'o/r' })
  expect(out.isTooLong).toBe(true)
  expect(out.url).not.toContain('what=')
  expect(out.url.length).toBeLessThan(MAX_URL)
  expect(out.copy).toContain('x'.repeat(5000))
})

test('outgoing text is scrubbed: home paths and keys never leave', () => {
  const out = buildFeedback({
    kind: 'bug',
    message: `crash reading ${HOME}/.claude/x with OPENAI_API_KEY=sk-abcdefghijklmnopqrstu`,
    diagnostics: 'd',
    repo: 'o/r',
    home: HOME,
  })
  expect(out.copy).not.toContain(HOME)
  expect(out.copy).not.toContain('sk-abcdef')
  expect(out.copy).toContain('~/.claude/x')
})

test('feedback scrubs any user folder: every spelling of home, and other users too', () => {
  const message = [
    'c:/users/t/a.txt',
    '/c/Users/T/b.txt',
    'C:\\Users\\T~1\\AppData\\c.txt',
    'c:\\users\\sam\\d.txt',
    '/Users/T/e.txt',
    '/home/user/f.txt',
    'see https://example.com/home/user/page',
  ].join('\n')
  const out = buildFeedback({ kind: 'bug', message, diagnostics: 'd', repo: 'o/r', home: 'C:/Users/T' })
  for (const leak of ['users/t', 'Users/T', 'T~1', 'sam', '/home/user/f']) expect(out.copy).not.toContain(leak)
  expect(out.copy).toContain('~/a.txt')
  expect(out.copy).toContain('~/b.txt')
  expect(out.copy).toContain('~\\AppData\\c.txt')
  expect(out.copy).toContain('~\\d.txt')
  expect(out.copy).toContain('~/e.txt')
  expect(out.copy).toContain('~/f.txt')
  // A URL's /home path is not a home folder.
  expect(out.copy).toContain('https://example.com/home/user/page')
})

test('kindFromArgs reads a leading bug:, idea: or praise:', () => {
  expect(kindFromArgs('bug: pane is blank')).toEqual({ kind: 'bug', message: 'pane is blank' })
  expect(kindFromArgs('Idea - themes')).toEqual({ kind: 'idea', message: 'themes' })
  expect(kindFromArgs('bugfix wanted')).toEqual({ message: 'bugfix wanted' })
})

test('failurePrefill names the card, type and time and the first output line, scrubbed', () => {
  const text = failurePrefill({ name: 'Scout', type: 'Explore', duration: '12s', output: `\nENOENT: ${HOME}/a.txt\nmore` }, HOME)
  expect(text.startsWith('Scout (Explore) failed after 12s.\nError: ENOENT: ~/a.txt')).toBe(true)
})

// /grimling-feedback as the person types it.
const feedbackCmd = (args: string): CommandRunInput => ({
  command: 'grimling-feedback',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
})

const spawn = (prompt: string): AgentSpawnInput => ({
  tool_use_id: 'tu1',
  prompt,
  description: 'secret task',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'test',
  background: false,
  fork: false,
})

test('/grimling-feedback shows the preview; Send opens exactly that link; Grim thanks; no prompt or path in it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen = engine(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'test', agentId: 'a1' }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('TOP SECRET PROMPT'))
  await clock.advance(100)

  const out = await $.command.run(feedbackCmd('bug: the pane went blank'))
  expect(JSON.stringify(out)).toContain('Feedback preview is open')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /What is sent, to github\.com\/grimling-dev\/grimling/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'the pane went blank' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Claude Code: 2\.1\.312/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: new RegExp(`TOP SECRET|secret task|${escapeRe(HOME)}`) })).toBeUndefined()

  await ui.press({ key: 'fb-send' })
  await clock.advance(100)
  const argv = seen.runs[0] ?? []
  expect(argv.slice(0, 2)).toEqual(['rundll32', 'url.dll,FileProtocolHandler'])
  const url = argv[2] ?? ''
  const expected = buildFeedback({
    kind: 'bug',
    message: 'the pane went blank',
    diagnostics: new URLSearchParams(url.split('?')[1] ?? '').get('diagnostics') ?? '',
    repo: 'grimling-dev/grimling',
    home: HOME,
  })
  expect(url).toBe(expected.url)
  expect(url).not.toContain('TOP%20SECRET')
  expect(decodeURIComponent(url)).not.toContain(HOME)
  expect(seen.toasts.join('\n')).toContain('GitHub opened with your feedback')
  expect(await ui.find({ type: 'Text', text: /Thank you|Received\. Your words/ })).toBeTruthy()
  await ui.unmount()
})

test('no browser: the link is copied and a toast says so; Cancel sends nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen = engine(on, { open: false })
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.command.run(feedbackCmd('idea: themes'))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'fb-send' })
  await clock.advance(100)
  expect(seen.copied[0]).toContain('/discussions/new?category=ideas')
  expect(seen.toasts.join('\n')).toContain('Could not open the browser: the link is copied')

  await $.command.run(feedbackCmd('bug: nope'))
  await ui.redraw()
  await ui.press({ key: 'fb-cancel' })
  expect(seen.runs.length).toBe(1)
  expect(seen.toasts.join('\n')).toContain('nothing was sent')
  await ui.unmount()
})

test('the hint shows once after the 5th start; x hides it for good', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const seen = engine(on, { store: { launches: 4 } })
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /enjoying it\? \/grimling-feedback/ })).toBeTruthy()
  expect(seen.store.nudgeShown).toBe(true)
  await ui.press({ key: 'nudge-dismiss' })
  expect(await ui.find({ type: 'Text', text: /enjoying it\?/ })).toBeUndefined()
  expect(seen.store.nudgeDismissed).toBe(true)
  await ui.unmount()
})

test('the hint does not show again once it was shown, or with feedback.nudge false', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on, {
    store: { launches: 9, nudgeShown: true },
    files: { [`${HOME}/.claude/grimling/settings.json`]: '{"feedback": {"nudge": false}}' },
  })
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /enjoying it\?/ })).toBeUndefined()
  await ui.unmount()
})

type Listed = { id: string; description: string; type: string; status: AgentStatus }

test('f on a failed agent\'s Grim bubble pre-fills the report with its error', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  let listed: Listed[] = [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }]
  on('agent.list', () => ({ value: listed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  await $.turn.complete({ agentId: 'ag1', answer: `EACCES: permission denied, open '${HOME}/x'`, durationMs: 5, isAborted: false, turnId: 't', reason: 'answer' })
  listed = [{ ...listed[0]!, status: 'failed' }]
  await clock.advance(2000)
  const ui = await $.ui.mount(PANE)
  const report = await ui.find({ type: 'Button', key: 'grim-report' })
  expect(report?.props.hotkey).toBe('f')
  // Flow gives up its f while the bubble offers it.
  expect((await ui.find({ type: 'Button', key: 'tab-flow' }))?.props.hotkey).toBeUndefined()
  await ui.press({ key: 'grim-report' })
  const box = JSON.stringify(await ui.find({ type: 'Input', key: 'feedback-input' }))
  expect(box).toContain('Scout (Explore) failed after')
  expect(box).toContain("EACCES: permission denied, open '~/x'")
  expect(box).not.toContain(HOME)
  await ui.unmount()
})

declare global {
  // The test runtime has timers; the mod's lib does not declare them.
  var setTimeout: (fn: (...args: never[]) => void, ms: number) => unknown
}
