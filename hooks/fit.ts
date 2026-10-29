// Fitting the docked deck into the pane's rows.
//
// The engine scrolls a docked pane whose tree is taller than its room, and
// with the ring low in the deck that window drops the tab bar off the top. So
// the deck gives up its lower sections first: recent runs down to one row,
// then Grimoire card rows down to one, each cut marked by a "more" line. The
// tab bar, meters, launch box and agent cards are never cut here.

export type FitInput = {
  // Rows the pane body has (Pane props scroll.bodyRows).
  budget: number
  // Rows everything else takes (tab bar, meters, Grim, launch box, agents, footer, panel borders).
  fixed: number
  // Grimoire cards to show, how many fit across, and a card's height.
  cards: number
  perRow: number
  cardH: number
  // Recent runs to show.
  recent: number
}

// How many Grimoire cards and recent rows to draw.
export function fitDeck(o: FitInput): { cards: number; recent: number } {
  const perRow = Math.max(1, o.perRow)
  const gridRows = Math.ceil(o.cards / perRow)
  const left = o.budget - o.fixed
  if (gridRows * o.cardH + o.recent <= left) return { cards: o.cards, recent: o.recent }
  // Recent first: down to one row, plus its "more" line.
  const minRecent = Math.min(o.recent, 1)
  const recent = Math.max(minRecent, Math.min(o.recent, left - gridRows * o.cardH - 1))
  if (gridRows * o.cardH + recent + 1 <= left) return { cards: o.cards, recent }
  // Then Grimoire rows: down to one, plus its "more" line.
  const spare = left - minRecent - (minRecent < o.recent ? 1 : 0) - 1
  const rows = Math.max(1, Math.min(gridRows, Math.floor(spare / o.cardH)))
  return { cards: Math.min(o.cards, rows * perRow), recent: minRecent }
}

// The slice of `count` items to draw, `n` of them, keeping `at` (the ring's
// or the target's index, -1 for none) in view.
export function windowAt(count: number, n: number, at: number): { start: number; end: number } {
  if (n >= count) return { start: 0, end: count }
  const start = at < 0 ? 0 : Math.max(0, Math.min(count - n, at - Math.floor(n / 2)))
  return { start, end: start + n }
}
