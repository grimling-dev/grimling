export type Tab = 'deck' | 'flow' | 'table' | 'pods' | 'keys' | 'arena' | 'feedback' | 'setup'

// The live agent the deck is acting on: a running one waiting for a message,
// a finished one showing its answer, or one the Stop / Keep confirm is up for.
export type Armed =
  | { kind: 'message'; agentId: string }
  | { kind: 'result'; agentId: string }
  | { kind: 'stop'; agentId: string }

// A stop the deck asked for: TaskStop in flight, or answered without error.
export type StopState = 'pending' | 'stopped'

// One Grimoire entry: a built-in, an agent file or a prompt template. `type`
// is the subagent type it spawns; `fill` is a template's id instead, `text`
// its body and `tag` "proj" when a project folder gave it; `art` is an 8x8
// sprite from dex.json or the template (absent: drawn art or a creature).
export type DexEntry = {
  id: string
  no: number
  name: string
  // The card label when the name does not fit beside its hotkey (6 columns).
  short?: string
  type?: string
  fill?: string
  text?: string
  tag?: 'proj'
  what: string
  cat: string
  art?: string[]
  // A link card (Workflows): Enter opens this page in the default browser.
  // It never launches an agent and never fills the prompt.
  link?: { url: string; title: string }
  // A second line under the card's dex entry.
  note?: string
  source: 'builtin' | 'pack' | 'user' | 'project'
}

export type TrackedAgent = {
  id: string
  description: string
  type: string
  status: string
  parentId?: string
  firstSeen: number
  endedAt?: number
  // Polls in a row this agent was missing from agent.list(); at 5 it is 'gone'.
  missing?: number
  // When this agent's current wait began (status 'waiting'); unset otherwise.
  waitSince?: number
}

// One past spawn from the run log, for the deck's recent list.
export type RecentRun = { agentId: string; type: string; description: string; prompt: string; at: string }

// What the owner's status line shows, for the meter under the tabs: context
// use, plan limits (0-100), when the session began, and active sessions.
export type Meter = {
  ctxPct?: number
  ctxTokens?: number
  window: number
  // reset: the window reset and the host has not reported the new one yet (0%).
  // eta: when (epoch ms) the window is forecast to reach 100% at the recent
  // burn rate; etaFrom: when the percentage last moved (the forecast runs from there).
  limits: { kind: string; pct: number; resetsAt?: string; reset?: boolean; eta?: number; etaFrom?: number }[]
  startedAt: number
  sessions: number
}

// Arena lite: one fighter's side of a battle, the battle, a card's record.
export type ArenaSide = {
  card: string
  agentId?: string
  answer?: string
  correct?: boolean
  durationMs?: number
  tokens?: number
}
export type ArenaBattle = {
  challenge: string
  red: ArenaSide
  blue: ArenaSide
  startedAt: number
  winner?: 'red' | 'blue' | 'draw'
  // The model both fighters ran on (arena.model when the fight started).
  model?: string
}
// An Arena puzzle; `accept`: other answers that also count as right.
export type ArenaPuzzle = { id: string; title: string; question: string; answer: string; accept?: string[] }
export type ArenaRecord = { wins: number; losses: number; draws: number; rating: number }
export type ArenaPick = { red: string; blue: string; challenge: number }

// Grim, the mascot: what it is saying in the pane and until when; `frame`
// is the sprite frame on screen (wave on arrival, then idle/flick/blink).
export type GrimFrame = 'idle' | 'flick' | 'blink' | 'wave'
// `report`: for a failed agent, the message `f` starts a feedback report with.
export type GrimSay = {
  text: string
  at: number
  until: number
  event: 'done' | 'failed' | 'killed' | 'thanks' | 'waiting'
  report?: string
}

// /grimling-feedback: the report being previewed (nothing is sent until Send).
export type FeedbackDraft = {
  kind: 'bug' | 'idea' | 'praise'
  message: string
  diagnostics: string
  from: 'command' | 'grim' | 'nudge'
}

// /grimling-setup ask: the answers picked so far (only keys the person
// pressed) and settings.json's text when the flow opened (null: no file).
// Write writes only while the file still has that text.
export type SetupDraft = { answers: Record<string, string | boolean>; base: string | null }

// ~/.claude/grimling/settings.json, every key with a default (hooks/settings.ts
// DEFAULTS; schema/settings.schema.json for editors).
export type LogMode = 'full' | 'redacted' | 'meta' | 'off'
export type GrimEvent = 'done' | 'failed' | 'killed'
export type CardSizeMode = 'auto' | 'full' | 'compact' | 'mini'
export type Settings = {
  time: { zone: string; clock: '12h' | '24h'; showUtc: boolean }
  // Empty `lines` lists use the built-in lines.
  // waiting: Grim pops up once when an agent starts waiting (built-in lines only).
  grim: { enabled: boolean; seconds: number; waiting: boolean; lines: Record<GrimEvent, string[]> }
  notify: { toast: boolean; desktop: boolean; events: GrimEvent[] }
  cards: {
    builtins: boolean
    pack: boolean
    user: boolean
    project: boolean
    packs: { path: string; ns?: string }[]
    hide: string[]
    // Grimoire card size: auto picks the largest at which the whole deck fits.
    size: CardSizeMode
  }
  templates: { enabled: string[] }
  pods: { enabled: 'auto' | 'on' | 'off'; files: string[]; staleAfterS: number | null }
  arena: { model: string; puzzlesFile: string | null }
  log: {
    runs: LogMode
    promptChars: number
    answerChars: number
    maxBytes: number
    keepDays: number
    redact: string[]
    debug: 'all' | 'errors' | 'off'
  }
  meter: { sessionsFile: string | null }
  agentDex: { rulesBlock: string | null; afterSave: string | null }
  feedback: { repo: string; nudge: boolean }
  // The stop button on running cards the deck launched.
  stop: { enabled: boolean }
  // Arrow keys move the focus ring around the pane (false: as before).
  keys: { arrows: boolean }
}

// Inside `declare module 'claude-code'` the name Settings is the engine's own
// (the settings files), so the contract names ours by this alias.
export type GrimlingSettings = Settings

// A settings key that could not be used: the dotted key (or file) and why.
export type SettingProblem = { path: string; message: string }
// The last settings load: its problems and the files it read.
export type SettingsReport = { problems: SettingProblem[]; files: string[] }

export type AgentUsage = { tokensIn: number; tokensOut: number; model: string }

export type PodRun = [name: string, progress: number, state: string]

export type PodStatus = {
  pod: string
  pct: number
  phase: string
  runs: PodRun[]
  reachable: boolean
  gpu: number
  cpu: number
  cost: number
  deadline: string
  updated: number
  // The watcher's write interval in seconds, when it says so.
  intervalS?: number
}

declare module 'claude-code' {
  interface PluginState {
    grimling: {
      tab: Tab
      agents: Shaped<TrackedAgent[]>
      usage: Shaped<Record<string, AgentUsage>>
      pod: Shaped<PodStatus | null>
      costUsd: number
      selected: string | null
      tour: number | null
      armed: Shaped<Armed | null>
      answers: Shaped<Record<string, string>>
      focusKey: string | null
      roster: Shaped<DexEntry[]>
      target: string
      draft: string
      dexCat: string
      dexText: string
      recent: Shaped<RecentRun[]>
      meter: Shaped<Meter | null>
      arenaPick: Shaped<ArenaPick>
      battle: Shaped<ArenaBattle | null>
      records: Shaped<Record<string, ArenaRecord>>
      puzzles: Shaped<ArenaPuzzle[]>
      grim: Shaped<GrimSay | null>
      grimFrame: GrimFrame
      settings: Shaped<GrimlingSettings>
      settingsProblems: Shaped<SettingsReport>
      feedback: Shaped<FeedbackDraft | null>
      setup: Shaped<SetupDraft | null>
      nudge: boolean
      launched: Shaped<string[]>
      stops: Shaped<Record<string, StopState>>
      // The session's card size from z (null: cards.size).
      cardSize: CardSizeMode | null
    }
  }
}
