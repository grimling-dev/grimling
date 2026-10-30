import { expect, mock, test } from 'claude-code/testing'
import { envHome, HOME, PROJ, slash } from './paths'
import type { AgentStatus } from 'claude-code'

// The "waiting" signal: a "wait 32s" badge on a waiting agent's card, a count in
// the tab bar, footer and status line, and one Grim popup per wait.

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

type Seen = { toasts: string[]; status: string[]; files: Record<string, string> }

function engine(on: On, files: Record<string, string> = {}): Seen {
  const seen: Seen = { toasts: [], status: [], files: { ...files } }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({}))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    seen.status.push(String(e.text ?? ''))
    return { value: undefined }
  })
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
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
  return seen
}

type Listed = { id: string; description: string; type: string; status: AgentStatus }
type Ui = {
  find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string } | undefined>
  redraw: () => Promise<unknown>
}

// Grim's lines: the waiting ones for Scout, and Builder's failed ones.
const WAIT_LINE =
  /^Scout (is waiting\. Enter on its card to message it|paused after .+: it may need you|is held: a plan to approve, or work of its own)\.$/
const FAILED_LINE = /^Builder (has met its end \(failed\)|failed after .+\. Its card has the details|\(general-purpose\) did not survive this one)\.$/
const isWaitLine = (text: string) => WAIT_LINE.test(text)

// Grim's waiting line in the bubble now ('' when none). The test's `$` has no
// state noun, so Grim is read where the person sees it.
async function say(ui: Ui, line = WAIT_LINE): Promise<string> {
  await ui.redraw()
  return (await ui.find({ type: 'Text', text: line }))?.text ?? ''
}

// The card's badge, cut to its 8 columns: "wait 32s", "wait 12m", "wait 3h".
const BADGE = /^wait \d+[smh]$/

const SETTINGS = `${HOME}/.claude/grimling/settings.json`

test('a waiting agent: badge on its card, a count in the tab bar and status line, Grim pops once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen = engine(on)
  let status: AgentStatus = 'running'
  on('agent.list', () => ({ value: [{ id: 'w1', description: 'scan repo', type: 'Explore', status }] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  status = 'waiting'
  await clock.advance(2000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: BADGE })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '◎ 1 waiting' })).toBeTruthy()
  expect(seen.status.some(s => s.includes('◎ 1 waiting'))).toBe(true)
  expect(isWaitLine(await say(ui))).toBe(true)
  // No toast for a wait (notify.events unchanged).
  expect(seen.toasts.some(t => /wait/i.test(t))).toBe(false)
  await ui.unmount()
})

test('once per wait: no repeat while it waits, none within 60 s of a flap, again after', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  let status: AgentStatus = 'running'
  on('agent.list', () => ({ value: [{ id: 'w2', description: 'scan repo', type: 'Explore', status }] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await clock.advance(2000)
  status = 'waiting'
  await clock.advance(2000)
  const first = await say(ui)
  expect(isWaitLine(first)).toBe(true)
  // Still waiting three polls on (6 s, under grim.seconds): the same line, no new pop.
  for (let i = 0; i < 3; i++) {
    await clock.advance(2000)
    expect(await say(ui)).toBe(first)
  }
  // Grim has gone (8 s); a flap inside the minute brings no new popup.
  status = 'running'
  await clock.advance(2000)
  status = 'waiting'
  await clock.advance(2000)
  expect(await say(ui)).toBe('')
  // 61 s on, a new wait pops again.
  status = 'running'
  await clock.advance(61_000)
  status = 'waiting'
  await clock.advance(2000)
  expect(isWaitLine(await say(ui))).toBe(true)
  await ui.unmount()
})

test('grim.waiting false: the badge and count stay, no waiting popup', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen = engine(on, { [SETTINGS]: '{"grim": {"waiting": false}}' })
  let status: AgentStatus = 'running'
  on('agent.list', () => ({ value: [{ id: 'w3', description: 'scan repo', type: 'Explore', status }] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  status = 'waiting'
  await clock.advance(2000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: BADGE })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '◎ 1 waiting' })).toBeTruthy()
  expect(seen.status.some(s => s.includes('◎ 1 waiting'))).toBe(true)
  expect(await say(ui)).toBe('')
  await ui.unmount()
})

test('a failed bubble with a report stays up over a wait that starts in the same poll', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  let listed: Listed[] = [
    { id: 'w4', description: 'scan repo', type: 'Explore', status: 'running' },
    { id: 'w5', description: 'build it', type: 'general-purpose', status: 'running' },
  ]
  on('agent.list', () => ({ value: listed }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  // w5 fails first in list order; w4 starts waiting in the same poll.
  listed = [
    { ...listed[1]!, status: 'failed' },
    { ...listed[0]!, status: 'waiting' },
  ]
  await clock.advance(2000)
  const ui = await $.ui.mount(PANE)
  expect(await say(ui, FAILED_LINE)).toMatch(FAILED_LINE)
  expect(await say(ui)).toBe('')
  expect(await ui.find({ type: 'Button', key: 'grim-report' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '◎ 1 waiting' })).toBeTruthy()
  // Later polls of the same wait do not replace it either.
  await clock.advance(2000)
  expect(await ui.find({ type: 'Button', key: 'grim-report' })).toBeTruthy()
  await ui.unmount()
})

test('the badge counts from when the wait began, not from first seen, across redraws', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  let status: AgentStatus = 'running'
  on('agent.list', () => ({ value: [{ id: 'w6', description: 'scan repo', type: 'Explore', status }] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  // Running for 10 minutes first.
  await clock.advance(600_000)
  status = 'waiting'
  await clock.advance(2000)
  await clock.advance(30_000)
  const ui = await $.ui.mount(PANE)
  await ui.redraw()
  // About 30 s into the wait; never the 10 minutes since first seen.
  expect(await ui.find({ type: 'Text', text: /^wait 3\ds$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^wait 1[01]m$/ })).toBeUndefined()
  // Back to running and waiting again: the clock restarts.
  status = 'running'
  await clock.advance(2000)
  status = 'waiting'
  await clock.advance(2000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^wait [0-2]s$/ })).toBeTruthy()
  await ui.unmount()
})

test('no waiting agent: no count, no badge (nothing else changes)', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen = engine(on)
  on('agent.list', () => ({ value: [{ id: 'w6', description: 'scan repo', type: 'Explore', status: 'running' }] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /waiting/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: BADGE })).toBeUndefined()
  expect(seen.status.some(s => s.includes('waiting'))).toBe(false)
  expect(seen.status.some(s => s.includes('⚙ 1 running'))).toBe(true)
  await ui.unmount()
})

test('a second session start (resume, /clear) keeps the wait: no new popup, the badge keeps counting', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  let status: AgentStatus = 'running'
  on('agent.list', () => ({ value: [{ id: 'w7', description: 'scan repo', type: 'Explore', status }] }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  status = 'waiting'
  await clock.advance(2000)
  const ui = await $.ui.mount(PANE)
  expect(isWaitLine(await say(ui))).toBe(true)
  // Grim has gone; over a minute later the session starts again, still waiting.
  await clock.advance(70_000)
  expect(await say(ui)).toBe('')
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  // The tracked agent (agents-1, with waitSince) is kept: it was already
  // waiting, so no popup, and the badge counts from the first wait.
  expect(await say(ui)).toBe('')
  expect(await ui.find({ type: 'Text', text: /^wait 1m$/ })).toBeTruthy()
  await ui.unmount()
})
