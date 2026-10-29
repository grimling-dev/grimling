import { expect, test } from 'claude-code/testing'

import { CHALLENGES, isCorrect, parsePuzzles, withPuzzles } from '../hooks/arena'
import { carryLimits, fmtTime, killBy, resetTime, zoneOf } from '../hooks/time'

// Times as time.* in settings.json says (zone, 12/24 h clock, UTC beside it),
// and the Arena's puzzles file.

const AT = Date.UTC(2026, 9, 29, 3, 15) // 2026-10-29 03:15Z = 23:15 EDT the day before
const t = (zone: string, clock: '12h' | '24h' = '24h', showUtc = false) => ({ zone, clock, showUtc })

test('UTC, Asia/Tokyo and a 12 hour Toronto clock', () => {
  expect(fmtTime(AT, t('UTC'))).toBe('03:15Z')
  expect(fmtTime(AT, t('Asia/Tokyo'))).toMatch(/^12:15 (GMT\+9|JST)$/)
  expect(fmtTime(AT, t('America/Toronto', '12h'))).toBe('11:15 PM EDT')
  expect(fmtTime(AT, t('America/Toronto', '24h', true))).toBe('03:15Z (23:15 EDT)')
})

test('a zone the runtime does not know falls back to the system zone', () => {
  expect(zoneOf(t('Mars/Olympus'))).toBe(zoneOf(t('system')))
  expect(fmtTime(AT, t('Mars/Olympus'))).toBe(fmtTime(AT, t('system')))
})

test('kill-by: bare UTC HH:MM and ISO times; anything else as written', () => {
  const ny = t('America/Toronto')
  const now = Date.UTC(2026, 9, 29, 1, 0)
  expect(killBy('03:15', now, ny)).toBe('23:15 EDT')
  expect(killBy('2026-10-29T03:15:00Z', now, ny)).toBe('23:15 EDT')
  expect(killBy('soon', now, ny)).toBe('soon')
})

test('plan-limit resets carry the weekday', () => {
  expect(resetTime('2026-10-29T03:00:00Z', t('America/Toronto'))).toBe('Wed 23:00 EDT')
  expect(resetTime('2026-10-29T03:00:00Z', t('UTC'))).toBe('Thu 03:00Z')
  expect(resetTime('not a time', t('UTC'))).toBe('')
})

test('a plan window the host drops after its reset shows 0% (B5)', () => {
  const at = Date.UTC(2026, 9, 29, 21, 0)
  const before = [
    { kind: 'five_hour', pct: 7, resetsAt: '2026-10-29T21:00:00Z' },
    { kind: 'seven_day', pct: 40 },
  ]
  // Not reset yet but missing from a reading: kept as last read.
  expect(carryLimits(before, [{ kind: 'seven_day', pct: 41 }], at - 60_000)).toEqual([
    before[0],
    { kind: 'seven_day', pct: 41 },
  ])
  // Past its reset and missing: the new window at 0%, first in the list.
  expect(carryLimits(before, [{ kind: 'seven_day', pct: 41 }], at)).toEqual([
    { kind: 'five_hour', pct: 0, reset: true },
    { kind: 'seven_day', pct: 41 },
  ])
  // Still reported with a reset time in the past: 0% too.
  expect(carryLimits([], before, at + 1)[0]).toEqual({ kind: 'five_hour', pct: 0, reset: true })
  // The host reports the new window: its own figures win.
  const next = { kind: 'five_hour', pct: 2, resetsAt: '2026-10-30T02:00:00Z' }
  expect(carryLimits([{ kind: 'five_hour', pct: 0, reset: true }], [next], at + 1)).toEqual([next])
})

test('puzzles file: good entries kept, bad ones skipped with a problem, same id replaces in place', () => {
  const { puzzles, problems } = parsePuzzles([
    { id: 'bat-ball', title: 'Capital', question: 'Capital of France?', answer: 'Paris', accept: ['paris france'] },
    { id: 'new-one', title: 'Two plus two', question: '2 + 2?', answer: '4' },
    { id: 'Bad Id', title: 'x', question: 'y', answer: 'z' },
    { id: 'no-answer', title: 'x', question: 'y' },
    { id: 'new-one', title: 'again', question: 'y', answer: 'z' },
  ])
  expect(puzzles.map(p => p.id)).toEqual(['bat-ball', 'new-one'])
  expect(problems).toHaveLength(3)
  expect(problems[0]).toContain('puzzle 3')
  expect(problems[1]).toContain('"answer"')
  expect(problems[2]).toContain('comes twice')
  expect(parsePuzzles({ id: 'x' }).problems).toEqual(['must be a JSON list of puzzles'])

  const all = withPuzzles(puzzles)
  expect(all[0]?.title).toBe('Capital')
  expect(all).toHaveLength(CHALLENGES.length + 1)
  expect(all[all.length - 1]?.id).toBe('new-one')
})

test('accept: other answers count as right too', () => {
  const c = { id: 'cap', title: 'Capital', question: '?', answer: 'Paris', accept: ['Paris, France'] }
  expect(isCorrect(c, 'ANSWER: Paris')).toBe(true)
  expect(isCorrect(c, 'ANSWER: paris france')).toBe(true)
  expect(isCorrect(c, 'ANSWER: Lyon')).toBe(false)
})
