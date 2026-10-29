import { expect, test } from 'claude-code/testing'

import { fitDeck, windowAt } from '../hooks/fit'

// The docked deck fits the pane's rows: recent runs give way
// first, then Grimoire rows, never below one of each.

const base = { budget: 60, fixed: 30, cards: 14, perRow: 7, cardH: 7, recent: 6 }

test('everything fits: nothing is cut', () => {
  expect(fitDeck(base)).toEqual({ cards: 14, recent: 6 })
})

test('short pane: recent runs give way before Grimoire rows', () => {
  // 2 card rows = 14 rows; 16 left after fixed: 1 recent row + its more line.
  expect(fitDeck({ ...base, budget: 46 })).toEqual({ cards: 14, recent: 1 })
})

test('shorter still: Grimoire rows go down to one, recent keeps one', () => {
  expect(fitDeck({ ...base, budget: 40 })).toEqual({ cards: 7, recent: 1 })
  // Far too short: still one card row and one recent row (the engine scrolls the rest).
  expect(fitDeck({ ...base, budget: 10 })).toEqual({ cards: 7, recent: 1 })
})

test('windowAt keeps the ring index in view', () => {
  expect(windowAt(14, 14, 3)).toEqual({ start: 0, end: 14 })
  expect(windowAt(14, 7, -1)).toEqual({ start: 0, end: 7 })
  expect(windowAt(14, 7, 12)).toEqual({ start: 7, end: 14 })
  expect(windowAt(14, 7, 8)).toEqual({ start: 5, end: 12 })
})
