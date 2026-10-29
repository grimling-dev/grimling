import type { SettingProblem, Settings } from '../types'
import { DEFAULTS, SETTING_KEYS, getKey, isProjectKey, parseSettings, problemLine, setKey } from './settings'

// /grimling-setup: `check` (problems and files read; the default), `show`
// (effective settings, changed ones marked) and `ask` (a few common settings
// picked in the pane, the exact JSON previewed, then written). Pure functions;
// the mod reads and writes the file. It writes only the user file
// (~/.claude/grimling/settings.json), keeps unknown keys and `$schema`, and
// never overwrites a file it cannot parse.

export type SetupMode = 'check' | 'show' | 'ask'

export const USER_FILE = '~/.claude/grimling/settings.json'

export function modeOf(args: string): SetupMode | null {
  const a = args.trim().toLowerCase()
  if (!a) return 'check'
  return a === 'check' || a === 'show' || a === 'ask' ? a : null
}

export type Choice = { label: string; value: string | boolean }
export type Question = { key: string; label: string; options: Choice[] }

// The settings a new user most likely wants, in the order asked. `local` is
// the computer's zone; `current` the zone now set, offered when it is another.
export function questions(local: string, current = 'system'): Question[] {
  const zones = ['system', local, 'UTC', current].filter((z, i, all) => z && all.indexOf(z) === i)
  const onOff: Choice[] = [
    { label: 'on', value: true },
    { label: 'off', value: false },
  ]
  return [
    { key: 'time.zone', label: 'Time zone', options: zones.map(z => ({ label: z === 'system' ? `system (${local})` : z, value: z })) },
    { key: 'time.clock', label: 'Clock', options: [{ label: '24h', value: '24h' }, { label: '12h', value: '12h' }] },
    { key: 'notify.desktop', label: 'Desktop notifications', options: onOff },
    { key: 'grim.enabled', label: 'Grim the mascot', options: onOff },
    {
      key: 'log.runs',
      label: 'Run log',
      options: ['redacted', 'meta', 'full', 'off'].map(v => ({ label: v, value: v })),
    },
    { key: 'stop.enabled', label: 'Stop button', options: onOff },
  ]
}

export const ASK_KEYS = questions('UTC').map(q => q.key)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// The user file's text read as settings: missing (null), usable, or bad.
export type UserFile = { state: 'missing' } | { state: 'ok'; raw: Record<string, unknown> } | { state: 'bad'; message: string }

export function readUserFile(text: string | null): UserFile {
  if (text === null) return { state: 'missing' }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (err) {
    return { state: 'bad', message: `not valid JSON: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}` }
  }
  return isObj(raw) ? { state: 'ok', raw } : { state: 'bad', message: 'not a JSON object' }
}

export function fixFirst(message: string): string {
  return `${USER_FILE} is ${message}. Fix it first (/grimling-setup check lists the problem); nothing was written.`
}

// The value each asked key has now, from the user file (defaults when absent).
export function currentAnswers(base: string | null): Record<string, string | boolean> {
  const f = readUserFile(base)
  const now = parseSettings(f.state === 'ok' ? f.raw : undefined).value
  const out: Record<string, string | boolean> = {}
  for (const k of ASK_KEYS) {
    const v = getKey(now, k)
    if (typeof v === 'string' || typeof v === 'boolean') out[k] = v
  }
  return out
}

export type Change = { key: string; from: unknown; to: unknown }
export type Plan = { ok: true; changes: Change[]; text: string } | { ok: false; message: string }

// What Write would write: the file as it is (unknown keys, `$schema` and
// order kept) with only the answered keys that differ laid over it. `text`
// is exactly what is written, and what the preview shows.
export function planWrite(base: string | null, answers: Record<string, string | boolean>): Plan {
  const f = readUserFile(base)
  if (f.state === 'bad') return { ok: false, message: fixFirst(f.message) }
  const raw = f.state === 'ok' ? f.raw : {}
  const now = parseSettings(raw).value
  const next = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
  const changes: Change[] = []
  for (const [key, to] of Object.entries(answers)) {
    if (!ASK_KEYS.includes(key)) continue
    // A key in the file is compared as written (a bad value gets replaced);
    // an absent one against its effective value (the default).
    const written = getKey(raw, key)
    const from = written === undefined ? getKey(now, key) : written
    if (same(from, to)) continue
    setKey(next, key, to)
    changes.push({ key, from, to })
  }
  const bad = parseSettings(next).problems.filter(p => changes.some(c => c.key === p.path))
  if (bad.length) return { ok: false, message: bad.map(problemLine).join('; ') }
  return { ok: true, changes, text: `${JSON.stringify(next, null, 2)}\n` }
}

// `check`: the problems and the files read, or how to start a file.
export function checkText(o: { file: UserFile; problems: SettingProblem[]; files: string[] }): string {
  const lines = ['Grimling settings check']
  lines.push(o.files.length ? `Files read: ${o.files.join(', ')}` : 'Files read: none')
  if (o.file.state === 'missing') {
    lines.push(
      `No settings file: all defaults. To start one, run /grimling-setup ask (it shows the JSON before writing), ` +
        `or create ${USER_FILE} with only the keys you want to change (docs/SETTINGS.md).`,
    )
  }
  if (o.file.state === 'bad') lines.push(`${USER_FILE} is ${o.file.message}: the pane keeps the last good settings until it is fixed.`)
  if (!o.problems.length) lines.push('No problems.')
  else {
    lines.push(`${o.problems.length} problem${o.problems.length === 1 ? '' : 's'}:`)
    for (const p of o.problems) lines.push(`- ${problemLine(p)}`)
  }
  return lines.join('\n')
}

const shown = (v: unknown) => {
  const s = JSON.stringify(v) ?? 'null'
  return s.length > 60 ? `${s.slice(0, 59)}…` : s
}

// `show`: every key's effective value; `*` marks one that differs from the
// default, with where it came from.
export function showText(effective: Settings, userRaw: unknown, projRaw: unknown): string {
  // The legacy {"grim": false} counts as grim.enabled.
  const user = isObj(userRaw) && typeof userRaw.grim === 'boolean' ? { ...userRaw, grim: { enabled: userRaw.grim } } : userRaw
  const lines = ['Grimling settings (effective; * = differs from the default)']
  let changed = 0
  for (const key of SETTING_KEYS) {
    const v = getKey(effective, key)
    const d = getKey(DEFAULTS, key)
    if (same(v, d)) {
      lines.push(`  ${key} = ${shown(v)}`)
      continue
    }
    changed++
    const from =
      isProjectKey(key) && same(getKey(projRaw, key), v) ? '.claude/grimling.json' : same(getKey(user, key), v) ? 'settings.json' : 'settings'
    lines.push(`* ${key} = ${shown(v)}  (${from}; default ${shown(d)})`)
  }
  lines.push(changed ? `${changed} changed from the defaults.` : 'All defaults.')
  return lines.join('\n')
}

// One line for each place the pane would otherwise show nothing.
export function emptyHint(kind: 'agents' | 'recent' | 'cards', logRuns: Settings['log']['runs'] = 'redacted'): string {
  if (kind === 'agents') return 'No agents yet: type a task in the launch box above, Enter starts one'
  if (kind === 'cards') return 'Add your own: drop agent files in ~/.claude/agents, or /grimling-setup'
  return logRuns === 'meta' || logRuns === 'off'
    ? `No recent runs: log.runs is "${logRuns}" (keeps no tasks); /grimling-setup ask changes it`
    : 'No runs yet: tasks you launch from the launch box show here to run again'
}
