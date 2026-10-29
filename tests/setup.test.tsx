import { expect, mock, test } from 'claude-code/testing'
import { envHome, HOME, PROJ, slash } from './paths'
import type { CommandRunInput } from 'claude-code'

import { checkText, emptyHint, modeOf, planWrite, readUserFile, showText } from '../hooks/setup'
import { parseSettings } from '../hooks/settings'

// /grimling-setup: check (the default), show, and ask (picked in the pane,
// previewed, then written over the user file only); the empty-state hints.

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const USER = `${HOME}/.claude/grimling/settings.json`
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

type Seen = { toasts: string[]; writes: string[]; files: Record<string, string> }

function engine(on: On, files: Record<string, string> = {}): Seen {
  const seen: Seen = { toasts: [], writes: [], files }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({}))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const p = slash(e.path)
    if (p in seen.files) return { value: seen.files[p] ?? '' }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    // debug.log aside: every other write counts.
    if (!slash(e.path).endsWith('/debug.log')) seen.writes.push(slash(e.path))
    seen.files[slash(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slash(e.path) in seen.files }))
  return seen
}

const setupCmd = (args: string): CommandRunInput => ({
  command: 'grimling-setup',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
})

test('modes: none is check; show, ask; anything else is unknown', () => {
  expect(modeOf('')).toBe('check')
  expect(modeOf(' Show ')).toBe('show')
  expect(modeOf('ask')).toBe('ask')
  expect(modeOf('reset')).toBeNull()
})

test('a merge keeps unknown keys, $schema and other settings; only changed keys are set', () => {
  const base = JSON.stringify({ $schema: './schema/settings.schema.json', myNote: 'keep me', time: { showUtc: true }, log: { keepDays: 9 } })
  const plan = planWrite(base, { 'time.clock': '12h', 'log.runs': 'redacted', 'grim.enabled': false })
  if (!plan.ok) throw new Error(plan.message)
  const out = JSON.parse(plan.text) as Record<string, unknown>
  expect(out).toEqual({
    $schema: './schema/settings.schema.json',
    myNote: 'keep me',
    time: { showUtc: true, clock: '12h' },
    log: { keepDays: 9 },
    grim: { enabled: false },
  })
  // log.runs answered with its default: not written.
  expect(plan.changes.map(c => c.key)).toEqual(['time.clock', 'grim.enabled'])
  expect(Object.keys(out)[0]).toBe('$schema')
})

test('no file: only the changed keys; nothing picked means nothing to write', () => {
  const plan = planWrite(null, { 'notify.desktop': true })
  expect(plan.ok && plan.text).toBe('{\n  "notify": {\n    "desktop": true\n  }\n}\n')
  const none = planWrite(null, {})
  expect(none.ok && none.changes).toEqual([])
})

test('a bad file is never planned over; a bad answer is refused', () => {
  const bad = planWrite('{"grim": {"enabled": tru', { 'grim.enabled': false })
  expect(bad.ok).toBe(false)
  expect(!bad.ok && bad.message).toContain('Fix it first')
  expect(planWrite('[1, 2]', { 'grim.enabled': false }).ok).toBe(false)
  expect(planWrite(null, { 'time.zone': 'Mars/Olympus' }).ok).toBe(false)
})

test('check lists problems and files; with no file it says all defaults and how to start', () => {
  const parsed = parseSettings({ grim: { seconds: 99 }, grimm: true })
  const text = checkText({ file: readUserFile('{}'), problems: parsed.problems, files: ['~/.claude/grimling/settings.json'] })
  expect(text).toContain('Files read: ~/.claude/grimling/settings.json')
  expect(text).toContain('2 problems:')
  expect(text).toContain('- grim.seconds: must be a whole number from 2 to 30 (using default)')
  expect(text).toContain('- grimm: unknown key (ignored)')
  const fresh = checkText({ file: readUserFile(null), problems: [], files: [] })
  expect(fresh).toContain('No settings file: all defaults')
  expect(fresh).toContain('/grimling-setup ask')
  expect(fresh).toContain('No problems.')
})

test('show marks the values that differ from the defaults and where they came from', () => {
  const user = { time: { clock: '12h' } }
  const proj = { cards: { hide: ['gpu'] } }
  const eff = parseSettings(user).value
  eff.cards.hide = ['gpu']
  const text = showText(eff, user, proj)
  expect(text).toContain('* time.clock = "12h"  (settings.json; default "24h")')
  expect(text).toContain('* cards.hide = ["gpu"]  (.claude/grimling.json; default [])')
  expect(text).toContain('  grim.enabled = true')
  expect(text).toContain('2 changed from the defaults.')
})

test('/grimling-setup check through the command: problems listed, files read', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on, { [USER]: '{"grim": {"seconds": 1}}' })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const out = JSON.stringify(await $.command.run(setupCmd('')))
  expect(out).toContain('Files read: ~/.claude/grimling/settings.json')
  expect(out).toContain('grim.seconds: must be a whole number from 2 to 30')
})

test('ask: the preview in the pane is exactly what Write saves; unknown keys stay', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const before = '{\n  "$schema": "./s.json",\n  "custom": {"x": 1},\n  "log": {"runs": "meta"}\n}\n'
  const seen = engine(on, { [USER]: before })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const said = JSON.stringify(await $.command.run(setupCmd('ask')))
  expect(said).toContain('Setup is open in Grimling')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Nothing to change yet/ })).toBeTruthy()

  // Clock 12h, desktop notifications on, run log redacted.
  await ui.press({ key: 'setup-1-1' })
  await ui.press({ key: 'setup-2-0' })
  await ui.press({ key: 'setup-4-0' })
  const plan = planWrite(before, { 'time.clock': '12h', 'notify.desktop': true, 'log.runs': 'redacted' })
  if (!plan.ok) throw new Error(plan.message)
  const lines = plan.text.trimEnd().split('\n')
  for (const l of lines) expect(await ui.find({ type: 'Text', text: l })).toBeTruthy()
  expect(seen.writes).toEqual([])

  await ui.press({ key: 'setup-write' })
  await clock.advance(100)
  expect(seen.writes).toEqual([USER])
  expect(seen.files[USER]).toBe(plan.text)
  const written = JSON.parse(seen.files[USER] ?? '{}') as Record<string, unknown>
  expect(written.custom).toEqual({ x: 1 })
  expect(written.$schema).toBe('./s.json')
  expect(seen.toasts.join('\n')).toContain('Saved 3 settings')
  // Never a project file.
  expect(seen.writes.some(p => p.includes(PROJ))).toBe(false)
  await ui.unmount()
})

test('ask: a bad file is never overwritten, before or after the preview', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const broken = '{"grim": {"enabled": tru'
  const seen = engine(on, { [USER]: broken })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const said = JSON.stringify(await $.command.run(setupCmd('ask')))
  expect(said).toContain('Fix it first')
  expect(seen.files[USER]).toBe(broken)

  // A good file that turns bad while the preview is open.
  seen.files[USER] = '{"grim": {"enabled": true}}'
  await $.command.run(setupCmd('ask'))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'setup-3-1' })
  seen.files[USER] = broken
  await ui.press({ key: 'setup-write' })
  await clock.advance(100)
  expect(seen.files[USER]).toBe(broken)
  expect(seen.writes).toEqual([])
  expect(seen.toasts.join('\n')).toContain('Fix it first')
  await ui.press({ key: 'setup-cancel' })
  expect(seen.toasts.join('\n')).toContain('nothing was written')
  await ui.unmount()
})

test('empty hints: no agents, no runs and no cards of your own each point somewhere', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: emptyHint('agents') })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: emptyHint('recent') })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: emptyHint('cards') })).toBeTruthy()
  expect(emptyHint('recent', 'meta')).toContain('log.runs is "meta"')
  await ui.unmount()
})
