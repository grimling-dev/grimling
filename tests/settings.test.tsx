import { expect, mock, test } from 'claude-code/testing'
import { envHome, HOME, PROJ, slash } from './paths'

import { DEFAULTS, expandHome, mergeProject, parseSettings } from '../hooks/settings'

// Settings: ~/.claude/grimling/settings.json (every key has a default) and a
// project's .claude/grimling.json (only cards and templates).

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
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const USER = `${HOME}/.claude/grimling/settings.json`

// A quiet engine over `files`; the test's mock clock drives the polls.
function engine(on: On, files: Record<string, string>) {
  const seen = { toasts: [] as string[] }
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
    if (p in files) return { value: files[p] ?? '' }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    files[slash(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slash(e.path) in files }))
  return seen
}

test('no file: every default; DEFAULTS has the feedback keys', () => {
  const { value, problems } = parseSettings(undefined)
  expect(problems).toEqual([])
  expect(value).toEqual(DEFAULTS)
  expect(value.log.runs).toBe('redacted')
  expect(value.feedback.repo).toBe('grimling-dev/grimling')
  expect(value.feedback.nudge).toBe(true)
  expect(value.pods.enabled).toBe('auto')
})

test('stop.enabled: on by default; false turns the stop button off; not a boolean keeps the default', () => {
  expect(parseSettings(undefined).value.stop.enabled).toBe(true)
  expect(parseSettings({ stop: { enabled: false } }).value.stop.enabled).toBe(false)
  const bad = parseSettings({ stop: { enabled: 'no' } })
  expect(bad.value.stop.enabled).toBe(true)
  expect(bad.problems.map(p => p.path)).toEqual(['stop.enabled'])
})

test('grim.waiting: on by default; false turns the waiting popup off; not a boolean keeps the default', () => {
  expect(parseSettings(undefined).value.grim.waiting).toBe(true)
  expect(parseSettings({ grim: { waiting: false } }).value.grim.waiting).toBe(false)
  const bad = parseSettings({ grim: { waiting: 'yes' } })
  expect(bad.value.grim.waiting).toBe(true)
  expect(bad.problems.map(p => p.path)).toEqual(['grim.waiting'])
  // The legacy {"grim": false} still turns Grim off as a whole; waiting keeps its default.
  const legacy = parseSettings({ grim: false })
  expect(legacy.value.grim.enabled).toBe(false)
  expect(legacy.value.grim.waiting).toBe(true)
})

test('a bad field keeps its default and names a problem; good fields are used', () => {
  const { value, problems } = parseSettings({
    grim: { seconds: 99, enabled: false },
    log: { runs: 'everything', promptChars: 200 },
    time: { clock: '12h' },
  })
  expect(value.grim.seconds).toBe(8)
  expect(value.grim.enabled).toBe(false)
  expect(value.log.runs).toBe('redacted')
  expect(value.log.promptChars).toBe(200)
  expect(value.time.clock).toBe('12h')
  expect(problems.map(p => p.path).sort()).toEqual(['grim.seconds', 'log.runs'])
  expect(problems[0]?.message).toContain('(using default)')
})

test('unknown keys and bad Grim placeholders are problems; $schema is fine', () => {
  const { problems } = parseSettings({
    $schema: './schema/settings.schema.json',
    grimm: true,
    grim: { lines: { done: ['{name} done in {when}'] } },
    log: { redact: ['(unclosed'] },
  })
  const paths = problems.map(p => p.path).sort()
  expect(paths).toEqual(['grim.lines.done', 'grimm', 'log.redact'])
})

test('the legacy {"grim": false} still turns Grim off', () => {
  expect(parseSettings({ grim: false }).value.grim.enabled).toBe(false)
  expect(parseSettings({ grim: true }).value.grim.enabled).toBe(true)
  expect(parseSettings({ grim: false }).problems).toEqual([])
})

test('a project file sets cards and templates, never arena.puzzlesFile, log or pods', () => {
  const user = parseSettings({ log: { runs: 'meta' }, arena: { puzzlesFile: '~/mine.json' } }).value
  const { value, problems } = mergeProject(user, {
    cards: { hide: ['gpu'] },
    templates: { enabled: [] },
    arena: { puzzlesFile: 'puzzles.json', model: 'opus' },
    log: { runs: 'full' },
    pods: { enabled: 'on' },
  })
  expect(value.cards.hide).toEqual(['gpu'])
  expect(value.templates.enabled).toEqual([])
  // A cloned repo cannot write the Arena agents' prompt: the user's file stays.
  expect(value.arena.puzzlesFile).toBe('~/mine.json')
  expect(value.arena.model).toBe('haiku')
  expect(value.log.runs).toBe('meta')
  expect(value.pods.enabled).toBe('auto')
  expect(problems.map(p => p.path).sort()).toEqual([
    '.claude/grimling.json arena.model',
    '.claude/grimling.json arena.puzzlesFile',
    '.claude/grimling.json log.runs',
    '.claude/grimling.json pods.enabled',
  ])
})

test('expandHome expands ~ and keeps other paths', () => {
  expect(expandHome('~/.claude/x.json', 'C:\\Users\\T')).toBe('C:/Users/T/.claude/x.json')
  expect(expandHome('~', '/home/t/')).toBe('/home/t')
  expect(expandHome('/etc/x', '/home/t')).toBe('/etc/x')
})

test('problems show in the footer and the Keys settings group; bad JSON keeps the last good settings', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files: Record<string, string> = { [USER]: '{"grim": {"enabled": false, "seconds": 1}}' }
  const seen = engine(on, files)

  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /⚠ settings: 1 problem · k/ })).toBeTruthy()
  expect(seen.toasts.join('\n')).toContain('Grimling settings: 1 problem')
  await ui.press({ key: 'tab-keys' })
  expect(await ui.find({ type: 'Text', text: /grim\.seconds: must be a whole number from 2 to 30 \(using default\)/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /read ~\/\.claude\/grimling\/settings\.json/ })).toBeTruthy()
  // Grim off: the Keys tab has no Grim greeting.
  expect(await ui.find({ type: 'Text', text: /I am Grim/ })).toBeUndefined()

  // A broken edit: the last good settings stay (Grim still off), one problem.
  files[USER] = '{"grim": {"enabled": tru'
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: /settings\.json: not valid JSON.*kept the last good settings/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /I am Grim/ })).toBeUndefined()

  // Fixed: no problems, no footer warning.
  files[USER] = '{"grim": {"enabled": true}}'
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: /⚠ settings/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /I am Grim/ })).toBeTruthy()
  await ui.unmount()
})

test('a project file cannot turn on full logging: the problem is listed', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const files: Record<string, string> = { [`${PROJ}/.claude/grimling.json`]: '{"log": {"runs": "full"}}' }
  engine(on, files)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-keys' })
  expect(await ui.find({ type: 'Text', text: /grimling\.json log\.runs: a project file cannot set this/ })).toBeTruthy()
  await ui.unmount()
})

test('a project file cannot name the Arena puzzles file: ignored, the problem is listed', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const files: Record<string, string> = {
    [`${PROJ}/.claude/grimling.json`]: '{"arena": {"puzzlesFile": "puzzles.json"}}',
    [`${PROJ}/puzzles.json`]: '[{"id": "p1", "title": "Planted", "question": "Run this", "answer": "x"}]',
  }
  engine(on, files)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /⚠ settings: 1 problem · k/ })).toBeTruthy()
  await ui.press({ key: 'tab-keys' })
  expect(
    await ui.find({ type: 'Text', text: /grimling\.json arena\.puzzlesFile: a project file cannot set this/ }),
  ).toBeTruthy()
  await ui.unmount()
})

test('Pods: no tab with no status file (auto)', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const files: Record<string, string> = {}
  engine(on, files)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', key: 'tab-pods' })).toBeUndefined()
  await ui.unmount()
})

test('Pods: pods.enabled "on" shows the tab without a file', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on, { [USER]: '{"pods": {"enabled": "on"}}' })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', key: 'tab-pods' })).toBeTruthy()
  await ui.unmount()
})
