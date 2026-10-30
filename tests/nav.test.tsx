import { expect, mock, test } from 'claude-code/testing'
import { envHome, HOME } from './paths'

import { arrowOf, navMove, navRows } from '../hooks/nav'

// Arrow keys (keys.arrows): which scroll is which arrow, the rows a drawn
// tree holds, where each arrow lands, and the deck taking the scrolls.

const person = { kind: 'person' }
const scroll = (by: number, extra: Record<string, unknown> = {}) => ({
  by,
  bodyRows: 40,
  contentRows: 42,
  origin: person,
  ...extra,
})

test('arrowOf: Up and Down are scrolls of one row; Left and Right (or Home and End) the whole tree', () => {
  expect(arrowOf(scroll(-1))).toBe('up')
  expect(arrowOf(scroll(1))).toBe('down')
  expect(arrowOf(scroll(-42))).toBe('left')
  expect(arrowOf(scroll(42))).toBe('right')
  // A page key, a wheel tick (it has a pointer) and a plugin's scroll are no arrows.
  expect(arrowOf(scroll(40))).toBeNull()
  expect(arrowOf(scroll(1, { pointer: { column: 3, row: 2 } }))).toBeNull()
  expect(arrowOf(scroll(1, { origin: { kind: 'plugin', name: 'x' } }))).toBeNull()
})

// Elements as JSX builds them: type, props, children.
const box = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: 'Box', props, children })
const button = (key: string) => ({ type: 'Button', props: { key, label: key } })
const input = (key: string) => ({ type: 'Input', props: { key } })
const text = (s: string) => ({ type: 'Text', props: {}, children: [s] })
const card = (key: string, stop?: string) =>
  box({ flexDirection: 'column', width: 10, borderStyle: 'round' }, text('art'), button(key), stop ? button(stop) : null)

// A deck-shaped tree: tabs, launch box, chips, a 7-card grid 4 across (42
// columns inside a border), live cards with a STOP, recent runs, footer.
const deck = box(
  { flexDirection: 'column' },
  box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1 }, box({ flexDirection: 'row', flexWrap: 'wrap' }, button('tab-deck'), button('tab-flow'), button('tab-table'))),
  box({ flexDirection: 'column', borderStyle: 'round' }, input('launch-input'), text('#001 Scout')),
  box(
    { flexDirection: 'column', borderStyle: 'round', paddingX: 0 },
    box({ flexDirection: 'row', flexWrap: 'wrap' }, button('cat-all'), button('cat-code')),
    box({ flexDirection: 'row', flexWrap: 'wrap' }, ...['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(k => card(k))),
  ),
  box({ flexDirection: 'column', borderStyle: 'round' }, box({ flexDirection: 'row', flexWrap: 'wrap' }, card('agent-a', 'stop-a'), card('agent-b'))),
  box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1 }, button('recent-0'), button('recent-1')),
  box({ flexDirection: 'row', flexWrap: 'wrap' }, button('tab-help'), text('3▶')),
)
const rows = navRows(deck, 44, k => k.startsWith('stop-'))

test('navRows: one row per line of the pane, the card grid as many across as fit, STOP left out', () => {
  expect(rows).toEqual([
    ['tab-deck', 'tab-flow', 'tab-table'],
    ['launch-input'],
    ['cat-all', 'cat-code'],
    ['c0', 'c1', 'c2', 'c3'],
    ['c4', 'c5', 'c6'],
    ['agent-a', 'agent-b'],
    ['recent-0'],
    ['recent-1'],
    ['tab-help'],
  ])
})

test('grid: Left and Right move within the row and stop at its ends', () => {
  expect(navMove(rows, 'c1', 'right', null).to).toBe('c2')
  expect(navMove(rows, 'c1', 'left', null).to).toBe('c0')
  expect(navMove(rows, 'c0', 'left', null).to).toBeNull()
  expect(navMove(rows, 'c3', 'right', null).to).toBeNull()
})

test('grid: Up and Down keep the column, and the last item of a shorter row takes a column past its end', () => {
  expect(navMove(rows, 'c1', 'down', null)).toEqual({ to: 'c5', sticky: 1 })
  expect(navMove(rows, 'c5', 'up', null)).toEqual({ to: 'c1', sticky: 1 })
  expect(navMove(rows, 'c3', 'down', null)).toEqual({ to: 'c6', sticky: 3 })
  // The column is kept through a shorter row: c3 -> c6 -> back up to c3, not c2.
  expect(navMove(rows, 'c6', 'up', 3).to).toBe('c3')
})

test('sections: Up and Down jump tab bar, launch box, chips, cards, live agents, recent runs, footer', () => {
  const walk: string[] = []
  let at: string | null = 'tab-flow'
  let col: number | null = null
  for (;;) {
    const m = navMove(rows, at, 'down', col)
    if (!m.to) break
    walk.push(m.to)
    at = m.to
    col = m.sticky
  }
  expect(walk).toEqual(['launch-input', 'cat-code', 'c1', 'c5', 'agent-b', 'recent-0', 'recent-1', 'tab-help'])
  // Edges stop: nothing above the tab bar, nothing below the footer.
  expect(navMove(rows, 'tab-deck', 'up', null).to).toBeNull()
  expect(navMove(rows, 'tab-help', 'down', null).to).toBeNull()
  // From nowhere (the ring on the engine's close mark) an arrow lands on the first item.
  expect(navMove(rows, null, 'down', null).to).toBe('tab-deck')
})

test('off the path: from STOP or an unknown key an arrow starts where the key is drawn, never at the top', () => {
  const layout = navRows(deck, 44)
  // STOP sits under its live card: Up goes back to that card, Down on to recent runs.
  expect(navMove(rows, 'stop-a', 'up', null, [], layout)).toEqual({ to: 'agent-a', sticky: 0 })
  expect(navMove(rows, 'stop-a', 'down', null, [], layout).to).toBe('recent-0')
  // Nothing beside it on its row: Left and Right stay.
  expect(navMove(rows, 'stop-a', 'left', null, [], layout).to).toBeNull()
  expect(navMove(rows, 'stop-a', 'right', null, [], layout).to).toBeNull()
  // A key the pane did not draw (gone since the last draw): the ring stays.
  expect(navMove(rows, 'gone-key', 'down', null, [], layout)).toEqual({ to: null, sticky: null })
  expect(navMove(rows, 'gone-key', 'up', null)).toEqual({ to: null, sticky: null })
})

test('off the path: from the size label in the Grimoire border Down enters the Grimoire, Up leaves it, Left/Right go along', () => {
  const titled = box(
    { flexDirection: 'column' },
    box({ flexDirection: 'column', borderStyle: 'round' }, input('launch-input')),
    box(
      { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
      box({ position: 'absolute', top: -1, left: 0 }, text(' grimoire '), button('size-cycle')),
      box({ flexDirection: 'row', flexWrap: 'wrap' }, button('cat-all'), button('cat-code')),
      box({ flexDirection: 'row', flexWrap: 'wrap' }, ...['c0', 'c1'].map(k => card(k))),
    ),
  )
  const skip = (k: string) => k === 'size-cycle'
  const r = navRows(titled, 44, skip)
  const layout = navRows(titled, 44)
  expect(r).toEqual([['launch-input'], ['cat-all', 'cat-code'], ['c0', 'c1']])
  expect(navMove(r, 'size-cycle', 'down', null, [], layout).to).toBe('cat-all')
  expect(navMove(r, 'size-cycle', 'up', null, [], layout).to).toBe('launch-input')
  expect(navMove(r, 'size-cycle', 'left', null, [], layout).to).toBeNull()
  // A sticky column from before the jump to the label is not used.
  expect(navMove(r, 'size-cycle', 'down', 1, [], layout).to).toBe('cat-all')
})

test('dialogs: arrows stay among the dialog buttons', () => {
  const dialog = box(
    { flexDirection: 'column' },
    box({ flexDirection: 'row' }, button('tab-deck'), button('tab-flow')),
    box({ flexDirection: 'column', borderStyle: 'round' }, text('Stop scan?'), box({ flexDirection: 'row' }, button('confirm-keep'), button('confirm-stop'))),
    box({ flexDirection: 'row' }, button('agent-a')),
  )
  const r = navRows(dialog, 44)
  const groups = [['confirm-keep', 'confirm-stop']]
  expect(navMove(r, 'confirm-keep', 'right', null, groups).to).toBe('confirm-stop')
  expect(navMove(r, 'confirm-keep', 'down', null, groups).to).toBe('confirm-stop')
  expect(navMove(r, 'confirm-stop', 'left', null, groups).to).toBe('confirm-keep')
  // Never out of the dialog: not up to the tabs, not down to the cards.
  expect(navMove(r, 'confirm-keep', 'up', null, groups).to).toBeNull()
  expect(navMove(r, 'confirm-stop', 'down', null, groups).to).toBeNull()
  expect(navMove(r, 'confirm-stop', 'right', null, groups).to).toBeNull()
})

// The deck itself: the engine raises ui.scroll for the arrows; the deck takes
// the scroll (the window does not move) and moves the ring with $.ui.focus.
// The test kit has no engine under a plugin's $.ui.focus, so the test reads
// where the deck sent the ring from its debug log ("arrow" lines) and raises
// the ui.focus the engine would (origin the plugin) itself.

const PANE = {
  plugin: 'grimling',
  component: 'Pane',
  requestId: 'grimling',
  props: {
    title: 'Grimling',
    isFocused: true,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 120 },
    view: {},
  },
} as const

type On = Parameters<Parameters<typeof test>[1]>[1]
type Engine = Parameters<Parameters<typeof test>[1]>[0]
type Listed = { id: string; description: string; type: string; status: string }
const SETTINGS = `${HOME}/.claude/grimling/settings.json`
const DEBUG_LOG = `${HOME}/.claude/grimling/debug.log`
const slashed = (p: unknown) => String(p).split(String.fromCharCode(92)).join('/')

function stubs(on: On, files: Record<string, string>, listed: Listed[]) {
  const seen = { focus: [] as string[], scrolls: 0 }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', (_, e) => {
    seen.focus.push(String(e.element ?? ''))
    return { value: {} }
  })
  on('ui.scroll', () => {
    seen.scrolls += 1
    return { value: {} }
  })
  on('ui.toast', () => ({ value: {} }))
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.usage', () => ({ value: {} }))
  on('ui.status', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const path = slashed(e.path)
    if (path in files) return { value: files[path] }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    files[slashed(e.path)] = String(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slashed(e.path) in files }))
  on('agent.list', () => ({ value: listed }))
  // The harness reads a plugin's spawn id from the Agent tool's output shape.
  const launchedAs = { status: 'async_launched', agentId: 'ag1', description: 'scan', prompt: 'scan', outputFile: '' }
  on('agent.spawn', () => ({ model: 'test', agentId: 'ag1', result: launchedAs }))
  return seen
}

// The person's Tab or click, as the engine raises it.
const ringTo = (element: string) => ({
  component: 'Pane' as const,
  requestId: 'grimling',
  element,
  origin: { kind: 'person' as const },
})
// The ring move a plugin's $.ui.focus becomes, as the engine raises it.
const ringFromDeck = (element: string) => ({ ...ringTo(element), origin: { kind: 'plugin' as const, name: 'grimling' } })
// An arrow as the engine raises it: Up/Down one row, Left/Right (bound to
// pane:top / pane:bottom) the whole tree. The deck pads 120 rows to 122.
const UP = -1
const DOWN = 1
const LEFT = -122
const RIGHT = 122
const scrollOf = (by: number, contentRows = 122) => ({
  component: 'Pane' as const,
  requestId: 'grimling',
  offset: 0,
  by: Math.abs(by) === 122 ? Math.sign(by) * contentRows : by,
  bodyRows: 120,
  contentRows,
  origin: { kind: 'person' as const },
})

async function deckUp($: Engine, on: On, settings: object = {}, listed: Listed[] = []) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ ...settings, log: { debug: 'all' } }) }
  const seen = stubs(on, files, listed)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.redraw()
  // Where the deck sent the ring for the last arrow (null: it stayed).
  const sent = async () => {
    await new Promise(resolve => setTimeout(resolve, 30))
    const lines = (files[DEBUG_LOG] ?? '').split(String.fromCharCode(10)).filter(l => / arrow /.test(l))
    const last = lines.at(-1)
    return last ? (JSON.parse(last.slice(last.indexOf('{'))) as { to: string | null }).to : undefined
  }
  // One arrow: the scroll, then the engine's ring move to where the deck sent it.
  const press = async (by: number, contentRows?: number) => {
    await $.ui.scroll(scrollOf(by, contentRows))
    const to = await sent()
    if (to) await $.ui.focus(ringFromDeck(to))
    await ui.redraw()
    return to
  }
  const ring = async (element: string) => {
    await $.ui.focus(ringTo(element))
    await ui.redraw()
  }
  return { clock, seen, ui, press, ring }
}

test('deck: Left/Right walk the card row, Up/Down keep the column; the window never scrolls', async ($, on) => {
  const { seen, ui, press, ring } = await deckUp($, on)
  await ring('card-scout')
  // 42 columns inside the Grimoire border: 4 cards across.
  expect(await press(RIGHT)).toBe('card-builder')
  expect(await press(DOWN)).toBe('card-workflows')
  expect(await press(LEFT)).toBe('card-guide')
  expect(await press(LEFT)).toBeNull()
  expect(await press(UP)).toBe('card-scout')
  expect(seen.scrolls).toBe(0)
  await ui.unmount()
})

test('deck: Up and Down jump between sections: tabs, launch box, chips, find, cards, footer', async ($, on) => {
  const { seen, ui, press, ring } = await deckUp($, on)
  await ring('card-fetcher')
  const up: (string | null | undefined)[] = []
  for (let i = 0; i < 5; i += 1) up.push(await press(UP))
  // Column 3 is kept through the one-wide rows and comes back on the chips.
  expect(up).toEqual(['filter-input', 'cat-web', 'launch-input', 'tab-keys', null])
  const down: (string | null | undefined)[] = []
  for (let i = 0; i < 7; i += 1) down.push(await press(DOWN))
  expect(down).toEqual(['launch-input', 'cat-web', 'filter-input', 'card-fetcher', 'card-swarm', 'tab-arena', null])
  // At the edges the ring stays and the window does not scroll either.
  expect(seen.scrolls).toBe(0)
  // A tree taller than its padding (a long Keys or Setup view) still scrolls at an edge.
  await $.ui.scroll(scrollOf(DOWN, 150))
  expect(seen.scrolls).toBe(1)
  await ui.unmount()
})

test('deck: a tree taller than its padding scrolls only for Up or Down at an edge, never mid-deck or for Left/Right', async ($, on) => {
  const { seen, ui, press, ring } = await deckUp($, on)
  // Up at the top edge (the tab bar) of a tall view: the ring stays, the window scrolls.
  await ring('tab-deck')
  expect(await press(UP, 150)).toBeNull()
  expect(seen.scrolls).toBe(1)
  // Left at the row's start: the ring stays and the window does not move.
  expect(await press(LEFT, 150)).toBeNull()
  expect(seen.scrolls).toBe(1)
  // Mid-deck the arrow moves the ring and does not scroll, tall or not.
  await ring('card-scout')
  expect(await press(DOWN, 150)).toBe('card-guide')
  expect(await press(UP, 150)).toBe('card-scout')
  expect(seen.scrolls).toBe(1)
  // The line is the padding: one row past it scrolls at an edge, the padding itself does not.
  await ring('tab-deck')
  expect(await press(UP, 122)).toBeNull()
  expect(seen.scrolls).toBe(1)
  expect(await press(UP, 123)).toBeNull()
  expect(seen.scrolls).toBe(2)
  await ui.unmount()
})

test('deck: in a text box Left and Right are its cursor keys, never a move; Down leaves it', async ($, on) => {
  const { ui, press, ring } = await deckUp($, on)
  await ring('launch-input')
  await $.ui.scroll(scrollOf(LEFT))
  await $.ui.scroll(scrollOf(RIGHT))
  expect(await press(DOWN)).toBe('cat-all')
  await ui.unmount()
})

test('deck: in a text box Home and End (the same scroll as Left and Right) neither move the ring nor scroll', async ($, on) => {
  const { seen, ui, ring } = await deckUp($, on)
  await ring('filter-input')
  seen.focus.length = 0
  // Home and End: minus and plus the tree's rows, fitting and taller than the window.
  for (const rowsNow of [122, 150]) {
    expect(await $.ui.scroll(scrollOf(LEFT, rowsNow))).toEqual({})
    expect(await $.ui.scroll(scrollOf(RIGHT, rowsNow))).toEqual({})
  }
  expect(seen.scrolls).toBe(0)
  expect(seen.focus).toHaveLength(0)
  await ui.unmount()
})

test('deck: Up and Down leave a text box to the row above or below, not in Tab order', async ($, on) => {
  const { ui, press, ring } = await deckUp($, on)
  // Tab order would put Shift+Tab from the find box on the last chip; Up goes
  // straight up, to the first.
  await ring('filter-input')
  expect(await press(UP)).toBe('cat-all')
  await ring('filter-input')
  expect(await press(DOWN)).toBe('card-scout')
  await ui.unmount()
})

test('deck: from STOP (x put the ring there) or the size label an arrow moves from where it is drawn', async ($, on) => {
  const listed: Listed[] = []
  const { clock, seen, ui, press, ring } = await deckUp($, on, {}, listed)
  listed.push({ id: 'ag1', description: 'scan', type: 'general-purpose', status: 'running' })
  await ui.input({ key: 'launch-input', text: 'scan', kind: 'submit' })
  await clock.advance(2000)
  await ui.redraw()
  await ring('stop-ag1')
  expect(await press(UP)).toBe('agent-ag1')
  await ring('size-cycle')
  // Into the Grimoire below the label (its chips), not back up to the tab bar.
  expect(await press(DOWN)).toBe('cat-all')
  await ring('size-cycle')
  expect(await press(LEFT)).toBeNull()
  expect(seen.scrolls).toBe(0)
  await ui.unmount()
})

test('deck: a wheel tick and a page key still scroll', async ($, on) => {
  const { seen, ui, ring } = await deckUp($, on)
  await ring('card-scout')
  seen.focus.length = 0
  await $.ui.scroll({ ...scrollOf(DOWN), pointer: { column: 5, row: 5 } })
  await $.ui.scroll(scrollOf(120))
  expect(seen.scrolls).toBe(2)
  expect(seen.focus).toHaveLength(0)
  await ui.unmount()
})

test('deck: the Stop / Keep confirm keeps the arrows inside it', async ($, on) => {
  const listed: Listed[] = []
  const { clock, seen, ui, press, ring } = await deckUp($, on, {}, listed)
  // Launch from the deck so the card gets STOP, then open the confirm.
  listed.push({ id: 'ag1', description: 'scan', type: 'general-purpose', status: 'running' })
  await ui.input({ key: 'launch-input', text: 'scan', kind: 'submit' })
  await clock.advance(2000)
  await ui.redraw()
  await ui.press({ key: 'stop-ag1' })
  await ring('confirm-keep')
  expect(await press(RIGHT)).toBe('confirm-stop')
  expect(await press(RIGHT)).toBeNull()
  expect(await press(DOWN)).toBeNull()
  expect(await press(UP)).toBe('confirm-keep')
  expect(await press(UP)).toBeNull()
  expect(await press(LEFT)).toBeNull()
  expect(seen.scrolls).toBe(0)
  await ui.unmount()
})

test('keys.arrows false: arrows scroll as before and move nothing; Tab passes through', async ($, on) => {
  const { seen, ui, ring } = await deckUp($, on, { keys: { arrows: false } })
  await ring('card-scout')
  seen.focus.length = 0
  await $.ui.scroll(scrollOf(DOWN))
  await $.ui.scroll(scrollOf(RIGHT))
  expect(seen.scrolls).toBe(2)
  expect(seen.focus).toHaveLength(0)
  await ring('card-builder')
  expect(seen.focus).toEqual(['card-builder'])
  // No padding: the deck's tree is drawn as it was.
  const root = await $.ui.render({ ...PANE, surface: 'terminal' })
  expect(root.props?.minHeight).toBeUndefined()
  await ui.unmount()
})

test('Tab is unchanged with arrows on (passed through as it came) and starts a new column', async ($, on) => {
  const { seen, ui, press, ring } = await deckUp($, on)
  await ring('card-fetcher')
  seen.focus.length = 0
  await ring('launch-input')
  expect(seen.focus).toEqual(['launch-input'])
  // Down lands in column 0, not Fetch's column 3.
  expect(await press(DOWN)).toBe('cat-all')
  // With arrows on, the docked tree is padded past the window.
  const root = await $.ui.render({ ...PANE, surface: 'terminal' })
  expect(root.props?.minHeight).toBe(122)
  await ui.unmount()
})

test('deck: arrows skip the transcript peek row (v and Tab reach it)', async ($, on) => {
  const listed: Listed[] = [{ id: 'ag1', description: 'scan', type: 'general-purpose', status: 'running' }]
  const { clock, seen, ui, press, ring } = await deckUp($, on, {}, listed)
  await clock.advance(2000)
  await ui.redraw()
  await ring('agent-ag1')
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeTruthy()
  const up = await press(UP)
  expect(up).not.toBe('agent-view')
  expect(up).toBeTruthy()
  // From the row itself (Tab put the ring there) an arrow moves from where it is drawn.
  await ring('agent-ag1')
  await ring('agent-view')
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeTruthy()
  expect(await press(DOWN)).toBe('agent-ag1')
  expect(seen.scrolls).toBe(0)
  await ui.unmount()
})

test("deck: the answer box's arrows walk prompt, copy, view, close and stay inside", async ($, on) => {
  const listed: Listed[] = [{ id: 'ag1', description: 'scan', type: 'general-purpose', status: 'completed' }]
  const { clock, seen, ui, press, ring } = await deckUp($, on, {}, listed)
  await clock.advance(2000)
  await ui.redraw()
  await ui.press({ key: 'agent-ag1' })
  await ring('ans-prompt')
  expect(await press(RIGHT)).toBe('ans-copy')
  expect(await press(RIGHT)).toBe('ans-view')
  expect(await press(RIGHT)).toBe('ans-close')
  expect(await press(RIGHT)).toBeNull()
  expect(await press(DOWN)).toBeNull()
  expect(await press(LEFT)).toBe('ans-view')
  expect(seen.scrolls).toBe(0)
  await ui.unmount()
})

test('deck: the ring on the peek row moves to the card when that agent ends', async ($, on) => {
  const listed: Listed[] = [{ id: 'ag1', description: 'scan', type: 'general-purpose', status: 'running' }]
  const clock = mock.clock(on, { now: 1_000_000 })
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ log: { debug: 'all' } }) }
  stubs(on, files, listed)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.redraw()
  await $.ui.focus(ringTo('agent-ag1'))
  await ui.redraw()
  await $.ui.focus(ringTo('agent-view'))
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeTruthy()
  // Where the deck sent the ring when the agent ended.
  const moves = () =>
    (files[DEBUG_LOG] ?? '').split(String.fromCharCode(10)).filter(l => / peek\.ring /.test(l))
  expect(moves()).toHaveLength(0)
  listed[0] = { ...listed[0]!, status: 'completed' }
  await clock.advance(2000)
  await new Promise(resolve => setTimeout(resolve, 30))
  const last = moves().at(-1) ?? ''
  expect(last ? (JSON.parse(last.slice(last.indexOf('{'))) as { to: string }).to : null).toBe('agent-ag1')
  // The engine's ring move it becomes: the row is gone, the ring on the card.
  await $.ui.focus(ringFromDeck('agent-ag1'))
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'agent-ag1' })).toBeTruthy()
  await ui.unmount()
})
