// Grimling's own plugin id, as plugin.json names it.
//
// Every atom names it as a literal (`atom({ plugin: 'grimling', key })`): the
// engine requires `plugin` and `key` to be literals in source, so `claude
// plugin validate` can list what a module reads and writes, and the contract
// in types/index.d.ts declares the values under this name. The id cannot be
// taken from `$.plugin.name` at run time.
//
// So when a session loaded this folder under another name (a session started
// before a rename of the plugin), every `$.state.set` is refused by the host
// ("grimling owns that value") and the pane silently loses its cards and
// settings. The checks below turn that into one clear message: start a new
// session.
export const PLUGIN_ID = 'grimling'

// The message for a session that loaded the mod under another name, else null.
export function identityProblem(runningName: string): string | null {
  if (!runningName || runningName === PLUGIN_ID) return null
  return (
    `Grimling is loaded under the old name "${runningName}" in this session, so it cannot save its state ` +
    '(cards, settings, Grim). Start a new Claude Code session to fix it.'
  )
}

// Whether an error is the host refusing a state write this plugin does not own.
export function isOwnerDenied(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err)
  return /state\.set: denied/.test(text) && /owns that value/.test(text)
}

// The one-time message for a refused write, naming the running name when known.
export function deniedMessage(runningName: string): string {
  return (
    identityProblem(runningName) ??
    'Grimling could not save its state: Claude Code refused the write (the mod may be loaded under an old name). ' +
      'Start a new Claude Code session to fix it.'
  )
}

// Poll back-off after a refused write: the refusal lasts until
// a restart, so retrying every 2 s only fills debug.log. Each refusal doubles
// the ticks skipped before the next try, up to `max` (64 ticks = ~2 min at 2 s).
// A run with no refusal calls reset(), so a one-off refusal does not slow that
// poll for the rest of the session.
export function backoff(max = 64) {
  let gap = 0
  let skipped = 0
  return {
    // A write was refused: wait twice as long before the next run.
    denied() {
      gap = Math.min(max, Math.max(1, gap * 2))
      skipped = 0
    },
    // A run finished with nothing refused: back to every tick.
    reset() {
      gap = 0
      skipped = 0
    },
    // Whether this tick should be skipped.
    skip(): boolean {
      if (gap === 0) return false
      if (skipped < gap) {
        skipped++
        return true
      }
      skipped = 0
      return false
    },
    get gap() {
      return gap
    },
  }
}
