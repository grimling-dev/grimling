import { expect, test } from 'claude-code/testing'

import { isCutBrief, launchClash, worktreePaths } from '../hooks/launch'

// The launch box's clash check: two agents on one brief, or
// in one worktree, raced and one gave up.

test('worktreePaths: the folder under a worktrees segment, any slash style, lower case', () => {
  expect(worktreePaths('cd D:\\work\\myapp-worktrees\\live-fixes and fix it')).toEqual([
    'd:/work/myapp-worktrees/live-fixes',
  ])
  expect(worktreePaths('edit `~/repo/.claude/worktrees/b6/hooks/x.ts`.')).toEqual(['~/repo/.claude/worktrees/b6'])
  expect(worktreePaths('the folder C:/x/myapp-worktrees alone')).toEqual([])
  expect(worktreePaths('no paths here')).toEqual([])
})

test('launchClash: same brief (whitespace aside), a capped log brief, a shared worktree, else null', () => {
  const brief = 'Build the release tools in C:/w/App-worktrees/rel. Report back with a summary of the commits.'
  const running = [
    { id: 'a', description: 'release', prompt: `${brief.slice(0, 60)}…[+40]` },
    { id: 'b', description: 'other', prompt: 'Polish the docs in C:/w/App-worktrees/docs' },
  ]
  expect(launchClash(`  ${brief.replace(' ', '\n')} `, [{ id: 'z', description: 'z', prompt: brief }])?.why).toBe('brief')
  expect(launchClash(brief, running)?.agent.id).toBe('a')
  const wt = launchClash('Fix a typo in c:\\w\\App-worktrees\\docs\\README.md', running)
  expect(wt?.why).toBe('worktree')
  expect(wt?.agent.id).toBe('b')
  expect(launchClash('Something new in C:/w/App-worktrees/fresh', running)).toBeNull()
  expect(launchClash('anything', [{ id: 'q', description: 'q', prompt: '' }])).toBeNull()
})

test('isCutBrief: a capped or redacted run-log brief', () => {
  expect(isCutBrief('do the thing…[+1359]')).toBe(true)
  expect(isCutBrief('use token: [redacted] then go')).toBe(true)
  expect(isCutBrief('a whole brief.')).toBe(false)
})
