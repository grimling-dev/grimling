// Arrow keys around the pane (setting keys.arrows).
//
// What the engine hands a pane (Claude Code 2.1.312): Tab and Shift+Tab walk
// the focus ring in document order. Up and Down walk it the same way while
// the tree fits the pane, but scroll the pane (`ui.scroll`, `by` -1 or 1, no
// pointer) once the tree is taller than the window. Left and Right are not
// bound in a pane at all; a person who binds them in keybindings.json
// (context "Pane", left -> "pane:top", right -> "pane:bottom") gets a
// `ui.scroll` of minus or plus the tree's rows, the same one Home and End
// raise.
//
// So the deck keeps its docked tree one row taller than the window (the
// register module pads it), takes those scrolls, and moves the ring
// spatially instead of scrolling. This module is the pure part: which arrow
// a scroll is, the rows of focusable elements a drawn tree holds, and where
// an arrow lands. Edges stop; nothing wraps.

export type Dir = 'up' | 'down' | 'left' | 'right'

export type ScrollLike = {
  by: number
  bodyRows: number
  contentRows: number
  pointer?: unknown
  origin: { kind: string }
}

// The arrow a person's scroll stands for, or null for a wheel tick, a page
// key, or a plugin's own scroll.
export function arrowOf(e: ScrollLike): Dir | null {
  if (e.origin.kind !== 'person' || e.pointer !== undefined) return null
  if (e.by === -1) return 'up'
  if (e.by === 1) return 'down'
  if (e.contentRows > 1 && Math.abs(e.by) === e.contentRows) return e.by < 0 ? 'left' : 'right'
  return null
}

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown }

const FOCUSABLE = new Set(['Button', 'Input', 'Select'])

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function kids(node: Node): unknown[] {
  const own = node.children ?? node.props?.children
  const out: unknown[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && v !== undefined && v !== false && v !== true) out.push(v)
  }
  walk(own)
  return out
}

// Columns a Box's children get: its own width, less border and padding.
function inner(props: Record<string, unknown>, avail: number): number {
  const width = typeof props.width === 'number' ? props.width : avail
  const border = props.borderStyle ? 2 : 0
  const padX = num(props.paddingX) || num(props.padding)
  const sides = num(props.paddingLeft) + num(props.paddingRight)
  return Math.max(1, width - border - padX * 2 - sides)
}

// Lines laid side by side: the first lines together, then the second ones.
function zip(parts: string[][][]): string[][] {
  const out: string[][] = []
  for (const part of parts) {
    part.forEach((line, i) => {
      out[i] = [...(out[i] ?? []), ...line]
    })
  }
  return out
}

function lines(v: unknown, avail: number): string[][] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return []
  const node = v as Node
  const props = node.props ?? {}
  if (typeof node.type !== 'string') return []
  if (FOCUSABLE.has(node.type)) return typeof props.key === 'string' ? [[props.key]] : []
  if (node.type !== 'Box' || props.display === 'none') return []
  const room = inner(props, avail)
  const children = kids(node)
  const dir = typeof props.flexDirection === 'string' ? props.flexDirection : 'row'
  if (dir.startsWith('column')) return children.flatMap(c => lines(c, room))
  const parts = children.map(c => lines(c, room))
  // A wrapping row of fixed-width items (the card grids): as many per visual
  // row as fit across. Any other row counts as one row.
  if (props.flexWrap === 'wrap') {
    const widths = children.map(c => (c as Node)?.props?.width)
    const w = widths[0]
    if (typeof w === 'number' && w > 0 && widths.every(x => x === w)) {
      const per = Math.max(1, Math.floor(room / w))
      const out: string[][] = []
      for (let i = 0; i < parts.length; i += per) out.push(...zip(parts.slice(i, i + per)))
      return out
    }
  }
  return zip(parts)
}

// The rows of focusable keys a drawn tree holds, top to bottom, each left to
// right. `skip` leaves keys out (the STOP buttons: x reaches them).
export function navRows(tree: unknown, columns: number, skip: (key: string) => boolean = () => false): string[][] {
  return lines(tree, columns)
    .map(row => row.filter(k => !skip(k)))
    .filter(row => row.length > 0)
}

export type Move = {
  // The key the ring goes to; null at an edge (it stays).
  to: string | null
  // The column Up and Down aim for, kept across a short row in between.
  sticky: number | null
}

// From a key drawn but off the arrow path (a STOP button, the size label:
// `layout` is the drawn rows with them in) the arrow moves from where that
// key is drawn: Left and Right to the nearest item along its row, Up and Down
// to the next row that has items, at its column. A key not drawn at all
// stays put.
function offPath(rows: string[][], layout: string[][], from: string, dir: Dir): Move {
  const r = layout.findIndex(row => row.includes(from))
  if (r < 0) return { to: null, sticky: null }
  const onPath = new Set(rows.flat())
  const full = layout[r] ?? []
  const c = full.indexOf(from)
  if (dir === 'left' || dir === 'right') {
    const step = dir === 'left' ? -1 : 1
    for (let i = c + step; i >= 0 && i < full.length; i += step) {
      const k = full[i]
      if (k !== undefined && onPath.has(k)) return { to: k, sticky: null }
    }
    return { to: null, sticky: null }
  }
  const step = dir === 'up' ? -1 : 1
  for (let i = r + step; i >= 0 && i < layout.length; i += step) {
    const next = (layout[i] ?? []).filter(k => onPath.has(k))
    if (next.length > 0) return { to: next[Math.min(c, next.length - 1)] ?? null, sticky: c }
  }
  return { to: null, sticky: null }
}

// Where an arrow lands from `from`. Inside a dialog group (Stop / Keep, the
// answer box) every arrow stays among that group's drawn buttons: Up and Left
// go back, Down and Right forward. Up and Down keep the column where the
// next row has one, else land on its last item. `layout` is the drawn rows
// with the skipped keys still in (navRows without `skip`), so an arrow from
// one of those starts where it is drawn.
export function navMove(
  rows: string[][],
  from: string | null,
  dir: Dir,
  sticky: number | null,
  groups: string[][] = [],
  layout: string[][] = rows,
): Move {
  const drawn = new Set(rows.flat())
  const group = from ? groups.find(g => g.includes(from)) : undefined
  if (group && from) {
    const list = group.filter(k => drawn.has(k))
    const i = list.indexOf(from)
    const to = list[dir === 'up' || dir === 'left' ? i - 1 : i + 1] ?? null
    return { to, sticky: null }
  }
  const r = from ? rows.findIndex(row => row.includes(from)) : -1
  // From nowhere (the ring on the engine's close mark): the first item.
  if (r < 0) return from === null ? { to: rows[0]?.[0] ?? null, sticky: null } : offPath(rows, layout, from, dir)
  const row = rows[r] ?? []
  const c = row.indexOf(from ?? '')
  if (dir === 'left' || dir === 'right') {
    return { to: row[dir === 'left' ? c - 1 : c + 1] ?? null, sticky: null }
  }
  const want = sticky ?? c
  const next = rows[dir === 'up' ? r - 1 : r + 1]
  if (!next) return { to: null, sticky: want }
  return { to: next[Math.min(want, next.length - 1)] ?? null, sticky: want }
}
