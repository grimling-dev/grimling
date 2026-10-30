import { expect, test } from 'claude-code/testing'

import { addSample, burnRate, etaAt, fmtEta } from '../hooks/burn'

// The burn forecast on the plan-limit rows: samples, rate, when 100% comes.

const T = Date.UTC(2026, 9, 29, 12, 0)
const MIN = 60_000

test('addSample: a drop of more than half a point starts over; old and equal readings are not kept', () => {
  const two = addSample(addSample([], { at: T, pct: 40 }), { at: T + MIN, pct: 41 })
  expect(two).toEqual([{ at: T, pct: 40 }, { at: T + MIN, pct: 41 }])
  // Equal to the last: nothing added.
  expect(addSample(two, { at: T + 2 * MIN, pct: 41 })).toEqual(two)
  // A small dip (rounding) is kept; a real drop is a new window.
  expect(addSample(two, { at: T + 2 * MIN, pct: 40.6 })).toHaveLength(3)
  expect(addSample(two, { at: T + 2 * MIN, pct: 3 })).toEqual([{ at: T + 2 * MIN, pct: 3 }])
  // Equal to the last, much later: the old ones go, the last stays.
  expect(addSample(two, { at: T + 20.5 * MIN, pct: 41 })).toEqual([{ at: T + MIN, pct: 41 }])
  expect(addSample(two, { at: T + 30 * MIN, pct: 41 })).toEqual([{ at: T + MIN, pct: 41 }])
  // Older than 20 minutes: dropped.
  expect(addSample(two, { at: T + 20.5 * MIN, pct: 50 })).toEqual([{ at: T + MIN, pct: 41 }, { at: T + 20.5 * MIN, pct: 50 }])
  // At most 30 samples.
  let many: { at: number; pct: number }[] = []
  for (let i = 0; i < 40; i++) many = addSample(many, { at: T + i * 1000, pct: i })
  expect(many).toHaveLength(30)
  expect(many[0]).toEqual({ at: T + 10_000, pct: 10 })
})

test('burnRate: points a minute; null under a 3 minute span or under a point of rise', () => {
  expect(burnRate([])).toBeNull()
  expect(burnRate([{ at: T, pct: 40 }])).toBeNull()
  expect(burnRate([{ at: T, pct: 40 }, { at: T + 2 * MIN, pct: 44 }])).toBeNull()
  expect(burnRate([{ at: T, pct: 40 }, { at: T + 10 * MIN, pct: 40.5 }])).toBeNull()
  expect(burnRate([{ at: T, pct: 40 }, { at: T + 2 * MIN, pct: 42 }, { at: T + 4 * MIN, pct: 44 }])).toBe(1)
})

test('etaAt: when 100% comes, or null when the reset comes first, at 100% or with no rise', () => {
  const reset = new Date(T + 3 * 60 * MIN).toISOString()
  expect(etaAt(44, 1, T, reset)).toBe(T + 56 * MIN)
  expect(etaAt(44, 1, T)).toBe(T + 56 * MIN)
  expect(etaAt(44, 0.25, T, reset)).toBeNull()
  expect(etaAt(100, 1, T, reset)).toBeNull()
  expect(etaAt(104, 1, T)).toBeNull()
  expect(etaAt(44, 0, T, reset)).toBeNull()
  expect(etaAt(44, -1, T, reset)).toBeNull()
  expect(etaAt(44, null, T, reset)).toBeNull()
  // More than ten hours out.
  expect(etaAt(10, 0.1, T)).toBeNull()
})

test('fmtEta: whole minutes rounded up, hours past 60', () => {
  expect(fmtEta(0.4 * MIN)).toBe('~1m')
  expect(fmtEta(0)).toBe('~1m')
  expect(fmtEta(45 * MIN)).toBe('~45m')
  expect(fmtEta(60 * MIN)).toBe('~1h')
  expect(fmtEta(130 * MIN)).toBe('~2h 10m')
})
