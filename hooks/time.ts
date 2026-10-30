import type { Settings } from '../types'

// Clock times as the user's settings want them: their zone (or the system's),
// a 12 or 24 hour clock, and the UTC time beside it when time.showUtc is on.
// Pure, like arena.ts; replaces the old fixed US Eastern helpers.

export type TimeSettings = Settings['time']

// The zone to show: the setting, else the system's (Intl, then TZ), else UTC.
// A zone this runtime does not know falls back to the system's.
export function zoneOf(t: TimeSettings, env: { TZ?: string } = {}): string {
  const known = (z: string | undefined) => {
    if (!z) return false
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: z })
      return true
    } catch {
      return false
    }
  }
  if (t.zone !== 'system' && known(t.zone)) return t.zone
  const sys = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return undefined
    }
  })()
  if (known(sys)) return sys as string
  if (known(env.TZ)) return env.TZ as string
  return 'UTC'
}

const isUtc = (z: string) => /^(utc|etc\/utc|gmt|etc\/gmt|z)$/i.test(z)

// `HH:MM` in UTC with a Z, as the pod watcher writes it.
function utcHm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`
}

// A time in the user's zone and clock with the zone's short name
// (`23:15 EDT`, `11:15 PM EDT`, `Thu 23:15 EDT` with the weekday), and the
// UTC time first when time.showUtc is on: `03:15Z (23:15 EDT)`.
export function fmtTime(ms: number, t: TimeSettings, opts: { weekday?: boolean; env?: { TZ?: string } } = {}): string {
  if (!Number.isFinite(ms)) return ''
  const zone = zoneOf(t, opts.env)
  if (isUtc(zone)) return `${opts.weekday ? `${new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' })} ` : ''}${utcHm(ms)}`
  let local: string
  try {
    local = new Date(ms).toLocaleString('en-US', {
      timeZone: zone,
      ...(opts.weekday ? { weekday: 'short' as const } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: t.clock === '12h' ? 'h12' : 'h23',
      timeZoneName: 'short',
    })
  } catch {
    return utcHm(ms)
  }
  local = local.replace(',', '')
  return t.showUtc ? `${utcHm(ms)} (${local})` : local
}

// The pod watcher's kill-by time: bare UTC `HH:MM` (on the day of `now`) or
// a full ISO time; anything else is shown as written.
export function killBy(deadline: string, now: number, t: TimeSettings): string {
  const hm = /^(\d{1,2}):(\d{2})$/.exec(deadline.trim())
  let at = Date.parse(deadline)
  if (hm) {
    const d = new Date(now)
    d.setUTCHours(Number(hm[1]), Number(hm[2]), 0, 0)
    at = d.getTime()
  }
  return Number.isFinite(at) ? fmtTime(at, t) : deadline
}

// A plan limit's reset time (ISO), with the weekday.
export function resetTime(iso: string, t: TimeSettings): string {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? fmtTime(at, t, { weekday: true }) : ''
}

export type Limit = { kind: string; pct: number; resetsAt?: string; reset?: boolean; eta?: number; etaFrom?: number }

// Plan limits across a reset: the host may drop a window from
// its reading once that window resets, until the next response reports it.
// A window seen before stays: at 0% marked `reset` once its reset time has
// passed, as last read before then. A window still reported with a reset
// time in the past also reads 0%.
export function carryLimits(prev: readonly Limit[], fresh: readonly Limit[], now: number): Limit[] {
  const passed = (l: Limit) => !!l.resetsAt && Date.parse(l.resetsAt) <= now
  const out: Limit[] = fresh.map(l => (passed(l) ? { kind: l.kind, pct: 0, reset: true } : { ...l }))
  for (const l of prev) {
    if (out.some(f => f.kind === l.kind)) continue
    out.push(l.reset || passed(l) ? { kind: l.kind, pct: 0, reset: true } : { ...l })
  }
  // The host's order: five_hour before seven_day.
  const order = ['five_hour', 'seven_day', 'seven_day_opus']
  const at = (k: string) => (order.indexOf(k) < 0 ? order.length : order.indexOf(k))
  return out.sort((a, b) => at(a.kind) - at(b.kind))
}
