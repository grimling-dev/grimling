// Burn forecast for the plan-limit rows: recent readings of one window,
// the rate they rise at, and when that rate reaches 100%. Pure, like time.ts.

export type BurnSample = { at: number; pct: number }

const MAX_SAMPLES = 30

// Adds a reading to a window's recent samples. A drop of more than half a
// point is a new window (it reset): the samples start over. A reading equal
// to the last one adds nothing, but still drops the old ones before it (the
// last stays, as the point a reset is told from). Samples older than keepMs
// are dropped.
export function addSample(prev: readonly BurnSample[], s: BurnSample, keepMs = 20 * 60_000): BurnSample[] {
  const last = prev.at(-1)
  if (last && s.pct < last.pct - 0.5) return [s]
  if (last && s.pct === last.pct) return prev.filter(p => p === last || p.at >= s.at - keepMs)
  return [...prev, s].filter(p => p.at >= s.at - keepMs).slice(-MAX_SAMPLES)
}

// Points per minute from the oldest sample to the newest; null when they
// span less than minSpanMs or rose less than minRise points.
export function burnRate(samples: readonly BurnSample[], minSpanMs = 3 * 60_000, minRise = 1): number | null {
  const first = samples[0]
  const last = samples.at(-1)
  if (!first || !last) return null
  const span = last.at - first.at
  const rise = last.pct - first.pct
  if (span < minSpanMs || rise < minRise) return null
  return rise / (span / 60_000)
}

// When (epoch ms) the window reaches 100% at perMin points a minute from
// pct at `now`; null with no rising rate, at or past 100%, more than ten
// hours out, or when the window resets first.
export function etaAt(pct: number, perMin: number | null, now: number, resetsAt?: string): number | null {
  if (!perMin || perMin <= 0 || pct >= 100) return null
  const minutes = (100 - pct) / perMin
  if (minutes > 600) return null
  const eta = now + minutes * 60_000
  if (resetsAt) {
    const reset = Date.parse(resetsAt)
    if (Number.isFinite(reset) && eta >= reset) return null
  }
  return eta
}

// A time to go, in whole minutes rounded up: `~45m`, `~1m` at least,
// `~2h`, `~2h 10m`.
export function fmtEta(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000))
  if (mins < 60) return `~${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `~${h}h ${m}m` : `~${h}h`
}
