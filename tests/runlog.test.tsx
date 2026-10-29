import { expect, test } from 'claude-code/testing'
import { envHome, HOME, PROJ, slash } from './paths'
import type { AgentSpawnInput } from 'claude-code'

import { DEFAULTS } from '../hooks/settings'
import { debugWanted, expiredFiles, keptFiles, redact, shapeRow } from '../hooks/runlog'

// The run log: log.runs modes, built-in redaction, caps, day files that a
// size-refused read can never wipe, keepDays, and the debug level.

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const RUNS = `${HOME}/.claude/grimling/runs`
const TODAY = `${RUNS}/1970-01-01.jsonl`
const USER = `${HOME}/.claude/grimling/settings.json`
const LOG = DEFAULTS.log

const SECRETS = [
  'use sk-ant-api03-abcdefghijklmnopqrstuv',
  'token ghp_abcdefghijklmnopqrstuvwxyz0123',
  'aws AKIAABCDEFGHIJKLMNOP',
  'Authorization: Bearer abc.def.ghi-jkl',
  'OPENAI_API_KEY=sk-live-1234567890abcdef',
  'password: hunter22',
  '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
].join('\n')

// Files are a map; `tooBig` paths refuse a read the way the engine refuses
// one over 4 MiB, while they exist.
function engine(on: On, files: Record<string, string>, tooBig: Set<string> = new Set()) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', (_, e) => {
    const dir = `${slash(e.path)}/`
    const names = Object.keys(files)
      .filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
      .map(p => p.slice(dir.length))
    return { value: names.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const p = slash(e.path)
    if (tooBig.has(p)) throw new Error('EFBIG: file is larger than 4194304 bytes')
    if (p in files) return { value: files[p] ?? '' }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    files[slash(e.path)] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slash(e.path) in files || tooBig.has(slash(e.path)) }))
}

// The Agent tool's spawn as the engine raises it.
const spawn = (prompt: string, subagentType: string, description: string): AgentSpawnInput => ({
  tool_use_id: 'tu1',
  prompt,
  description,
  subagentType,
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'test',
  background: false,
  fork: false,
})

const settle = () => new Promise(resolve => setTimeout(resolve, 60))

test('redacted mode replaces keys, tokens and private keys; the home folder becomes ~', () => {
  // A Windows home in both spellings, on every platform: redact is pure.
  const out = redact(`${SECRETS}\nsee C:\\Users\\T\\notes and C:/Users/T/x`, [], 'C:/Users/T')
  for (const leak of ['sk-ant-api03', 'ghp_abc', 'AKIAABCD', 'abc.def.ghi', 'sk-live', 'hunter22', 'MIIEow', 'C:/Users/T', 'C:\\Users\\T']) {
    expect(out).not.toContain(leak)
  }
  expect(out).toContain('OPENAI_API_KEY=[redacted]')
  expect(out).toContain('Bearer [redacted]')
  expect(out).toContain('~/x')
  // Ordinary words are left alone.
  expect(redact('the monkey: banana and a primary key: id', [], HOME)).toBe('the monkey: banana and a primary key: id')
})

test('the home folder becomes ~ in every Windows spelling: case, slashes, Git Bash, 8.3 short name', () => {
  const home = 'C:/Users/T'
  const cases: [string, string][] = [
    ['C:\\Users\\T\\notes.txt', '~\\notes.txt'],
    ['c:/users/t/notes.txt', '~/notes.txt'],
    ['C:\\USERS\\T\\x', '~\\x'],
    ['/c/Users/T/repo', '~/repo'],
    ['/C/users/t', '~'],
    ['C:\\\\Users\\\\T\\\\x (JSON-escaped)', '~\\\\x (JSON-escaped)'],
    ['C:\\Users\\T~1\\AppData\\Local\\Temp', '~\\AppData\\Local\\Temp'],
    ['/c/Users/T~1/AppData', '~/AppData'],
    ['D:/users/t~2/x', '~/x'],
  ]
  for (const [text, want] of cases) expect(redact(`at ${text}`, [], home)).toBe(`at ${want}`)
  // Not a longer name that starts with the same letters, not another user.
  expect(redact('C:/Users/T.old/x', [], home)).toBe('C:/Users/T.old/x')
  expect(redact('c:\\users\\sam\\x', [], home)).toBe('c:\\users\\sam\\x')
})

test('a Linux or macOS home keeps its case and does not match a longer name', () => {
  expect(redact('in /home/t/src and /home/t.old', [], '/home/t')).toBe('in ~/src and /home/t.old')
  expect(redact('/Home/T/src', [], '/home/t')).toBe('/Home/T/src')
  expect(redact('/Users/T/Library', [], '/Users/T/')).toBe('~/Library')
})

test('shapeRow writes the cwd with ~ for a lower-case or 8.3 home', () => {
  const lower = shapeRow({ kind: 'spawn', cwd: 'c:/users/t/proj' }, LOG, 'C:/Users/T')
  expect(lower.cwd).toBe('~/proj')
  const short = shapeRow({ kind: 'spawn', cwd: 'C:\\Users\\T~1\\proj' }, LOG, 'C:/Users/T')
  expect(short.cwd).toBe('~\\proj')
})

test('log.redact adds patterns on top of the built-in list', () => {
  expect(redact('ticket ACME-4411 is open', ['ACME-\\d+'])).toBe('ticket [redacted] is open')
})

test('meta keeps no prompt, answer, task or cwd; off keeps nothing; full only caps', () => {
  const row = { kind: 'spawn', agentId: 'a1', type: 'Explore', prompt: SECRETS, description: 'find auth', cwd: `${HOME}/proj` }
  const meta = shapeRow(row, { ...LOG, runs: 'meta' }, HOME)
  expect(meta).toEqual({ kind: 'spawn', agentId: 'a1', type: 'Explore', promptChars: SECRETS.length, descriptionChars: 9 })
  expect(shapeRow(row, { ...LOG, runs: 'off' }, HOME)).toBeNull()
  const full = shapeRow({ ...row, prompt: 'x'.repeat(50) }, { ...LOG, runs: 'full', promptChars: 10 }, HOME)
  expect(full?.prompt).toBe('xxxxxxxxxx…[+40]')
  expect(full?.cwd).toBe(`${HOME}/proj`)
  const red = shapeRow(row, LOG, HOME)
  expect(String(red?.prompt)).not.toContain('hunter22')
  expect(red?.cwd).toBe('~/proj')
})

test('arena rows: each side is shaped too', () => {
  const row = { kind: 'arena', red: { card: 'scout', answer: 'password: hunter22' }, blue: { card: 'builder', answer: '5' } }
  const meta = shapeRow(row, { ...LOG, runs: 'meta' }, HOME)
  expect(JSON.stringify(meta)).not.toContain('hunter22')
  expect(JSON.stringify(shapeRow(row, LOG, HOME))).not.toContain('hunter22')
})

test('keepDays: only day files inside the window are read, newest first', () => {
  const now = Date.UTC(2026, 9, 29, 12)
  const names = ['2026-10-29.jsonl', '2026-10-29.2.jsonl', '2026-10-28.jsonl', '2026-09-01.jsonl', 'notes.txt']
  expect(keptFiles(names, now, 2)).toEqual(['2026-10-29.2.jsonl', '2026-10-29.jsonl', '2026-10-28.jsonl'])
  expect(expiredFiles(names, now, 2)).toEqual(['2026-09-01.jsonl'])
})

test('the debug level: errors keeps errors and load lines, not presses', () => {
  expect(debugWanted('press', 'errors')).toBe(false)
  expect(debugWanted('press.error', 'errors')).toBe(true)
  expect(debugWanted('dex', 'errors')).toBe(true)
  expect(debugWanted('press', 'all')).toBe(true)
  expect(debugWanted('render.error', 'off')).toBe(false)
})

test('a spawn goes to today\'s day file, redacted by default; the old runs.jsonl is never written', async ($, on) => {
  const legacy = '{"kind":"spawn","agentId":"old","prompt":"old task"}\n'
  const files: Record<string, string> = { [`${HOME}/.claude/grimling/runs.jsonl`]: legacy }
  engine(on, files)
  on('agent.spawn', () => ({ model: 'test', agentId: 'a9' }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn(`Check this. ${SECRETS}`, 'general-purpose', 'check'))
  await settle()
  const day = files[TODAY] ?? ''
  expect(day).toContain('"agentId":"a9"')
  expect(day).toContain('Check this.')
  expect(day).not.toContain('hunter22')
  expect(files[`${HOME}/.claude/grimling/runs.jsonl`]).toBe(legacy)
})

test('log.runs "off" writes nothing; "meta" writes no prompt', async ($, on) => {
  const files: Record<string, string> = { [USER]: '{"log": {"runs": "off"}}' }
  engine(on, files)
  on('agent.spawn', () => ({ model: 'test', agentId: 'a1' }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('secret plan', 'Explore', 'plan'))
  await settle()
  expect(Object.keys(files).filter(p => p.startsWith(RUNS))).toEqual([])
})

test('meta mode: the row has the type and id, not the prompt', async ($, on) => {
  const files: Record<string, string> = { [USER]: '{"log": {"runs": "meta"}}' }
  engine(on, files)
  on('agent.spawn', () => ({ model: 'test', agentId: 'a2' }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('secret plan', 'Explore', 'plan'))
  await settle()
  expect(files[TODAY]).toContain('"agentId":"a2"')
  expect(files[TODAY]).not.toContain('secret plan')
  expect(files[TODAY]).toContain('"promptChars":11')
})

test('a day file the engine refuses to read (over 4 MiB) is never written over: the next part takes the row', async ($, on) => {
  const files: Record<string, string> = {}
  engine(on, files, new Set([TODAY]))
  on('agent.spawn', () => ({ model: 'test', agentId: 'a3' }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('next task', 'Explore', 'next'))
  await settle()
  expect(TODAY in files).toBe(false)
  expect(files[`${RUNS}/1970-01-01.2.jsonl`]).toContain('"agentId":"a3"')
})

test('a full part (log.maxBytes) is kept whole and the row starts the next part', async ($, on) => {
  const big = `${'{"kind":"answer","answer":"' + 'y'.repeat(70_000)}"}\n`
  const files: Record<string, string> = { [USER]: '{"log": {"maxBytes": 65536}}', [TODAY]: big }
  engine(on, files)
  on('agent.spawn', () => ({ model: 'test', agentId: 'a4' }))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn('small', 'Explore', 'small'))
  await settle()
  expect(files[TODAY]).toBe(big)
  expect(files[`${RUNS}/1970-01-01.2.jsonl`]).toContain('"agentId":"a4"')
})

const ring = { component: 'Pane' as const, requestId: 'grimling', element: 'card-scout', origin: { kind: 'person' as const } }

test('the debug log skips focus moves by default (errors)', async ($, on) => {
  const files: Record<string, string> = {}
  engine(on, files)
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.ui.focus(ring)
  await settle()
  const log = files[`${HOME}/.claude/grimling/debug.log`] ?? ''
  expect(log).toContain('session.start')
  expect(log).not.toContain(' focus ')
})

test('the debug log is redacted too: the home folder becomes ~', async ($, on) => {
  const files: Record<string, string> = {}
  engine(on, files)
  await $.session.start({ cwd: `${HOME}/myproj`, surface: 'terminal', isInteractive: true })
  await settle()
  const log = files[`${HOME}/.claude/grimling/debug.log`] ?? ''
  expect(log).toContain('"cwd":"~/myproj"')
  expect(log).not.toContain(HOME)
})

test('stop rows: the reason and message (tool output) are capped and redacted; an answer reason stays', () => {
  const stop = { kind: 'stop', agentId: 'a1', ok: false, reason: `denied: password: hunter22 in ${HOME}/x` }
  const red = shapeRow(stop, LOG, HOME)
  expect(String(red?.reason)).not.toContain('hunter22')
  expect(String(red?.reason)).toContain('~/x')
  expect(shapeRow(stop, { ...LOG, runs: 'meta' }, HOME)).toEqual({ kind: 'stop', agentId: 'a1', ok: false, reasonChars: stop.reason.length })
  const said = shapeRow({ kind: 'stop', ok: true, message: 'token=abcd1234efgh' }, LOG, HOME)
  expect(String(said?.message)).toBe('token=[redacted]')
  // An answer row's reason is why the turn ended, kept in every mode.
  expect(shapeRow({ kind: 'answer', reason: 'answer' }, { ...LOG, runs: 'meta' }, HOME)).toEqual({ kind: 'answer', reason: 'answer' })
})

test('log.debug "all" keeps focus moves', async ($, on) => {
  const files: Record<string, string> = { [USER]: '{"log": {"debug": "all"}}' }
  engine(on, files)
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await $.ui.focus(ring)
  await settle()
  expect(files[`${HOME}/.claude/grimling/debug.log`]).toContain(' focus card-scout')
})

test('log.debug "off" writes no debug log', async ($, on) => {
  const files: Record<string, string> = { [USER]: '{"log": {"debug": "off"}}' }
  engine(on, files)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await settle()
  expect(`${HOME}/.claude/grimling/debug.log` in files).toBe(false)
})

declare global {
  // The test runtime has timers; the mod's lib does not declare them.
  var setTimeout: (fn: (...args: never[]) => void, ms: number) => unknown
}
