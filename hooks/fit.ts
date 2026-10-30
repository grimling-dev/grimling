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

// Grimoire card sizes (cards.size). Full is the 8x8 sprite in half blocks
// (four text rows) over the name, in a border: 10 wide, 7 tall. Compact is
// the same sprite at half height (two text rows, each half block four pixel
// rows), same border and label: 10 wide, 5 tall. Mini is one line, a glyph
// in the sprite's main colour and the short name: 12 wide, 1 tall. Live
// agent cards are always full.
export type CardSize = 'full' | 'compact' | 'mini'
export type SizeMode = 'auto' | CardSize

export const CARD_SIZES: Record<CardSize, { width: number; height: number }> = {
  full: { width: 10, height: 7 },
  compact: { width: 10, height: 5 },
  mini: { width: 12, height: 1 },
}
const LARGEST_FIRST: CardSize[] = ['full', 'compact', 'mini']

// z cycles the session's mode: auto, full, compact, mini, auto.
export function nextMode(m: SizeMode): SizeMode {
  const order: SizeMode[] = ['auto', 'full', 'compact', 'mini']
  return order[(order.indexOf(m) + 1) % order.length] ?? 'auto'
}

export type SizedFit = { size: CardSize; perRow: number; cards: number; recent: number }

// The card size to draw and what fits at it. `inner` is the columns the
// Grimoire's card grid has. Auto takes the largest size at which every
// shown card fits (recent runs give way first, as fitDeck does); when even
// mini cannot hold them all, mini with fitDeck's "N more" cut. A set size
// is drawn as set, cut the same way when it does not fit.
export function fitSized(o: Omit<FitInput, 'perRow' | 'cardH'> & { inner: number; mode: SizeMode }): SizedFit {
  const at = (size: CardSize): SizedFit => {
    const perRow = Math.max(1, Math.floor(o.inner / CARD_SIZES[size].width))
    return { size, perRow, ...fitDeck({ ...o, perRow, cardH: CARD_SIZES[size].height }) }
  }
  if (o.mode !== 'auto') return at(o.mode)
  for (const size of LARGEST_FIRST) {
    const f = at(size)
    if (f.cards >= o.cards) return f
  }
  return at('mini')
}
