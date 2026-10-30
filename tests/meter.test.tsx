import { expect, mock, test } from 'claude-code/testing'
import type { SessionMeasureInput, SessionUsage } from 'claude-code'
import { envHome, slash } from './paths'

// The meter takes the engine's pushed readings (session.measure) and stops
// polling session.usage; each plan limit shows when it runs out at the
// recent burn rate. With no measure ever, the 2 s usage read stays.

const PANE = {
  plugin: 'grimling',
  component: 'Pane',
  requestId: 'grimling',
  props: {
    title: 'Grimling',
    isFocused: true,
    bodyColumns: 78,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 41 },
    view: {},
  },
} as const

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const T0 = Date.UTC(2026, 9, 29, 12, 0)
const RESET = new Date(T0 + 3 * 3_600_000).toISOString()
const MIN = 60_000

// Quiet answers for the engine (as deck.test.tsx's stubs, the clock left to
// mock.clock), and a session.usage that counts its calls.
function stubs(on: On, reading: () => Partial<SessionUsage>) {
  const seen = { usageCalls: 0 }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.usage', () => {
    seen.usageCalls++
    // A host that leaves parts out ({} here): the mod reads missing as empty.
    return { value: reading() as SessionUsage }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Core echoes { changed }; the test stands in for it beneath the mod.
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    throw new Error(`ENOENT ${slash(e.path)}`)
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  return seen
}

const measureOf = (pct: number): SessionMeasureInput => ({
  context: { window: 200_000, tokens: 50_000, percent: 25 },
  rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt: RESET }],
  cost: { usd: 1.5 },
  changed: ['rateLimits'],
})

test('session.measure drives the meter; the poll stops reading usage; the 5h row forecasts the limit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const seen = stubs(on, () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const first: SessionMeasureInput = {
    context: { window: 200_000, tokens: 50_000, percent: 25 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }],
    cost: { usd: 1.5 },
    changed: ['context', 'rateLimits', 'cost'],
  }
  const out = await $.session.measure(first)
  expect(out.changed).toEqual(first.changed)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /5h\s+\S+\s+40%/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /\$1\.50/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /limit in/ })).toBeUndefined()

  // Pushed readings: the 2 s poll no longer asks for usage.
  const calls = seen.usageCalls
  await clock.advance(2000)
  await clock.advance(2000)
  await clock.advance(2000)
  expect(seen.usageCalls).toBe(calls)

  // 40 -> 44 over 4 minutes: a point a minute, 56 minutes to 100%.
  await clock.advance(4 * MIN - 6000)
  await $.session.measure(measureOf(44))
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /limit in ~56m/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /5h\s+\S+\s+44%.*limit in ~56m.*resets/ })).toBeTruthy()
  // Not on the context row.
  expect(await ui.find({ type: 'Text', text: /ctx.*limit in/ })).toBeUndefined()
  expect(seen.usageCalls).toBe(calls)
  // Inline, the forecast follows the limit's figure.
  await ui.unmount()
  const inline = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline' }, surface: 'terminal' })
  expect(await inline.find({ type: 'Text', text: /5h 44% ~56m/ })).toBeTruthy()
  // The window reset: no forecast.
  await clock.advance(MIN)
  await $.session.measure(measureOf(3))
  await inline.redraw()
  expect(await inline.find({ type: 'Text', text: /5h 3%/ })).toBeTruthy()
  expect(await inline.find({ type: 'Text', text: /~\d+m/ })).toBeUndefined()
  await inline.unmount()
  const docked = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await docked.find({ type: 'Text', text: /5h\s+\S+\s+3%/ })).toBeTruthy()
  expect(await docked.find({ type: 'Text', text: /limit in/ })).toBeUndefined()
  await docked.unmount()
})

test('a forecast is hidden once its reading is 15 minutes old', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  stubs(on, () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.session.measure(measureOf(40))
  await clock.advance(4 * MIN)
  await $.session.measure(measureOf(44))
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /limit in ~56m/ })).toBeTruthy()
  await clock.advance(10 * MIN)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /limit in ~46m/ })).toBeTruthy()
  await clock.advance(5 * MIN)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /limit in/ })).toBeUndefined()
  await ui.unmount()
})

test('no session.measure: the 2 s usage read drives the meter and its forecast', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  let pct = 40
  const seen = stubs(on, () => ({
    startedAt: T0,
    context: { window: 200_000, tokens: 50_000, percent: 25 },
    rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt: RESET }],
    cost: { usd: 1.5 },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await clock.advance(2000)
  const calls = seen.usageCalls
  expect(calls).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /5h\s+\S+\s+40%/ })).toBeTruthy()
  await clock.advance(4 * MIN - 2000)
  pct = 44
  await clock.advance(2000)
  expect(seen.usageCalls).toBeGreaterThan(calls)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /limit in ~56m/ })).toBeTruthy()
  // Unchanged readings keep the forecast where it was, counting down.
  await clock.advance(MIN)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /limit in ~55m/ })).toBeTruthy()
  // Still unchanged 15 minutes after the percentage last moved: hidden, though
  // readings kept coming.
  await clock.advance(14 * MIN)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /limit in/ })).toBeUndefined()
  await ui.unmount()
})

test('a reading pushed while the poll carries a reset is not overwritten', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  stubs(on, () => ({}))
  let armed = false
  let injected = 0
  on('state.set', async (_, e, next) => {
    if (armed && e.key === 'meter') {
      // The poll is writing the 0% carry: a fresh window lands first.
      armed = false
      injected++
      await $.session.measure({
        ...measureOf(2),
        rateLimits: [{ kind: 'five_hour', percentUsed: 2, resetsAt: new Date(T0 + 5 * 3_600_000).toISOString() }],
      })
    }
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.session.measure({
    ...measureOf(44),
    rateLimits: [{ kind: 'five_hour', percentUsed: 44, resetsAt: new Date(T0 + MIN).toISOString() }],
  })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /5h\s+\S+\s+44%/ })).toBeTruthy()
  armed = true
  await clock.advance(2 * MIN)
  await ui.redraw()
  expect(injected).toBe(1)
  expect(await ui.find({ type: 'Text', text: /5h\s+\S+\s+2%/ })).toBeTruthy()
  await ui.unmount()
})
