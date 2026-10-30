import { expect, mock, test } from 'claude-code/testing'
import { envHome, HOME } from './paths'

import { CARD_SIZES, fitSized, nextMode } from '../hooks/fit'
import { PALETTE, halfHeight, mainColour } from '../hooks/dex'
import { parseSettings } from '../hooks/settings'

// Card sizes (cards.size, z): the Grimoire's cards shrink, full then compact
// then mini, so the whole deck fits; live agent cards stay full.

// 21 cards in a 42-column grid: full and compact 4 across (6 rows), mini 3 (7 rows).
const base = { fixed: 30, cards: 21, inner: 42, recent: 2 }

test('auto picks the largest size at which every card fits: full, then compact, then mini', () => {
  // Full: 6 rows x 7 = 42, plus 2 recent.
  expect(fitSized({ ...base, budget: 74, mode: 'auto' })).toEqual({ size: 'full', perRow: 4, cards: 21, recent: 2 })
  // Compact: 6 rows x 5 = 30.
  expect(fitSized({ ...base, budget: 62, mode: 'auto' })).toEqual({ size: 'compact', perRow: 4, cards: 21, recent: 2 })
  // Mini: 7 rows x 1.
  expect(fitSized({ ...base, budget: 39, mode: 'auto' })).toEqual({ size: 'mini', perRow: 3, cards: 21, recent: 2 })
  // Recent runs give way before a smaller size is taken.
  // 6 runs: one row plus its "more" line leaves room for full cards.
  expect(fitSized({ ...base, recent: 6, budget: 74, mode: 'auto' })).toEqual({ size: 'full', perRow: 4, cards: 21, recent: 1 })
})

test('auto: when even mini cannot hold every card, mini with the "N more" cut', () => {
  const f = fitSized({ ...base, budget: 36, mode: 'auto' })
  expect(f.size).toBe('mini')
  expect(f.cards).toBeLessThan(21)
  expect(f.cards % 3).toBe(0)
  expect(f.recent).toBe(1)
})

test('a set size overrides auto, cut like before when it does not fit', () => {
  expect(fitSized({ ...base, budget: 200, mode: 'mini' }).size).toBe('mini')
  const full = fitSized({ ...base, budget: 62, mode: 'full' })
  expect(full).toEqual({ size: 'full', perRow: 4, cards: 16, recent: 1 })
  expect(fitSized({ ...base, budget: 39, mode: 'compact' }).size).toBe('compact')
})

test('z order: auto, full, compact, mini, auto', () => {
  expect(nextMode('auto')).toBe('full')
  expect(nextMode('full')).toBe('compact')
  expect(nextMode('compact')).toBe('mini')
  expect(nextMode('mini')).toBe('auto')
})

test('cards.size: auto by default; full, compact, mini allowed; anything else is a problem', () => {
  expect(parseSettings({}).value.cards.size).toBe('auto')
  expect(parseSettings({ cards: { size: 'mini' } }).value.cards.size).toBe('mini')
  const bad = parseSettings({ cards: { size: 'tiny' } })
  expect(bad.value.cards.size).toBe('auto')
  expect(bad.problems.map(p => p.path)).toEqual(['cards.size'])
})

test('compact art: the 8x8 sprite at half height; mini glyph: its main colour', () => {
  const art = ['.k....k.', 'kttttttk', 'twwttwwt', 'twkttwkt', 'tttyyttt', '.tttttt.', '.t.tt.t.', '..k..k..']
  expect(halfHeight(art)).toEqual(['kkttttkk', 'twwttwwt', 'tttyyttt', '.tkttkt.'])
  expect(mainColour(art, PALETTE)).toBe(PALETTE.t)
  // Outline and eyes count only when nothing else is drawn.
  expect(mainColour(['kkww', 'k..k'], PALETTE)).toBe(PALETTE.k)
  expect(mainColour(['....'], PALETTE)).toBeUndefined()
})

// The deck itself, docked 44 columns wide (42 inside the Grimoire border).

type On = Parameters<Parameters<typeof test>[1]>[1]
type Engine = Parameters<Parameters<typeof test>[1]>[0]
type Listed = { id: string; description: string; type: string; status: string }
type Found = { props: Record<string, unknown>; text?: string; key?: string }
const SETTINGS = `${HOME}/.claude/grimling/settings.json`
const DEBUG_LOG = `${HOME}/.claude/grimling/debug.log`
const slashed = (p: unknown) => String(p).split(String.fromCharCode(92)).join('/')

const paneAt = (bodyRows: number) =>
  ({
    plugin: 'grimling',
    component: 'Pane',
    requestId: 'grimling',
    surface: 'terminal',
    props: {
      title: 'Grimling',
      isFocused: true,
      bodyColumns: 44,
      placement: 'dock',
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  }) as const

function stubs(on: On, files: Record<string, string>, listed: Listed[]) {
  const seen = { toasts: [] as string[] }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({ value: {} }))
  on('ui.scroll', () => ({ value: {} }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(String(e.text))
    return { value: {} }
  })
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
  return seen
}

async function deckAt($: Engine, on: On, bodyRows: number, settings: object = {}, listed: Listed[] = []) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files: Record<string, string> = { [SETTINGS]: JSON.stringify({ ...settings, log: { debug: 'all' } }) }
  const seen = stubs(on, files, listed)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const ui = await $.ui.mount(paneAt(bodyRows))
  await ui.redraw()
  // What the size button says (auto·full, compact, ...).
  const label = async () => {
    const texts = (await ui.findAll({ type: 'Text' })) as Found[]
    return texts.map(t => t.text ?? '').find(t => /^(auto·)?(full|compact|mini)$/.test(t.trim()))?.trim()
  }
  const cardCount = async () =>
    ((await ui.findAll({ type: 'Button' })) as Found[]).filter(b => String(b.key ?? '').startsWith('card-')).length
  const boxOf = async (key: string) => (await ui.find({ type: 'Box', key: `box-${key}` })) as Found | undefined
  return { clock, files, seen, ui, label, cardCount, boxOf }
}

test('deck: auto draws full when tall, compact, then mini as the pane gets shorter, every card shown', async ($, on) => {
  const { ui, label, cardCount, boxOf } = await deckAt($, on, 120)
  const all = await cardCount()
  expect(all).toBeGreaterThan(4)
  expect(await label()).toBe('auto·full')
  expect((await boxOf('card-scout'))?.props.width).toBe(CARD_SIZES.full.width)
  await ui.unmount()
  // Sweep the pane's height: sizes only shrink, every card stays until mini.
  const seenSizes: string[] = []
  for (let rows = 80; rows >= 24; rows -= 1) {
    const m = await $.ui.mount(paneAt(rows))
    await m.redraw()
    const texts = ((await m.findAll({ type: 'Text' })) as Found[]).map(t => (t.text ?? '').trim())
    const size = texts.find(t => /^auto·/.test(t))?.slice(5) ?? ''
    const cards = ((await m.findAll({ type: 'Button' })) as Found[]).filter(b => String(b.key ?? '').startsWith('card-')).length
    const cut = texts.some(t => /more cards?: find/.test(t))
    if (seenSizes.at(-1) !== size) seenSizes.push(size)
    if (size !== 'mini') expect(cards).toBe(all)
    if (cut) expect(size).toBe('mini')
    await m.unmount()
  }
  expect(seenSizes).toEqual(['full', 'compact', 'mini'])
})

test('deck: typing in the find box keeps the auto size; clearing it leaves the same size', async ($, on) => {
  const first = await deckAt($, on, 80)
  await first.ui.unmount()
  const sizeOf = async (ui: typeof first.ui) =>
    ((await ui.findAll({ type: 'Text' })) as Found[]).map(t => (t.text ?? '').trim()).find(t => /^auto·/.test(t))
  // The tallest pane at which the whole list is compact (one card alone would be full).
  let ui = first.ui
  for (let rows = 80; rows > 30; rows -= 1) {
    ui = await $.ui.mount(paneAt(rows))
    await ui.redraw()
    if ((await sizeOf(ui)) !== 'auto·full') break
    await ui.unmount()
  }
  expect(await sizeOf(ui)).toBe('auto·compact')
  const sizes: (string | undefined)[] = []
  for (const text of ['s', 'sc', 'scout', '']) {
    await ui.input({ key: 'filter-input', text, kind: 'change' })
    await new Promise(resolve => setTimeout(resolve, 20))
    await ui.redraw()
    sizes.push(await sizeOf(ui))
  }
  expect(sizes).toEqual(['auto·compact', 'auto·compact', 'auto·compact', 'auto·compact'])
  await ui.unmount()
})

test('deck: too short for mini falls back to the "N more" line, at mini', async ($, on) => {
  const { ui, label, cardCount } = await deckAt($, on, 20)
  expect(await label()).toBe('auto·mini')
  expect(await ui.find({ type: 'Text', text: /more cards?: find/ })).toBeTruthy()
  expect(await cardCount()).toBeLessThan(7)
  await ui.unmount()
})

test('deck: live agent cards stay full while the Grimoire is mini', async ($, on) => {
  const listed: Listed[] = [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }]
  const { clock, ui, boxOf } = await deckAt($, on, 120, { cards: { size: 'mini' } }, listed)
  await clock.advance(2000)
  await ui.redraw()
  expect((await boxOf('card-scout'))?.props.width).toBe(CARD_SIZES.mini.width)
  const live = await boxOf('agent-ag1')
  expect(live?.props.width).toBe(CARD_SIZES.full.width)
  expect(live?.props.borderStyle).toBeTruthy()
  await ui.unmount()
})

test('deck: cards.size overrides auto at any height', async ($, on) => {
  const { ui, label, boxOf } = await deckAt($, on, 120, { cards: { size: 'compact' } })
  expect(await label()).toBe('compact')
  // Compact: same border and width as full, two text rows of art instead of four.
  const box = await boxOf('card-scout')
  expect(box?.props.width).toBe(CARD_SIZES.compact.width)
  expect(box?.props.borderStyle).toBeTruthy()
  await ui.unmount()
})

test('z cycles auto, full, compact, mini, auto with a toast; its hotkey is off in a text box', async ($, on) => {
  const { seen, ui, label } = await deckAt($, on, 120)
  const button = async () => (await ui.find({ type: 'Button', key: 'size-cycle' })) as Found | undefined
  expect((await button())?.props.hotkey).toBe('z')
  const labels: (string | undefined)[] = []
  for (let i = 0; i < 4; i += 1) {
    await ui.press({ key: 'size-cycle' })
    await new Promise(resolve => setTimeout(resolve, 20))
    await ui.redraw()
    labels.push(await label())
  }
  expect(labels).toEqual(['full', 'compact', 'mini', 'auto·full'])
  expect(seen.toasts).toEqual([
    'Cards: full · z cycles',
    'Cards: compact · z cycles',
    'Cards: mini · z cycles',
    'Cards: auto (full fits now) · z cycles',
  ])
  for (const input of ['launch-input', 'filter-input']) {
    await $.ui.focus({ component: 'Pane', requestId: 'grimling', element: input, origin: { kind: 'person' } })
    await ui.redraw()
    expect((await button())?.props.hotkey).toBeUndefined()
  }
  await ui.unmount()
})

// Arrows at each size: the deck's own moves, read from its debug log as in
// nav.test.tsx. 7 cards (5 built-ins, Workflows, Swarm).
const scrollOf = (by: number) => ({
  component: 'Pane' as const,
  requestId: 'grimling',
  offset: 0,
  by: Math.abs(by) === 122 ? Math.sign(by) * 122 : by,
  bodyRows: 120,
  contentRows: 122,
  origin: { kind: 'person' as const },
})
const UP = -1
const DOWN = 1
const LEFT = -122
const RIGHT = 122

async function arrows($: Engine, on: On, size: string) {
  const d = await deckAt($, on, 120, { cards: { size } })
  const sent = async () => {
    await new Promise(resolve => setTimeout(resolve, 30))
    const lines = (d.files[DEBUG_LOG] ?? '').split(String.fromCharCode(10)).filter(l => / arrow /.test(l))
    const last = lines.at(-1)
    return last ? (JSON.parse(last.slice(last.indexOf('{'))) as { to: string | null }).to : undefined
  }
  const press = async (by: number) => {
    await $.ui.scroll(scrollOf(by))
    const to = await sent()
    if (to) await $.ui.focus({ component: 'Pane', requestId: 'grimling', element: to, origin: { kind: 'plugin', name: 'grimling' } })
    await d.ui.redraw()
    return to
  }
  const ring = async (element: string) => {
    await $.ui.focus({ component: 'Pane', requestId: 'grimling', element, origin: { kind: 'person' } })
    await d.ui.redraw()
  }
  return { ...d, press, ring }
}

for (const size of ['full', 'compact'] as const) {
  test(`arrows at ${size}: 4 across, column kept; the size button is not on the path`, async ($, on) => {
    const { ui, press, ring } = await arrows($, on, size)
    await ring('card-scout')
    expect(await press(RIGHT)).toBe('card-builder')
    expect(await press(DOWN)).toBe('card-workflows')
    expect(await press(LEFT)).toBe('card-guide')
    expect(await press(UP)).toBe('card-scout')
    // Fetch (column 3) down to the short row's last card, and back to column 3.
    await ring('card-fetcher')
    expect(await press(DOWN)).toBe('card-swarm')
    expect(await press(UP)).toBe('card-fetcher')
    // Up from the cards: the find box, chips, launch box; never size-cycle.
    expect(await press(UP)).toBe('filter-input')
    expect(await press(UP)).toMatch(/^cat-/)
    expect(await press(UP)).toBe('launch-input')
    await ui.unmount()
  })
}

test('arrows at mini: 3 across, Left/Right along a row, column kept through the short last row', async ($, on) => {
  const { ui, press, ring } = await arrows($, on, 'mini')
  await ring('card-scout')
  expect(await press(RIGHT)).toBe('card-builder')
  expect(await press(RIGHT)).toBe('card-planner')
  expect(await press(RIGHT)).toBeNull()
  expect(await press(DOWN)).toBe('card-workflows')
  expect(await press(DOWN)).toBe('card-swarm')
  expect(await press(UP)).toBe('card-workflows')
  expect(await press(LEFT)).toBe('card-guide')
  expect(await press(LEFT)).toBe('card-fetcher')
  expect(await press(UP)).toBe('card-scout')
  await ui.unmount()
})

test('at mini the selection, Enter and the Workflows card work as at full', async ($, on) => {
  on('ui.copy', () => ({ value: {} }))
  const { seen, ui, ring, press } = await arrows($, on, 'mini')
  await ring('card-planner')
  const name = (await ui.find({ type: 'Button', key: 'card-planner' })) as Found | undefined
  expect(JSON.stringify(name)).toContain('"inverse":true')
  // Enter on a card makes it the launch target: the dex line names it.
  await ui.press({ key: 'card-planner' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Planner/ })).toBeTruthy()
  // Filters still apply.
  await ui.press({ key: 'cat-web' })
  await ui.redraw()
  const keys = ((await ui.findAll({ type: 'Button' })) as Found[]).map(b => String(b.key ?? '')).filter(k => k.startsWith('card-'))
  expect(keys).toEqual(['card-fetcher'])
  await ui.press({ key: 'cat-all' })
  await ui.redraw()
  await ring('card-workflows')
  expect(await press(DOWN)).toBe('card-swarm')
  // Enter on the Workflows card goes to the link (opened, or copied with no browser).
  await ui.press({ key: 'card-workflows' })
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(seen.toasts.join(' ')).toContain('the Claude Workflow Library')
  await ui.unmount()
})
