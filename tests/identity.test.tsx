import { expect, mock, test } from 'claude-code/testing'
import { envHome, HOME, PROJ } from './paths'

import { PLUGIN_ID, backoff, deniedMessage, identityProblem, isOwnerDenied } from '../hooks/identity'

// A session that loaded the mod under an older name (an old name) gets every
// state write refused by the host. The atoms must name the plugin id as a
// literal, so the mod cannot re-key them: it says, once, to restart.

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const DENIED =
  "old-name: state.set: denied: grimling owns that value and only its owner writes it (to change what is written, hook grimling's state.set and rewrite e.value) (host check)"

function quiet(on: On, own = true) {
  const seen = { toasts: [] as string[], logs: [] as string[], files: {} as Record<string, string> }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  // own = false: the test brings its own clock and agent list.
  if (own) {
    on('clock.every', () => ({ value: undefined }))
    on('clock.now', () => ({ value: 1_000_000 }))
    on('agent.list', () => ({ value: [] }))
  }
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const p = String(e.path).replaceAll('\\', '/')
    if (p in seen.files) return { value: seen.files[p] ?? '' }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    seen.files[String(e.path).replaceAll('\\', '/')] = e.text
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  return seen
}

test('identityProblem names an old running name and is quiet for the own one', () => {
  expect(PLUGIN_ID).toBe('grimling')
  expect(identityProblem('grimling')).toBeNull()
  expect(identityProblem('')).toBeNull()
  expect(identityProblem('old-name')).toContain('"old-name"')
  expect(identityProblem('old-name')).toContain('Start a new Claude Code session')
})

test('isOwnerDenied knows the host refusal and nothing else', () => {
  expect(isOwnerDenied(new Error(DENIED))).toBe(true)
  expect(isOwnerDenied(new Error('ENOENT: no such file'))).toBe(false)
  expect(isOwnerDenied('state.set: denied: something else')).toBe(false)
  expect(deniedMessage('grimling')).toContain('Start a new Claude Code session')
})

test('a refused state write shows one restart toast and one transcript line', async ($, on) => {
  const seen = quiet(on)
  // The host's own refusal, as the live session gave it for every write.
  on('state.set', (_, e, next) => (e.key === 'roster' ? { deny: DENIED } : next(e)))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 50))

  const restart = seen.toasts.filter(t => t.includes('Start a new Claude Code session'))
  expect(restart.length).toBe(1)
  expect(seen.logs.filter(t => t.includes('Start a new Claude Code session')).length).toBe(1)
  expect(seen.files[`${HOME}/.claude/grimling/debug.log`] ?? '').toContain('identity.error')
})

test('a normal start shows no restart notice', async ($, on) => {
  const seen = quiet(on)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(seen.toasts.join('\n')).not.toContain('Start a new Claude Code session')
})

test('backoff: nothing skipped until a refusal, then gaps that double up to the cap', () => {
  const b = backoff(4)
  expect(b.skip()).toBe(false)
  b.denied()
  // gap 1: skip one, run one
  expect([b.skip(), b.skip()]).toEqual([true, false])
  b.denied()
  b.denied()
  b.denied() // capped at 4
  expect(b.gap).toBe(4)
  expect([b.skip(), b.skip(), b.skip(), b.skip(), b.skip()]).toEqual([true, true, true, true, false])
})

test('backoff: reset after a run with no refusal goes back to every tick', () => {
  const b = backoff(8)
  b.denied()
  b.denied()
  expect(b.gap).toBe(2)
  b.reset()
  expect(b.gap).toBe(0)
  expect([b.skip(), b.skip(), b.skip()]).toEqual([false, false, false])
  // A later refusal starts again at the smallest gap.
  b.denied()
  expect(b.gap).toBe(1)
})

test('polls go back to every tick once writes are accepted again', async ($, on) => {
  quiet(on, false)
  const clock = mock.clock(on, { now: 1_000_000 })
  let refuse = true
  let refused = 0
  let lists = 0
  // A new elapsed time on every call, so each agents poll writes.
  on('agent.list', () => {
    lists++
    return {
      value: [{ id: 'a1', description: 'scout', status: 'running', subagentType: 'Explore', startedAt: 1_000_000 - lists * 1000 }],
    }
  })
  on('state.set', (_, e, next) => {
    if (!refuse) return next(e)
    refused++
    return { deny: DENIED }
  })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.settle()
  for (let i = 0; i < 60; i++) await clock.advance(2000)
  expect(refused).toBeGreaterThan(0)
  // Writes are accepted again: within the longest gap the poll runs, resets,
  // and from then on lists the agents on every tick.
  refuse = false
  for (let i = 0; i < 70; i++) await clock.advance(2000)
  const at = lists
  for (let i = 0; i < 10; i++) await clock.advance(2000)
  expect(lists - at).toBeGreaterThanOrEqual(9)
})


test('a write refused on every poll backs off and leaves no poll.error lines (B7)', async ($, on) => {
  const seen = quiet(on, false)
  const clock = mock.clock(on, { now: 1_000_000 })
  let refused = 0
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'scout', status: 'running', subagentType: 'Explore', startedAt: 1_000_000 }],
  }))
  on('state.set', () => {
    refused++
    return { deny: DENIED }
  })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const atStart = refused
  // Three minutes of 2 s polls: 90 ticks without the back-off.
  for (let i = 0; i < 90; i++) await clock.advance(2000)
  expect(refused - atStart).toBeLessThan(20)
  expect(seen.toasts.filter(t => t.includes('Start a new Claude Code session')).length).toBe(1)
  const log = seen.files[`${HOME}/.claude/grimling/debug.log`] ?? ''
  expect(log).not.toContain('poll.error')
  expect(log.split('identity.error').length - 1).toBeLessThan(2)
})

declare global {
  // The test runtime has timers; the mod's lib does not declare them.
  var setTimeout: (fn: (...args: never[]) => void, ms: number) => unknown
}
