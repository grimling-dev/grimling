import { expect, test } from 'claude-code/testing'
import { envHome } from './paths'

type On = Parameters<Parameters<typeof test>[1]>[1]
// Minimum the mod needs to start; the same quiet answers deck.test.tsx gives.
function quiet(on: On, list = true) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({ value: {} }))
  on('ui.toast', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.usage', () => ({ value: {} }))
  on('ui.status', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  if (list) on('fs.list', () => ({ value: [] }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
}

// Prototype for the deck's stop button. Calls the API the way the button
// would, $.tool.call({ tool: 'TaskStop', task_id }), so it goes through the
// permission check. Nothing here touches hooks/register.tsx.

test('harness limit: nothing beneath the plugins stops a real agent', async ($, on) => {
  quiet(on)
  on('agent.list', () => ({ value: [{ id: 'ag1', description: 'scan', type: 'Explore', status: 'running' }] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // No core tool runner and no permission engine exist in the harness.
  await expect($.tool.call({ tool: 'TaskStop', task_id: 'ag1' })).rejects.toThrow('no implementation for tool.call')
})

test('an ask on TaskStop reaches the permission check; with no person to say yes the call is denied', async ($, on) => {
  quiet(on)
  const checked: unknown[] = []
  on('tool.check', (_, e) => {
    checked.push(e)
    return { decision: 'ask', reason: 'Grimling: stop agent ag1?' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'TaskStop', task_id: 'ag1' })
  expect(JSON.stringify(checked)).toContain('"task_id":"ag1"')
  expect(r.isError).toBe(true)
  expect(r.text).toContain('Permission to use TaskStop has been denied')
})

test("an allowed TaskStop is the tool.call a button raises; a stub answers in the tool's output shape", async ($, on) => {
  quiet(on)
  const called: unknown[] = []
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', (_, e) => {
    called.push(e)
    return { result: { message: 'Successfully stopped task: ag1', task_id: 'ag1', task_type: 'local_agent' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.tool.call({ tool: 'TaskStop', task_id: 'ag1' })
  expect(JSON.stringify(called)).toContain('"tool":"TaskStop"')
  expect(JSON.stringify(r.result)).toContain('Successfully stopped')
})
