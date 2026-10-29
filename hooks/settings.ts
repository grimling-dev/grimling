import type { SettingProblem, Settings } from '../types'

// Grimling's settings: one optional JSON file, ~/.claude/grimling/settings.json,
// every key with a default (a fresh user needs no file). Pure functions, like
// arena.ts: parse and validate, merge the project file, expand `~`.
//
// A bad field falls back to its default with a problem; the pane shows the
// problems (footer and the Keys tab). The schema for editors ships as
// schema/settings.schema.json; keep the two in step.

export const DEFAULTS: Settings = {
  time: { zone: 'system', clock: '24h', showUtc: false },
  grim: { enabled: true, seconds: 8, lines: { done: [], failed: [], killed: [] } },
  notify: { toast: true, desktop: false, events: ['done', 'failed', 'killed'] },
  cards: { builtins: true, pack: true, user: true, project: true, packs: [], hide: [] },
  templates: { enabled: ['swarm'] },
  // Pods is not part of v0.1.0 and undocumented: `auto` shows the tab only
  // while a status file matches.
  pods: { enabled: 'auto', files: ['~/.claude/grimling/pods/*.json'], staleAfterS: null },
  arena: { model: 'haiku', puzzlesFile: null },
  log: {
    runs: 'redacted',
    promptChars: 6000,
    answerChars: 1500,
    maxBytes: 2 * 1024 * 1024,
    keepDays: 30,
    redact: [],
    debug: 'errors',
  },
  meter: { sessionsFile: null },
  agentDex: { rulesBlock: null, afterSave: null },
  feedback: { repo: 'grimling-dev/grimling', nudge: true },
  stop: { enabled: true },
}

// The keys a project's `.claude/grimling.json` may set: a cloned repo is not
// trusted, so never log, notify, pods or meter. Nor arena.puzzlesFile: a
// puzzle's question is the whole prompt of two Arena agents, so only the
// user's own settings may name that file.
export const PROJECT_KEYS = ['cards', 'templates'] as const

export type Parsed = { value: Settings; problems: SettingProblem[] }

type Json = unknown
type Check = (v: Json) => string | null

const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v)

const bool: Check = v => (typeof v === 'boolean' ? null : 'must be true or false')
const oneOf =
  (...xs: string[]): Check =>
  v =>
    typeof v === 'string' && xs.includes(v) ? null : `must be one of ${xs.map(x => `"${x}"`).join(', ')}`
const int =
  (min: number, max: number): Check =>
  v =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? null : `must be a whole number from ${min} to ${max}`
const text =
  (max: number, nullable = false): Check =>
  v =>
    (nullable && v === null) || (typeof v === 'string' && v.length <= max)
      ? null
      : `must be ${nullable ? 'null or ' : ''}text of at most ${max} characters`
const list =
  (each: Check, max = 100): Check =>
  v => {
    if (!Array.isArray(v)) return 'must be a list'
    if (v.length > max) return `must have at most ${max} entries`
    for (const [i, x] of v.entries()) {
      const bad = each(x)
      if (bad) return `entry ${i + 1} ${bad}`
    }
    return null
  }
const zone: Check = v => {
  if (v === 'system') return null
  if (typeof v !== 'string' || !v) return 'must be "system" or a time zone name such as "Europe/Berlin"'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return null
  } catch {
    return `"${v}" is not a time zone this runtime knows`
  }
}
// Grim's lines may use only {name}, {type}, {duration} and {task}.
const grimLine: Check = v => {
  if (typeof v !== 'string' || v.length > 120) return 'must be text of at most 120 characters'
  const bad = [...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).find(k => !['name', 'type', 'duration', 'task'].includes(k ?? ''))
  return bad ? `uses {${bad}}; only {name} {type} {duration} {task}` : null
}
const regex: Check = v => {
  if (typeof v !== 'string' || !v || v.length > 300) return 'must be a regular expression of at most 300 characters'
  try {
    new RegExp(v, 'g')
    return null
  } catch {
    return `"${v.slice(0, 40)}" is not a valid regular expression`
  }
}
const pack: Check = v => {
  if (!isObj(v) || typeof v.path !== 'string' || !v.path) return 'must be { "path": "...", "ns"?: "..." }'
  if (v.ns !== undefined && (typeof v.ns !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(v.ns))) return '"ns" must be a plugin name'
  return null
}
const repo: Check = v =>
  typeof v === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v) ? null : 'must be "owner/repo"'
const nullablePosInt: Check = v => (v === null ? null : int(1, 86400)(v) && 'must be null or a whole number of seconds')
const path = (v: Json) => text(1000, true)(v)

// Every leaf key, dotted, and its check.
const CHECKS: Record<string, Check> = {
  'time.zone': zone,
  'time.clock': oneOf('12h', '24h'),
  'time.showUtc': bool,
  'grim.enabled': bool,
  'grim.seconds': int(2, 30),
  'grim.lines.done': list(grimLine, 20),
  'grim.lines.failed': list(grimLine, 20),
  'grim.lines.killed': list(grimLine, 20),
  'notify.toast': bool,
  'notify.desktop': bool,
  'notify.events': list(oneOf('done', 'failed', 'killed'), 3),
  'cards.builtins': bool,
  'cards.pack': bool,
  'cards.user': bool,
  'cards.project': bool,
  'cards.packs': list(pack, 20),
  'cards.hide': list(text(100)),
  'templates.enabled': list(text(60)),
  'pods.enabled': oneOf('auto', 'on', 'off'),
  'pods.files': list(text(1000), 20),
  'pods.staleAfterS': nullablePosInt,
  'arena.model': text(100),
  'arena.puzzlesFile': path,
  'log.runs': oneOf('full', 'redacted', 'meta', 'off'),
  'log.promptChars': int(0, 100000),
  'log.answerChars': int(0, 100000),
  'log.maxBytes': int(64 * 1024, 3 * 1024 * 1024),
  'log.keepDays': int(1, 3650),
  'log.redact': list(regex, 50),
  'log.debug': oneOf('all', 'errors', 'off'),
  'meter.sessionsFile': path,
  'agentDex.rulesBlock': text(4000, true),
  'agentDex.afterSave': text(4000, true),
  'feedback.repo': repo,
  'feedback.nudge': bool,
  'stop.enabled': bool,
}

// Every leaf key, dotted, in file order (for /grimling-setup show).
export const SETTING_KEYS = Object.keys(CHECKS)

// One dotted key's value in an object (undefined when absent).
export function getKey(obj: Json, dotted: string): Json {
  return get(obj, dotted)
}

// Sets one dotted key in a plain object, making the branches it needs.
export function setKey(obj: Record<string, Json>, dotted: string, value: Json) {
  set(obj, dotted, value)
}

// Whether a project's `.claude/grimling.json` may set this key.
export function isProjectKey(key: string): boolean {
  return PROJECT_KEYS.some(p => key === p || key.startsWith(`${p}.`))
}

function get(obj: Json, dotted: string): Json {
  let cur: Json = obj
  for (const k of dotted.split('.')) {
    if (!isObj(cur)) return undefined
    cur = cur[k]
  }
  return cur
}

function set(obj: Record<string, Json>, dotted: string, value: Json) {
  const keys = dotted.split('.')
  let cur: Record<string, Json> = obj
  for (const k of keys.slice(0, -1)) {
    const next = cur[k]
    if (!isObj(next)) cur[k] = {}
    cur = cur[k] as Record<string, Json>
  }
  cur[keys[keys.length - 1] ?? ''] = value
}

// Keys in `raw` that no check knows (typos), as dotted paths; `$schema` is fine.
function unknownKeys(raw: Record<string, Json>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(raw)) {
    const at = prefix ? `${prefix}.${k}` : k
    if (!prefix && k === '$schema') continue
    if (at in CHECKS) continue
    const isBranch = Object.keys(CHECKS).some(c => c.startsWith(`${at}.`))
    if (isBranch && isObj(v)) out.push(...unknownKeys(v, at))
    else out.push(at)
  }
  return out
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// Reads a parsed settings object: every known key checked, a bad one kept at
// its default with a problem. `{"grim": false}` (the v0.4 form) still means
// grim.enabled false. `raw` that is not an object gives the defaults.
export function parseSettings(raw: Json, file = 'settings.json'): Parsed {
  const problems: SettingProblem[] = []
  const value = clone(DEFAULTS) as unknown as Record<string, Json>
  if (raw === undefined || raw === null) return { value: value as unknown as Settings, problems }
  if (!isObj(raw)) {
    problems.push({ path: file, message: 'must be a JSON object (using the defaults)' })
    return { value: value as unknown as Settings, problems }
  }
  let input: Record<string, Json> = raw
  if (typeof raw.grim === 'boolean') {
    // Legacy switch: {"grim": false}.
    input = { ...raw, grim: { enabled: raw.grim } }
  }
  for (const [key, check] of Object.entries(CHECKS)) {
    const v = get(input, key)
    if (v === undefined) continue
    const bad = check(v)
    if (bad) problems.push({ path: key, message: `${bad} (using default)` })
    else set(value, key, clone(v))
  }
  for (const k of unknownKeys(input)) problems.push({ path: k, message: 'unknown key (ignored)' })
  return { value: value as unknown as Settings, problems }
}

// Lays a project's `.claude/grimling.json` over the user's settings: only the
// PROJECT_KEYS; anything else is ignored with a problem.
export function mergeProject(user: Settings, raw: Json, file = '.claude/grimling.json'): Parsed {
  const problems: SettingProblem[] = []
  const value = clone(user)
  if (raw === undefined || raw === null) return { value, problems }
  if (!isObj(raw)) return { value, problems: [{ path: file, message: 'must be a JSON object (ignored)' }] }
  const allowed = isProjectKey
  for (const [key, check] of Object.entries(CHECKS)) {
    const v = get(raw, key)
    if (v === undefined) continue
    if (!allowed(key)) {
      problems.push({ path: `${file} ${key}`, message: 'a project file cannot set this (ignored)' })
      continue
    }
    const bad = check(v)
    if (bad) problems.push({ path: `${file} ${key}`, message: `${bad} (ignored)` })
    else set(value as unknown as Record<string, Json>, key, clone(v))
  }
  for (const k of unknownKeys(raw)) {
    if (!(k in CHECKS)) problems.push({ path: `${file} ${k}`, message: 'unknown key (ignored)' })
  }
  return { value, problems }
}

// `~` or `~/x` under the user's home; other paths as written, with forward slashes.
export function expandHome(p: string, home: string): string {
  const h = home.replaceAll('\\', '/').replace(/\/$/, '')
  const s = p.replaceAll('\\', '/')
  if (s === '~') return h
  if (s.startsWith('~/')) return `${h}${s.slice(1)}`
  return s
}

// One problem line as the Keys tab shows it.
export function problemLine(p: SettingProblem): string {
  return `${p.path}: ${p.message}`
}
