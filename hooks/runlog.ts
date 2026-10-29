import type { Settings } from '../types'

// The run log: one JSON row a spawn, answer or scored fight, in day files
// ~/.claude/grimling/runs/YYYY-MM-DD.jsonl (YYYY-MM-DD.2.jsonl and on once a
// file reaches log.maxBytes). Pure functions: what a row keeps per log.runs,
// the built-in redaction, file names and sizes.
//
// Why day files: `$.fs.read` refuses a file over 4 MiB. The old single
// runs.jsonl was read, trimmed and written whole; once it passed 4 MiB the
// read failed, the catch started from nothing, and the next write replaced
// the log with one row. A part is capped below the read limit and a part that
// cannot be read is never written over.

export type LogSettings = Settings['log']
export type Row = Record<string, unknown>

// Keys, tokens and secrets the redacted mode replaces, on top of log.redact.
export const BUILTIN_REDACT: { re: RegExp; to: string }[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, to: '[redacted private key]' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: 'Bearer [redacted]' },
  // KEY=value as env files spell it (API_KEY=..., GITHUB_TOKEN: ...).
  {
    re: /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)[^\s"']{4,}\3/g,
    to: '$1$2[redacted]',
  },
  // ...and in any case as config files spell it (api_key: ..., password=...).
  {
    re: /\b(api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|secret|password|passwd|token|auth[_-]?token)(\s*[=:]\s*)(["']?)[^\s"']{4,}\3/gi,
    to: '$1$2[redacted]',
  },
  { re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, to: '[redacted]' },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, to: '[redacted]' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, to: '[redacted]' },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, to: '[redacted]' },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, to: '[redacted]' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, to: '[redacted]' },
]

// The built-in list, then each extra pattern (one that does not compile is
// skipped; parseSettings already reported it).
export function redact(text: string, extra: readonly string[] = [], home = ''): string {
  let out = text
  for (const { re, to } of BUILTIN_REDACT) out = out.replace(re, to)
  for (const src of extra) {
    try {
      out = out.replace(new RegExp(src, 'g'), '[redacted]')
    } catch {
      // not a valid pattern
    }
  }
  if (home) out = homeless(out, home)
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// One or more slashes of either kind (a JSON-escaped path doubles them).
const SEP = '[\\\\/]+'
// The home folder ends there: not inside a longer name (`C:/Users/T` is not
// the start of `C:/Users/T.old`).
const END = '(?![^\\\\/\\s"\'`<>|,;:)\\]}])'
// A Windows 8.3 short name for a folder under Users (`C:\Users\T~1`,
// `/c/Users/T~1`): whoever it is, it is a user's home.
const SHORT_HOME = /(?:\b[A-Za-z]:|\/[A-Za-z](?=[\\/]))[\\/]+Users[\\/]+[^\\/\s"'`~]+~\d[^\\/\s"'`]*/gi

// The user's home folder written as `~`: either slash style, any case on
// Windows (`c:/users/t`), the Git Bash form (`/c/Users/T`) and the 8.3 short
// name.
export function homeless(text: string, home: string): string {
  const fwd = home.replaceAll('\\', '/').replace(/\/+$/, '')
  if (fwd.length < 3) return text
  const parts = fwd.split('/').filter(Boolean)
  const drive = /^[A-Za-z]:$/.test(parts[0] ?? '')
  const forms: string[] = []
  if (drive) {
    forms.push(parts.map(escapeRe).join(SEP))
    // Git Bash: the drive letter as a folder
    forms.push(`/${escapeRe((parts[0] ?? '').slice(0, 1))}${SEP}${parts.slice(1).map(escapeRe).join(SEP)}`)
  } else {
    forms.push(`${SEP}${parts.map(escapeRe).join(SEP)}`)
  }
  // Windows paths are not case-sensitive; elsewhere the case is kept.
  const re = new RegExp(`(?:${forms.join('|')})${END}`, drive ? 'gi' : 'g')
  return text.replace(re, '~').replace(SHORT_HOME, '~')
}

// Any user's home folder, whatever the home value (feedback leaves the
// computer, so it gets this too): a Users folder on any drive, in Git Bash
// and on macOS, and /home (only at the start of a word, so a URL's /home
// path stays).
const ANY_HOME = /(?:\b[A-Za-z]:[\\/]+Users|(?<![^\s"'`(=])(?:\/[A-Za-z]\/Users|\/Users|\/home))[\\/]+[^\\/\s"'`<>|]+/gi

export function anyHomeless(text: string): string {
  return text.replace(ANY_HOME, '~')
}

function cap(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…[+${text.length - n}]` : text
}

// The free-text fields of a row and how many characters each may keep.
// A stop row's `reason` and `message` are tool output; an answer row's
// `reason` is only why the turn ended, so it is kept as it is.
const TEXT_FIELDS = (log: LogSettings, kind: unknown): Record<string, number> => ({
  prompt: log.promptChars,
  answer: log.answerChars,
  description: 200,
  message: 300,
  ...(kind === 'stop' ? { reason: 300 } : {}),
})

// What a row keeps under log.runs: null for `off`; `meta` drops every
// free-text field (prompt, answer, task, cwd) and keeps their lengths;
// `redacted` caps and redacts them; `full` caps them only.
export function shapeRow(row: Row, log: LogSettings, home = ''): Row | null {
  if (log.runs === 'off') return null
  const caps = TEXT_FIELDS(log, row.kind)
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'red' || k === 'blue') {
      out[k] = typeof v === 'object' && v !== null ? shapeRow(v as Row, { ...log, runs: log.runs }, home) : v
      continue
    }
    const limit = caps[k]
    if (k === 'cwd' && typeof v === 'string') {
      if (log.runs === 'meta') continue
      out[k] = log.runs === 'redacted' ? homeless(v, home) : v
      continue
    }
    if (limit === undefined || typeof v !== 'string') {
      out[k] = v
      continue
    }
    if (log.runs === 'meta') {
      out[`${k}Chars`] = v.length
      continue
    }
    const kept = cap(v, limit)
    out[k] = log.runs === 'redacted' ? redact(kept, log.redact, home) : kept
  }
  return out
}

// `YYYY-MM-DD` of a time, in UTC (one day file per UTC day).
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// The file name of a day's part: part 1 is `YYYY-MM-DD.jsonl`.
export function partName(day: string, part: number): string {
  return part <= 1 ? `${day}.jsonl` : `${day}.${part}.jsonl`
}

// A run file name's day and part, or null for any other file.
export function parsePart(name: string): { day: string; part: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/.exec(name)
  if (!m?.[1]) return null
  return { day: m[1], part: m[2] ? Number(m[2]) : 1 }
}

// Run files inside the keepDays window, newest first (later parts of a day first).
export function keptFiles(names: readonly string[], now: number, keepDays: number): string[] {
  const oldest = dayOf(now - (keepDays - 1) * 86_400_000)
  return names
    .map(n => ({ n, p: parsePart(n) }))
    .filter((x): x is { n: string; p: { day: string; part: number } } => !!x.p && x.p.day >= oldest)
    .sort((a, b) => (a.p.day === b.p.day ? b.p.part - a.p.part : a.p.day < b.p.day ? 1 : -1))
    .map(x => x.n)
}

// Run files past keepDays: no longer read. (The mod API has no delete, so
// they stay on disk until the user removes them.)
export function expiredFiles(names: readonly string[], now: number, keepDays: number): string[] {
  const kept = new Set(keptFiles(names, now, keepDays))
  return names.filter(n => parsePart(n) && !kept.has(n))
}

// UTF-8 size of a string, without TextEncoder.
export function utf8Bytes(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

// Which debug lines a log.debug level writes: `all` every line; `errors`
// errors and the one-per-load summaries (session start, dex counts).
export function debugWanted(what: string, level: LogSettings['debug']): boolean {
  if (level === 'all') return true
  if (level === 'off') return false
  return /error|failed|denied/.test(what) || what === 'session.start' || what === 'dex'
}
