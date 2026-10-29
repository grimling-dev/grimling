// The launch box's checks before a spawn: another running
// agent already on the same brief, or working in the same worktree, and a
// brief that came back from the run log cut short or redacted.
//
// Pure functions: the deck hands in the running agents and their briefs.

export type RunningBrief = { id: string; description: string; prompt: string }
export type Clash = { agent: RunningBrief; why: 'brief' | 'worktree'; path?: string }

// The marker shapeRow leaves on a capped field: `…[+123]`.
const CUT = /…\[\+\d+\]$/

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()

// A brief the run log capped (log.promptChars) or redacted (log.runs): what
// the recent list holds is not the whole task.
export function isCutBrief(prompt: string): boolean {
  return CUT.test(prompt.trimEnd()) || prompt.includes('[redacted')
}

// The worktree folders a brief names: for each path with a segment that
// mentions "worktree" (`myapp-worktrees/x`, `.claude/worktrees/x`),
// the path up to the folder under it, slashes forward, lower case.
export function worktreePaths(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?:[A-Za-z]:|~)?[\\/][^\s`'"<>|*?,;()[\]{}]+/g)) {
    const parts = m[0].replaceAll('\\', '/').split('/')
    const at = parts.findIndex(p => /worktree/i.test(p))
    const next = at >= 0 ? parts[at + 1]?.replace(/[.:]+$/, '') : undefined
    if (!next) continue
    out.add([...parts.slice(0, at + 1), next].join('/').toLowerCase())
  }
  return [...out]
}

function sameBrief(task: string, stored: string): boolean {
  if (!stored) return false
  const a = norm(task)
  const b = norm(stored)
  if (a === b) return true
  // A capped log row: its kept start matches the task's start.
  if (CUT.test(b)) {
    const head = b.replace(CUT, '').trim()
    return head.length >= 40 && a.startsWith(head)
  }
  return false
}

// The first running agent that has this brief, else one in a worktree the
// brief also names; null when the launch clashes with nothing.
export function launchClash(task: string, running: readonly RunningBrief[]): Clash | null {
  for (const agent of running) if (sameBrief(task, agent.prompt)) return { agent, why: 'brief' }
  const mine = worktreePaths(task)
  if (!mine.length) return null
  for (const agent of running) {
    const theirs = worktreePaths(agent.prompt)
    const path = mine.find(p => theirs.includes(p))
    if (path) return { agent, why: 'worktree', path }
  }
  return null
}
