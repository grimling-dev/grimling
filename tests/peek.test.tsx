import { expect, test } from 'claude-code/testing'
import { envHome, slash } from './paths'
import type { AgentStatus } from 'claude-code'

// Transcript peek: v on a live card (or in a finished agent's answer box)
// asks the engine to show that agent's transcript in the main view; v again
// goes back. Only ever from a press; a deny is toasted, never hidden.

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
type Listed = { id: string; description: string; type: string; status: AgentStatus }

const settle = async (ui: { redraw: () => Promise<unknown> }) => {
  await new Promise(resolve => setTimeout(resolve, 50))
  await ui.redraw()
}

// A person moving the ring onto an element the deck drew.
const ringTo = (element: string) => ({
  component: 'Pane' as const,
  requestId: 'grimling',
  element,
  origin: { kind: 'person' as const },
})

function stubs(on: On, listed: Listed[], answer: { deny?: string } = {}) {
  const seen = { toasts: [] as string[], views: [] as { agentId?: string }[] }
  const files: Record<string, string> = {}
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({}))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.view', (_, e) => {
    seen.views.push(e)
    return { value: answer }
  })
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const path = slash(e.path)
    if (path in files) return { value: files[path] ?? '' }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    files[slash(e.path)] = String(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slash(e.path) in files }))
  on('agent.list', () => ({ value: listed }))
  return seen
}

const RUNNING: Listed[] = [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'running' }]
const DONE: Listed[] = [{ id: 'ag1', description: 'scan repo', type: 'Explore', status: 'completed' }]

test('peek: v on a running card opens its transcript and warns where the next prompt goes', async ($, on) => {
  const seen = stubs(on, RUNNING)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  // No peek row until the ring is on the card.
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeUndefined()

  await $.ui.focus(ringTo('agent-ag1'))
  await ui.redraw()
  const row = await ui.find({ type: 'Button', key: 'agent-view' })
  expect(row?.props.hotkey).toBe('v')
  expect(await ui.find({ type: 'Text', text: /\[v\] transcript: scan repo/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /v: transcript/ })).toBeTruthy()

  await ui.press({ key: 'agent-view' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(seen.views[0]?.agentId).toBe('ag1')
  const toasts = seen.toasts.join('\n')
  expect(toasts).toContain('Showing')
  expect(toasts).toContain('next prompt goes to this agent')

  // The row stays while the ring is on the row itself.
  await $.ui.focus(ringTo('agent-view'))
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeTruthy()
  // And goes once the ring leaves for something else.
  await $.ui.focus(ringTo('tab-deck'))
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeUndefined()
  await ui.unmount()
})

test('peek: no v while typing in the launch box', async ($, on) => {
  stubs(on, RUNNING)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await $.ui.focus(ringTo('launch-input'))
  await ui.redraw()
  const row = await ui.find({ type: 'Button', key: 'agent-view' })
  expect(row === undefined || row.props.hotkey === undefined).toBe(true)
  await ui.unmount()
})

test('peek: a finished agent gets v in its answer box, not a peek row', async ($, on) => {
  const seen = stubs(on, DONE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await $.ui.focus(ringTo('agent-ag1'))
  await ui.redraw()
  expect(await ui.find({ type: 'Button', key: 'agent-view' })).toBeUndefined()

  await ui.press({ key: 'agent-ag1' })
  const view = await ui.find({ type: 'Button', key: 'ans-view' })
  expect(view?.props.hotkey).toBe('v')
  expect(await ui.find({ type: 'Text', text: /v transcript/ })).toBeTruthy()
  // The other answer-box keys are unchanged.
  expect((await ui.find({ type: 'Button', key: 'ans-copy' }))?.props.hotkey).toBe('c')
  expect((await ui.find({ type: 'Button', key: 'ans-close' }))?.props.hotkey).toBe('x')

  await ui.press({ key: 'ans-view' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(seen.views[0]?.agentId).toBe('ag1')
  await ui.unmount()
})

test('peek: an engine deny is toasted with its reason', async ($, on) => {
  const seen = stubs(on, RUNNING, { deny: 'no row for it' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await settle(ui)
  await $.ui.focus(ringTo('agent-ag1'))
  await ui.redraw()
  await ui.press({ key: 'agent-view' })
  await new Promise(resolve => setTimeout(resolve, 20))
  const toasts = seen.toasts.join('\n')
  expect(toasts).toContain('Transcript not shown: no row for it')
  expect(toasts).not.toContain('Showing')
  await ui.unmount()
})

test('peek: with the agent already in view, v goes back to the main conversation', async ($, on) => {
  const seen = stubs(on, RUNNING)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, view: { agentId: 'ag1' } }, surface: 'terminal' })
  await settle(ui)
  await $.ui.focus(ringTo('agent-ag1'))
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /back to main view/ })).toBeTruthy()
  await ui.press({ key: 'agent-view' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(seen.views).toHaveLength(1)
  expect(seen.views[0]?.agentId).toBeUndefined()
  expect(seen.toasts.join('\n')).toContain('Back to the main conversation')
  await ui.unmount()
})

test('peek: with a finished agent already in view, its answer box says back', async ($, on) => {
  const seen = stubs(on, DONE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, view: { agentId: 'ag1' } }, surface: 'terminal' })
  await settle(ui)
  await $.ui.focus(ringTo('agent-ag1'))
  await ui.redraw()
  await ui.press({ key: 'agent-ag1' })
  expect(await ui.find({ type: 'Text', text: /^back$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /v back to main/ })).toBeTruthy()
  await ui.press({ key: 'ans-view' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(seen.views[0]?.agentId).toBeUndefined()
  expect(seen.toasts.join('\n')).toContain('Back to the main conversation')
  await ui.unmount()
})
