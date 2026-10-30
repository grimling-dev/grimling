import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type {
  AgentUsage,
  ArenaBattle,
  ArenaPick,
  ArenaRecord,
  ArenaSide,
  Armed,
  DexEntry,
  FeedbackDraft,
  GrimEvent,
  GrimFrame,
  GrimSay,
  Meter,
  PodStatus,
  RecentRun,
  SettingProblem,
  Settings,
  SettingsReport,
  SetupDraft,
  StopState,
  Tab,
  TrackedAgent,
} from '../types'
import { PALETTE, SWARM_TEMPLATE, TEMPLATE_ID, cardForType, fillTemplate, isHidden, parseTemplate, readMeta, splitDoc, titleCase } from './dex'
import type { Meta, TemplateCard } from './dex'
import { CHALLENGES, arenaPrompt, decide, extractAnswer, isCorrect, parsePuzzles, rate, shareCard, why, withPuzzles } from './arena'
import { KINDS, buildFeedback, diagnosticsText, failurePrefill, kindFromArgs, openerFor } from './feedback'
import type { Outgoing } from './feedback'
import { fitDeck, windowAt } from './fit'
import { backoff, deniedMessage, identityProblem, isOwnerDenied } from './identity'
import { isCutBrief, launchClash } from './launch'
import { printable, printableFields } from './printable'
import { dayOf, debugWanted, keptFiles, parsePart, partName, redact, shapeRow, utf8Bytes } from './runlog'
import { DEFAULTS, expandHome, mergeProject, parseSettings, problemLine } from './settings'
import { USER_FILE, checkText, currentAnswers, emptyHint, fixFirst, modeOf, planWrite, questions, readUserFile, showText } from './setup'
import type { UserFile } from './setup'
import { carryLimits, killBy, resetTime, zoneOf } from './time'

// Grimling: a tab bar, a launch box and the Grimoire, a filterable grid of
// agent cards (built-ins plus every agent file on disk). Launch spawns a
// subagent; a live card takes a message or shows a finished agent's answer.
// Template cards (Swarm) only fill the prompt: the main session runs them
// under its own rules and the person sends them. Every spawn is
// logged to ~/.claude/grimling/runs/ (a file a day) for the agent-dex skill.
// It only stops an agent when you confirm (Stop / Keep), and only one the
// deck itself launched. It never stops, kills or changes a pod.

const PANE = 'grimling'
const TITLE = 'Grimling'
const INPUT = 'deck-input'
const LAUNCH = 'launch-input'
const FILTER = 'filter-input'
const FEEDBACK_INPUT = 'feedback-input'
// The feedback hint shows once, from this many session starts on.
const NUDGE_AFTER = 5
const POLL_MS = 2000
const POD_POLL_MS = 10000
const DEX_POLL_MS = 30000
// Parts a day may have before the log stops writing for that day.
const RUN_LOG_PARTS = 50
const ANSWER_CAP = 8000
const AGENT_CAP = 100
// Polls an agent may be missing from agent.list() before it counts as gone.
const GONE_AFTER = 5
// A pod file older than 3 watcher intervals is stale (180 s when the file
// does not say its interval).
const STALE_DEFAULT_S = 180
// While one of these has the ring, keys are typing: no button hotkeys.
const TYPING = new Set([INPUT, LAUNCH, FILTER, FEEDBACK_INPUT])

const tab = atom({ plugin: 'grimling', key: 'tab' } as const, 'deck' as Tab)
const agents = atom({ plugin: 'grimling', key: 'agents' } as const, [] as TrackedAgent[], {
  shape: 'agents-1',
})
const usage = atom(
  { plugin: 'grimling', key: 'usage' } as const,
  {} as Record<string, AgentUsage>,
  { shape: 'usage-1' },
)
const pod = atom({ plugin: 'grimling', key: 'pod' } as const, null as PodStatus | null, {
  shape: 'pod-1',
})
const costUsd = atom({ plugin: 'grimling', key: 'costUsd' } as const, 0)
const selected = atom({ plugin: 'grimling', key: 'selected' } as const, null as string | null)
const armed = atom({ plugin: 'grimling', key: 'armed' } as const, null as Armed | null, {
  shape: 'armed-2',
})
const answers = atom(
  { plugin: 'grimling', key: 'answers' } as const,
  {} as Record<string, string>,
  { shape: 'answers-1' },
)
const focusKey = atom({ plugin: 'grimling', key: 'focusKey' } as const, null as string | null)
const roster = atom({ plugin: 'grimling', key: 'roster' } as const, [] as DexEntry[], {
  shape: 'roster-2',
})
const target = atom({ plugin: 'grimling', key: 'target' } as const, 'builder')
const draft = atom({ plugin: 'grimling', key: 'draft' } as const, '')
const dexCat = atom({ plugin: 'grimling', key: 'dexCat' } as const, 'all')
const dexText = atom({ plugin: 'grimling', key: 'dexText' } as const, '')
// Arena lite: the fighters and challenge picked, the battle on, each card's record.
const arenaPick = atom(
  { plugin: 'grimling', key: 'arenaPick' } as const,
  { red: 'scout', blue: 'builder', challenge: 0 } as ArenaPick,
  { shape: 'arenaPick-1' },
)
const battle = atom({ plugin: 'grimling', key: 'battle' } as const, null as ArenaBattle | null, { shape: 'battle-1' })
// The Arena's puzzles: the built-in ones plus arena.puzzlesFile's.
const puzzles = atom({ plugin: 'grimling', key: 'puzzles' } as const, CHALLENGES, { shape: 'puzzles-1' })
const records = atom(
  { plugin: 'grimling', key: 'records' } as const,
  {} as Record<string, ArenaRecord>,
  { shape: 'records-1' },
)
const recent = atom({ plugin: 'grimling', key: 'recent' } as const, [] as RecentRun[], {
  shape: 'recent-1',
})
const RECENT_SHOWN = 6
// The status line's figures, for the meter under the tabs.
const meter = atom({ plugin: 'grimling', key: 'meter' } as const, null as Meter | null, { shape: 'meter-1' })
// Grim, the mascot: its line while it is up, the frame on screen; the
// settings from ~/.claude/grimling/settings.json and what was wrong in them.
const grim = atom({ plugin: 'grimling', key: 'grim' } as const, null as GrimSay | null, { shape: 'grim-1' })
const grimFrame = atom({ plugin: 'grimling', key: 'grimFrame' } as const, 'wave' as GrimFrame)
const settings = atom({ plugin: 'grimling', key: 'settings' } as const, DEFAULTS as Settings, {
  shape: 'settings-3',
})
const settingsProblems = atom(
  { plugin: 'grimling', key: 'settingsProblems' } as const,
  { problems: [], files: [] } as SettingsReport,
  { shape: 'settingsProblems-1' },
)
// /grimling-feedback: the report in the preview, and the one-time hint.
const feedback = atom({ plugin: 'grimling', key: 'feedback' } as const, null as FeedbackDraft | null, {
  shape: 'feedback-1',
})
const nudge = atom({ plugin: 'grimling', key: 'nudge' } as const, false)
// /grimling-setup ask: the answers picked in the pane and the file they go over.
const setup = atom({ plugin: 'grimling', key: 'setup' } as const, null as SetupDraft | null, {
  shape: 'setup-1',
})
// The stop button: ids of the agents the deck launched (only those get one),
// and the stops asked for (no double stop).
const launched = atom({ plugin: 'grimling', key: 'launched' } as const, [] as string[], { shape: 'launched-1' })
const stops = atom({ plugin: 'grimling', key: 'stops' } as const, {} as Record<string, StopState>, {
  shape: 'stops-1',
})

// The atoms above spell the plugin id 'grimling' as a literal, as the engine
// requires (see hooks/identity.ts): a session that loaded this folder under an
// older name gets every write refused, and warnIdentity says so once.

const TABS: Tab[] = ['deck', 'flow', 'table', 'pods', 'keys']
// Inline (above the prompt) the pane asks for few rows; docked it takes a column.
const OPEN = { id: PANE, title: TITLE, rows: 14, columns: 78 } as const

// 'gone': dropped from agent.list() before its end was seen.
const ENDED = new Set(['completed', 'failed', 'killed', 'gone'])
const BAD = new Set(['failed', 'killed'])
const GLYPH: Record<string, string> = {
  pending: '○', running: '◉', waiting: '◎', idle: '◌', completed: '●', failed: '✕', killed: '✕', gone: '·',
}
const COLOR: Record<string, string> = {
  pending: 'inactive', running: 'warning', waiting: 'suggestion', idle: 'subtle',
  completed: 'success', failed: 'error', killed: 'error', gone: 'inactive',
}
const CATS = ['all', 'code', 'research', 'web', 'ops', 'swarm', 'custom'] as const
const CAT_LABEL: Record<string, string> = { all: 'All', research: 'Rsch' }

// Pixel art: 8x8 sprites from PALETTE (hooks/dex.ts), drawn two pixel rows a
// text row with half blocks.
const SPRITES: Record<string, string[]> = {
  scout: ['.k....k.', 'kttttttk', 'twwttwwt', 'twkttwkt', 'tttyyttt', '.tttttt.', '.t.tt.t.', '..k..k..'],
  builder: ['...yy...', '.oooooo.', '.owoowo.', '.oooooo.', '..okko..', '.oooooo.', 'oo.oo.oo', '.k....k.'],
  planner: ['...pp...', '..pppp..', '.pppppp.', 'pppppppp', '..ssss..', '..swsw..', '..ssss..', '.pppppp.'],
  fetcher: ['b......b', 'bb....bb', '.bbbbbb.', '.bwbbwb.', '.bbkkbb.', '..brrb..', '.bbbbbb.', '.b.bb.b.'],
  guide: ['..yyyy..', '.yyyyyy.', '.ywyyyy.', '.yyyyyy.', '..yyyy..', '...kk...', '..kkkk..', '...kk...'],
  swarm: ['.yk..yk.', 'ykyk.yky', '.yk..yk.', '........', '..yk..yk', '.ykyk.yk', '..yk..yk', '........'],
  workflows: ['.bbbbbb.', 'bssssssb', '.skksks.', '.ssssss.', '.sksskk.', '.sssrss.', 'bssssssb', '.bbbbbb.'],
  gpu: ['.c.c.c.c', 'cccccccc', 'ckkkkkkc', 'ckgggkkc', 'ckgggkkc', 'ckkkkkkc', 'cccccccc', '.c.c.c.c'],
}

// Grim, the mascot: a little reaper with a scythe, 12x12, four frames, its
// own palette. It pops up with a speech bubble when an agent ends.
const GRIM_PAL: Record<string, string> = {
  R: '#3d3358', r: '#5c4f84', w: '#ece6d6', k: '#0f0c15', o: '#ff8c42', y: '#ffd23f', S: '#cfd6de', b: '#8a5a2b',
}
const GRIM: Record<GrimFrame, string[]> = {
  idle: ['..RRRR..SSS.', '.RRRRRR.b.SS', '.RwwwwR.b..S', '.RowwoR.b...', '.RRwwRR.b...', 'RRRRRRR.w...', 'RrRRRRR.b...', 'RrRRRRR.b...', '.RrRRRR.b...', '.RRRRRR.b...', 'R.R.R.R.b...', '........b...'],
  flick: ['..RRRR..SSS.', '.RRRRRR.b.SS', '.RwwwwR.b..S', '.RywwyR.b...', '.RRwwRR.b...', 'RRRRRRR.w...', 'RrRRRRR.b...', 'RrRRRRR.b...', '.RrRRRR.b...', '.RRRRRR.b...', 'R.R.R.R.b...', '........b...'],
  blink: ['..RRRR..SSS.', '.RRRRRR.b.SS', '.RwwwwR.b..S', '.RkwwkR.b...', '.RRwwRR.b...', 'RRRRRRR.w...', 'RrRRRRR.b...', 'RrRRRRR.b...', '.RrRRRR.b...', '.RRRRRR.b...', 'R.R.R.R.b...', '........b...'],
  wave: ['..RRRR..SSS.', '.RRRRRR.b.SS', '.RwwwwR.b..S', 'wRowwoR.b...', 'wRRwwRR.b...', 'RRRRRRR.w...', 'RrRRRRR.b...', 'RrRRRRR.b...', '.RrRRRR.b...', '.RRRRRR.b...', 'R.R.R.R.b...', '........b...'],
}
// What Grim says, per event; {name} is the card's name, {type} the agent
// type, {duration} how long it ran, {task} its description. The lines take
// turns so the same one does not come twice in a row.
const GRIM_LINES: Record<GrimSay['event'], string[]> = {
  done: [
    "{name}'s work is done. Answer ready.",
    '{name} finished in {duration}. Enter on its card to read it.',
    'It is done. {name} wrapped up "{task}".',
    '{name} returns from the beyond with an answer.',
  ],
  failed: [
    '{name} has met its end (failed).',
    '{name} failed after {duration}. Its card has the details.',
    '{name} ({type}) did not survive this one.',
  ],
  killed: ['{name} was stopped. Rest in peace.', '{name} was laid to rest after {duration}.', '{name} got called off: "{task}".'],
  thanks: ['Thank you. I will haunt the maintainers with it.', 'Received. Your words go to the other side (GitHub): press Submit there.'],
}
// Up for grim.seconds (8 s by default, or until the next event), a frame
// every 400 ms while it is up.
const GRIM_TICK_MS = 400
const GRIM_WAVE_MS = 2400

// The Workflows card's page: a community index of Claude workflows.
const WORKFLOWS_URL = 'https://www.claudeworkflows.org/'

// Built-in dex entries, numbered first (cards.builtins). Swarm is a template
// (templates/swarm.md); names and art for agent files come from dex.json.
const BUILTINS: Omit<DexEntry, 'no'>[] = [
  { id: 'scout', name: 'Scout', type: 'Explore', what: 'search the code', cat: 'code', source: 'builtin' },
  { id: 'builder', name: 'Builder', short: 'Build', type: 'general-purpose', what: 'do a multi-step task', cat: 'code', source: 'builtin' },
  { id: 'planner', name: 'Planner', short: 'Plan', type: 'Plan', what: 'design a plan', cat: 'code', source: 'builtin' },
  { id: 'fetcher', name: 'Fetcher', short: 'Fetch', type: 'web-fetch', what: 'read a URL', cat: 'web', source: 'builtin' },
  { id: 'guide', name: 'Guide', type: 'claude-code-guide', what: 'Claude Code and API answers', cat: 'research', source: 'builtin' },
  // A link card: Enter opens the page in the browser. Grimling only links to
  // it: it never fetches, copies or caches the library's content.
  {
    id: 'workflows',
    name: 'Workflows',
    short: 'Lore',
    what: 'community Claude Workflow Library',
    cat: 'research',
    link: { url: WORKFLOWS_URL, title: 'the Claude Workflow Library' },
    note: 'Run by the r/ClaudeAI moderators. Unofficial, not affiliated: Grimling only links to it.',
    source: 'builtin',
  },
]

// A creature for any agent without drawn art: a seeded, mirrored 8x8 sprite.
function creature(seed: string): string[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
  const bodies = ['t', 'o', 'p', 'b', 'g', 'c', 'r', 'y']
  const body = bodies[Math.floor(rand() * bodies.length)] ?? 't'
  const accent = rand() < 0.5 ? 'w' : 'k'
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    const half: string[] = []
    for (let c = 0; c < 4; c++) {
      const edge = r === 0 || r === 7 ? 0.35 : 0.7
      half.push(rand() < edge - c * 0.08 ? (rand() < 0.15 ? accent : body) : '.')
    }
    rows.push([...half, ...[...half].reverse()].join(''))
  }
  // Eyes, so every creature looks back.
  rows[2] = `${body}${body}w${body}${body}w${body}${body}`
  rows[3] = `.${body}k${body}${body}k${body}.`
  return rows
}

function guessCat(text: string): string {
  const t = text.toLowerCase()
  if (/network|security|vpn|deploy|infra|ops|server/.test(t)) return 'ops'
  if (/research|paper|literature|study|survey|report/.test(t)) return 'research'
  if (/web|url|fetch|browser|site/.test(t)) return 'web'
  if (/code|test|refactor|review|bug|build|typescript|python/.test(t)) return 'code'
  return 'custom'
}

// The KEYS tab: every command in one place, grouped.
const KEY_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'get in and out',
    rows: [
      ['/grimling', 'open Grimling with the keyboard'],
      ['ctrl+x Tab', 'from the prompt into the pane (or click)'],
      ['Esc', 'back to the prompt'],
      ['/grimling-tour', 'step-by-step walkthrough'],
    ],
  },
  {
    title: 'move and press',
    rows: [
      ['Tab ↓ →', 'next item'],
      ['Shift+Tab ↑ ←', 'previous item'],
      ['Enter', 'press the item under the ring'],
      ['d f t k', 'Deck, Flow, Table, Keys'],
      ['a  m  h', 'Arena, copy mermaid, tour'],
    ],
  },
  {
    title: 'deck',
    rows: [
      ['1-9', 'pick a card, jump to the launch box'],
      ['type + Enter', 'launch the picked agent'],
      ['find', 'filter cards by name'],
      ['chips', 'filter by category'],
      ['recent + Enter', 'reload a past task'],
    ],
  },
  {
    title: 'agents',
    rows: [
      ['Enter on running', 'type a message to it'],
      ['Enter on finished', 'read its answer'],
      ['Enter / c / x', 'answer: to prompt, copy, close'],
      ['x on running', 'stop it: Stop / Keep first (deck-launched)'],
    ],
  },
  {
    title: 'arena',
    rows: [
      ['‹ ›', 'pick Red, Blue and the task'],
      ['FIGHT', 'start the battle (arena.model, haiku by default)'],
      ['CLEAR', 'reset the result or a stuck battle'],
      ['s / SHARE', 'copy the result as a text card'],
    ],
  },
  {
    title: 'feedback',
    rows: [
      ['/grimling-feedback', 'report a bug or share an idea'],
      ['f on Grim', 'report the agent that just failed'],
      ['Send / e / x', 'preview: open GitHub, edit, cancel'],
    ],
  },
  {
    title: 'setup',
    rows: [
      ['/grimling-setup', 'check: settings problems, files read'],
      ['/grimling-setup show', 'every setting, changed ones marked'],
      ['/grimling-setup ask', 'pick common settings, preview, Write'],
    ],
  },
  {
    title: 'files',
    rows: [
      ['runs/', 'every agent run, a file a day'],
      ['arena.json', 'wins, losses, ratings'],
      ['debug.log', 'presses and errors'],
      ['settings.json', 'your settings (COMMANDS.md)'],
    ],
  },
]

let lastStatus = ''
let home = ''
let cwd = ''
let logQueue: Promise<void> = Promise.resolve()
let debugQueue: Promise<void> = Promise.resolve()
// Shown in the footer so the owner can see which build is loaded.
const BUILD = 'v0.4.3'
const DEBUG_LINES = 400
const timers: Timer[] = []
let grimTimer: Timer | undefined
let grimTurn = 0
// Whether this load already told the person to restart (identity mismatch).
let identityWarned = false
// Refused state writes this load (B7). Each poll keeps its own back-off and
// compares this count before and after a run, so a poll that writes nothing
// cannot end the back-off of one whose writes are refused.
let refusals = 0
// Each agent's whole brief, by id, as this load saw it spawn (or the run log
// kept it): the clash check and the recent list read it. The ids already
// written as spawn rows, so a deck launch the hook also sees is logged once.
const briefs = new Map<string, string>()
const spawnLogged = new Set<string>()
// The task the launch box last warned about: Enter on it again launches anyway.
let clashWarned = ''

// Once per load: the mod runs under another name than its own, or a state
// write was refused for that reason. A toast, a transcript line and a debug
// line, all saying to start a new session.
function warnIdentity($: EngineInterface, err?: unknown) {
  if (identityWarned) return
  identityWarned = true
  const text = deniedMessage($.plugin.name)
  debug($, 'identity.error', { running: $.plugin.name, error: err === undefined ? '' : errMessage(err) })
  try {
    $.ui.toast(text, { timeoutMs: 15000 })
    $.ui.log(text)
  } catch {
    // a host with no transcript
  }
}

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

// A catch handler for background work: one debug line, and the restart notice
// when the host refused a state write this load does not own.
function onFail($: EngineInterface, what: string) {
  return (err: unknown) => {
    // A refused write repeats on every poll until a restart: the notice says
    // it once (with its own debug line), no line per failure, and the polls
    // back off.
    if (isOwnerDenied(err)) {
      refusals++
      warnIdentity($, err)
      return
    }
    debug($, what, errMessage(err))
  }
}

async function homeDir($: EngineInterface): Promise<string> {
  if (!home) home = String((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replaceAll('\\', '/')
  return home
}

// /grimling: the deck, with the keyboard.
async function openDeck($: EngineInterface) {
  await update($, tab, () => 'deck' as Tab)
  await $.ui.open({ ...OPEN, focus: true })

  return {
    text: 'Grimling focused. Tab moves (tabs, launch box, filters, cards); Enter on a card, type, Enter. Esc back to the prompt.',
  }
}

async function openTour($: EngineInterface) {
  await $.ui.open(OPEN)
  await startTour($)

  return { text: 'Tour started: one key every few seconds. Esc ends it and returns to the prompt.' }
}

// What the last dex load found wrong (dex.json, packs, templates), shown in
// the pane with the settings problems.
let dexProblems: SettingProblem[] = []
let dexSig = ''

// A cards.packs entry, read: its folder and the namespace its agents run under.
type Pack = { root: string; ns: string; label: string }

// The cards.packs entries that can be read. `ns` defaults to the pack's
// .claude-plugin/plugin.json name; a folder with neither is skipped. Packs
// load only as plugins: the mod draws their cards, Claude Code runs them.
async function readPacks($: EngineInterface, set: Settings, h: string, problems: SettingProblem[]): Promise<Pack[]> {
  const out: Pack[] = []
  for (const p of set.cards.packs) {
    const root = filePath(p.path, h)
    const label = `cards.packs ${p.path}`
    const manifest = await readJson($, `${root}/.claude-plugin/plugin.json`)
    const named = manifest.state === 'ok' ? (manifest.raw as { name?: unknown } | null)?.name : undefined
    const ns = p.ns ?? (typeof named === 'string' && TEMPLATE_ID.test(named) ? named : undefined)
    if (!ns) {
      problems.push({ path: label, message: 'no "ns" and no name in .claude-plugin/plugin.json (skipped)' })
      continue
    }
    if (manifest.state !== 'ok') {
      problems.push({ path: label, message: 'no .claude-plugin/plugin.json: its cards start only once it is enabled as a plugin' })
    }
    out.push({ root, ns, label })
  }
  return out
}

// The cards for templates.enabled, in that order. Each id is read as
// `<id>.md` from the mod's templates/, each pack's, ~/.claude/grimling/templates/
// and the project's .claude/grimling/templates/; the last one found wins. A
// project's is tagged proj: like every template it only fills the prompt.
async function loadTemplates(
  $: EngineInterface,
  set: Settings,
  h: string,
  packs: Pack[],
  problems: SettingProblem[],
): Promise<Omit<DexEntry, 'no'>[]> {
  const root = $.plugin.root.replaceAll('\\', '/')
  const dirs: { dir: string; label: string; source: DexEntry['source'] }[] = [
    { dir: `${root}/templates`, label: 'templates', source: 'builtin' },
    ...packs.map(p => ({ dir: `${p.root}/templates`, label: `${p.ns} templates`, source: 'pack' as const })),
    { dir: `${h}/.claude/grimling/templates`, label: '~/.claude/grimling/templates', source: 'user' },
    ...(set.cards.project
      ? [{ dir: `${cwd.replaceAll('\\', '/')}/.claude/grimling/templates`, label: '.claude/grimling/templates', source: 'project' as const }]
      : []),
  ]
  const taken = new Set(BUILTINS.map(b => b.id))
  const out: Omit<DexEntry, 'no'>[] = []
  for (const id of set.templates.enabled) {
    if (taken.has(id)) continue
    if (!TEMPLATE_ID.test(id)) {
      problems.push({ path: 'templates.enabled', message: `"${id}" is not a template id (a-z, 0-9 and -)` })
      continue
    }
    taken.add(id)
    let card: Omit<DexEntry, 'no'> | undefined
    for (const { dir, label, source } of dirs) {
      let text: string
      try {
        text = String(await $.fs.read(`${dir}/${id}.md`))
      } catch {
        continue
      }
      const got = parseTemplate(text, id, `${label}/${id}.md`)
      problems.push(...got.problems)
      if (got.card) card = { ...got.card, source, ...(source === 'project' ? { tag: 'proj' as const } : {}) }
    }
    // The mod's own swarm, when its file cannot be read.
    const own: TemplateCard | undefined = id === 'swarm' ? parseTemplate(SWARM_TEMPLATE, id, 'swarm').card : undefined
    if (!card && own) card = { ...own, source: 'builtin' }
    if (card) out.push(card)
    else problems.push({ path: 'templates.enabled', message: `no template "${id}" (looked for ${id}.md in the templates folders)` })
  }
  return out
}

// Reads the dex. Card sources, an earlier type (and card id) winning:
// built-ins, the mod's pack (`grimling:<name>`), each cards.packs entry
// (`<ns>:<name>`), project agent files, then user ones; each source has its
// cards.* switch. Template cards follow the built-ins. Names, art and
// categories come from dex.json layers, the later winning: the mod's
// agents/dex.json, each pack's, then ~/.claude/grimling/dex.json; a key is
// `<name>` or `<ns>:<name>`. Card ids stay `agent-<name>` whatever the
// pack, so Arena records and recent runs survive a move between packs.
async function loadDex($: EngineInterface) {
  const h = await homeDir($)
  const set = await read($, settings)
  const pack = `${$.plugin.root.replaceAll('\\', '/')}/agents`
  // Problems for the pane, and for debug.log what went wrong and how many
  // files each source gave, so an empty Grimoire explains itself.
  const problems: SettingProblem[] = []
  const notes: string[] = []
  const counts: Record<string, number> = { pack: 0, packs: 0, project: 0, user: 0 }
  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160)
  const packs = await readPacks($, set, h, problems)
  const meta: Record<string, Meta> = {}
  const layers: [string, string][] = [
    [`${pack}/dex.json`, 'agents/dex.json'],
    ...packs.map((p): [string, string] => [`${p.root}/agents/dex.json`, `${p.ns} agents/dex.json`]),
    [`${h}/.claude/grimling/dex.json`, '~/.claude/grimling/dex.json'],
  ]
  for (const [path, label] of layers) {
    let raw: unknown
    try {
      raw = JSON.parse(String(await $.fs.read(path))) as unknown
    } catch (err) {
      // A missing file is normal; one that is not JSON is a problem.
      if (err instanceof SyntaxError) problems.push({ path: label, message: `not valid JSON: ${errText(err)} (ignored)` })
      continue
    }
    const got = readMeta(raw, label)
    problems.push(...got.problems)
    for (const [k, v] of Object.entries(got.meta)) meta[k] = { ...meta[k], ...v }
  }
  const templates = await loadTemplates($, set, h, packs, problems)
  const found: Omit<DexEntry, 'no'>[] = []
  const seenType = new Set(BUILTINS.map(b => b.type ?? b.id))
  const seenId = new Set([...BUILTINS, ...templates].map(b => b.id))
  const dirs: { dir: string; source: DexEntry['source']; ns?: string; count: string }[] = [
    ...(set.cards.pack ? [{ dir: pack, source: 'pack' as const, ns: 'grimling', count: 'pack' }] : []),
    ...packs.map(p => ({ dir: `${p.root}/agents`, source: 'pack' as const, ns: p.ns, count: 'packs' })),
    ...(set.cards.project ? [{ dir: `${cwd.replaceAll('\\', '/')}/.claude/agents`, source: 'project' as const, count: 'project' }] : []),
    ...(set.cards.user ? [{ dir: `${h}/.claude/agents`, source: 'user' as const, count: 'user' }] : []),
  ]
  for (const { dir, source, ns, count } of dirs) {
    let files: { name: string; kind: string }[] = []
    try {
      files = await $.fs.list(dir)
    } catch (err) {
      files = []
      notes.push(`list ${count} ${dir}: ${errText(err)}`)
    }
    for (const f of files.filter(f => f.kind === 'file' && f.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))) {
      let fm: Record<string, string> = {}
      try {
        fm = splitDoc(String(await $.fs.read(`${dir}/${f.name}`))).fm
      } catch (err) {
        notes.push(`read ${count} ${f.name}: ${errText(err)}`)
        continue
      }
      const base = fm.name || f.name.replace(/\.md$/, '')
      // A plugin's agent files are dispatched as `<plugin>:<name>`.
      const type = ns ? `${ns}:${base}` : base
      const id = `agent-${base}`
      if (seenType.has(type) || seenId.has(id)) continue
      seenType.add(type)
      seenId.add(id)
      counts[count] = (counts[count] ?? 0) + 1
      const m = { ...meta[base], ...meta[type] }
      const desc = fm.description ?? ''
      found.push({
        id,
        name: m.name ?? titleCase(base),
        short: m.short,
        type,
        what: m.what ?? (desc.split(/[.;]/)[0] ?? desc).slice(0, 60),
        cat: m.cat ?? guessCat(`${type} ${desc}`),
        art: m.art,
        source,
      })
    }
  }
  const all = [...(set.cards.builtins ? BUILTINS : []), ...templates, ...found]
    .filter(d => !isHidden(d, set.cards.hide))
    // Names and purposes come from agent, dex and template files: no control
    // characters reach the pane.
    .map((d, i) => ({
      ...d,
      name: printable(d.name),
      what: printable(d.what),
      ...(d.short === undefined ? {} : { short: printable(d.short) }),
      ...(d.note === undefined ? {} : { note: printable(d.note) }),
      no: i + 1,
    }))
  // One debug line when what the load found changes, not every 30 s.
  const line = { root: pack, ...counts, total: all.length, problems: [...notes, ...problems.map(problemLine)].slice(0, 6) }
  if (JSON.stringify(line) !== dexSig) {
    dexSig = JSON.stringify(line)
    debug($, 'dex', line)
  }
  if (JSON.stringify(all) !== JSON.stringify(await read($, roster))) await update($, roster, () => all)
  dexProblems = problems
  await publishProblems($)
}

// Appends one row to today's run file, shaped by log.runs (full, redacted,
// meta, off). A part that reached log.maxBytes, or that is there but cannot
// be read, is left as it is and the next part is written: a read refused for
// size can never wipe the log (the old runs.jsonl lost every row that way).
// The old ~/.claude/grimling/runs.jsonl is read for recent runs, never written.
// One spawn row an agent. The deck's own $.agent.spawn skips this plugin's
// agent.spawn hook (the engine runs every hook but the caller's), so launch()
// logs its spawns here too; the id set keeps it to one row either way.
async function logSpawn(
  $: EngineInterface,
  s: { agentId: string; type?: string; model?: string; description?: string; prompt: string },
) {
  briefs.set(s.agentId, s.prompt)
  if (spawnLogged.has(s.agentId)) return
  spawnLogged.add(s.agentId)
  logRun($, { kind: 'spawn', at: new Date(await $.clock.now()).toISOString(), ...s, cwd })
}

function logRun($: EngineInterface, row: Record<string, unknown>) {
  logQueue = logQueue.then(async () => {
    const h = await homeDir($)
    if (!h) return
    const log = (await read($, settings)).log
    const shaped = shapeRow(row, log, h)
    if (!shaped) return
    const line = `${JSON.stringify(shaped)}\n`
    const dir = `${h}/.claude/grimling/runs`
    const day = dayOf(await $.clock.now())
    let names: string[] = []
    try {
      names = (await $.fs.list(dir)).filter(f => f.kind === 'file').map(f => f.name)
    } catch {
      // No folder yet: the write makes it.
    }
    const parts = names.map(parsePart).filter(p => p?.day === day).map(p => p?.part ?? 1)
    for (let part = Math.max(1, ...parts); part <= RUN_LOG_PARTS; part++) {
      const path = `${dir}/${partName(day, part)}`
      let before = ''
      try {
        before = String(await $.fs.read(path))
      } catch {
        // Missing is fine; there but unreadable: never write over it.
        if (await $.fs.exists(path).catch(() => true)) continue
      }
      if (before && utf8Bytes(before) + utf8Bytes(line) > log.maxBytes) continue
      await $.fs.write(path, `${before}${line}`)
      break
    }
    await loadRecent($)
  }).catch(onFail($, 'log.error'))
}

// Each fighter's task description carries a tag naming its battle and side.
function arenaTag(b: Pick<ArenaBattle, 'startedAt'>, side: 'red' | 'blue'): string {
  return `#${b.startedAt.toString(36)} ${side}`
}

// Arena records live in ~/.claude/grimling/arena.json across sessions.
async function loadRecords($: EngineInterface) {
  const h = await homeDir($)
  if (!h) return
  try {
    const saved = JSON.parse(String(await $.fs.read(`${h}/.claude/grimling/arena.json`))) as Record<string, ArenaRecord>
    await update($, records, () => saved)
  } catch {
    // No record yet.
  }
}

// A JSON file's state: missing, parsed, or there but not usable.
type JsonFile = { state: 'missing' } | { state: 'ok'; raw: unknown } | { state: 'bad'; message: string }
async function readJson($: EngineInterface, path: string): Promise<JsonFile> {
  let text: string
  try {
    text = String(await $.fs.read(path))
  } catch (err) {
    // Missing is normal; a file that is there but cannot be read is a problem.
    const there = await $.fs.exists(path).catch(() => false)
    return there ? { state: 'bad', message: `cannot be read: ${errMessage(err).slice(0, 120)}` } : { state: 'missing' }
  }
  try {
    return { state: 'ok', raw: JSON.parse(text) as unknown }
  } catch (err) {
    return { state: 'bad', message: `not valid JSON: ${errMessage(err).slice(0, 120)}` }
  }
}

// When each settings file last changed, as stat answers (-1: no answer).
async function mtimeOf($: EngineInterface, path: string): Promise<number> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return -1
  }
}

// The last load's file times, and the user file's last good settings (an
// unparseable edit keeps them).
let settingsSig = ''
let lastGood: Settings | undefined
let problemsSig = ''
// The puzzles file the last load read (its time is part of the signature).
let puzzlesAt = ''

// A settings path (a cards.packs folder, the puzzles file): `~` under home; a
// relative path is read from `base`, the project folder unless given.
function filePath(file: string, h: string, base = cwd): string {
  const p = expandHome(file, h)
  return /^([A-Za-z]:)?\//.test(p) ? p : `${base.replaceAll('\\', '/')}/${p}`
}

// ~/.claude/grimling/settings.json and the project's .claude/grimling.json,
// checked with the dex every 30 s and parsed again only when a file changed
// (the puzzles file too). Bad fields keep their defaults; problems go to the
// pane, one debug line and one toast per change.
async function loadSettings($: EngineInterface) {
  const h = await homeDir($)
  if (!h) return
  const userPath = `${h}/.claude/grimling/settings.json`
  const projPath = `${cwd.replaceAll('\\', '/')}/.claude/grimling.json`
  const times = [await mtimeOf($, userPath), await mtimeOf($, projPath)]
  if (puzzlesAt) times.push(await mtimeOf($, puzzlesAt))
  const sig = times.join('|')
  // Skipped only when every file answered a time and none changed.
  if (sig === settingsSig && times.every(t => t > 0)) return
  settingsSig = sig

  const user = await readJson($, userPath)
  const proj = cwd ? await readJson($, projPath) : ({ state: 'missing' } as JsonFile)
  const problems: SettingsReport['problems'] = []
  let base: Settings
  if (user.state === 'bad') {
    base = lastGood ?? (await read($, settings))
    problems.push({ path: 'settings.json', message: `${user.message} (kept the last good settings)` })
  } else {
    const parsed = parseSettings(user.state === 'ok' ? user.raw : undefined)
    base = parsed.value
    lastGood = parsed.value
    problems.push(...parsed.problems)
  }
  let next = base
  if (proj.state === 'bad') problems.push({ path: '.claude/grimling.json', message: `${proj.message} (ignored)` })
  else if (proj.state === 'ok') {
    const merged = mergeProject(base, proj.raw)
    next = merged.value
    problems.push(...merged.problems)
  }
  const files = [
    ...(user.state === 'missing' ? [] : ['~/.claude/grimling/settings.json']),
    ...(proj.state === 'missing' ? [] : [projPath]),
  ]
  // The Arena's puzzles: built-ins, plus the file's (bad entries skipped).
  let quiz = CHALLENGES
  // Only the user's settings name it, so a relative path is read from
  // ~/.claude/grimling, never from the project.
  puzzlesAt = next.arena.puzzlesFile ? filePath(next.arena.puzzlesFile, h, `${h}/.claude/grimling`) : ''
  if (puzzlesAt) {
    const pf = await readJson($, puzzlesAt)
    if (pf.state === 'ok') {
      const got = parsePuzzles(pf.raw)
      quiz = withPuzzles(got.puzzles)
      problems.push(...got.problems.map(message => ({ path: 'arena.puzzlesFile', message })))
      files.push(puzzlesAt)
    } else {
      problems.push({
        path: 'arena.puzzlesFile',
        message: pf.state === 'bad' ? `${pf.message} (built-in puzzles only)` : `no file at ${puzzlesAt} (built-in puzzles only)`,
      })
    }
  }
  if (JSON.stringify(quiz) !== JSON.stringify(await read($, puzzles))) await update($, puzzles, () => quiz)
  if (JSON.stringify(next) !== JSON.stringify(await read($, settings))) await update($, settings, () => next)
  settingsReport = { problems, files }
  await publishProblems($)
  if (!next.grim.enabled && (await read($, grim))) await grimHide($)
}

// The settings load's problems and files, kept for publishProblems.
let settingsReport: SettingsReport = { problems: [], files: [] }

// The settings problems and the dex's, to the pane; one debug line and one
// toast each time they change.
async function publishProblems($: EngineInterface) {
  const problems = [...settingsReport.problems, ...dexProblems]
  const report: SettingsReport = { problems: problems.slice(0, 30), files: settingsReport.files }
  if (JSON.stringify(report) !== JSON.stringify(await read($, settingsProblems))) {
    await update($, settingsProblems, () => report)
  }
  const pSig = JSON.stringify(problems)
  if (pSig !== problemsSig) {
    problemsSig = pSig
    if (problems.length) {
      debug($, 'settings.error', problems.slice(0, 6).map(problemLine))
      $.ui.toast(`Grimling settings: ${problems.length} problem${problems.length === 1 ? '' : 's'}, see the Keys tab (k)`)
    }
  }
}

// The pod status files pods.files names: plain paths as written, and a `*`
// in the file name matched against its folder's listing.
async function podFiles($: EngineInterface, patterns: string[], h: string): Promise<string[]> {
  const out: string[] = []
  for (const pattern of patterns) {
    const full = expandHome(pattern, h)
    const cut = full.lastIndexOf('/')
    const name = full.slice(cut + 1)
    if (!name.includes('*')) {
      out.push(full)
      continue
    }
    const dir = full.slice(0, cut)
    const re = new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`)
    try {
      const found = (await $.fs.list(dir)).filter(f => f.kind === 'file' && re.test(f.name))
      out.push(...found.sort((a, b) => b.mtimeMs - a.mtimeMs).map(f => `${dir}/${f.name}`))
    } catch {
      // No such folder: no pods.
    }
  }
  return out
}

// The pane's width when last drawn, for the feedback diagnostics.
let paneWidth: number | null = null

async function osFamily($: EngineInterface): Promise<string> {
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') return 'windows'
  return (await homeDir($)).startsWith('/Users/') ? 'macos' : 'linux'
}

// What a report carries besides the message: versions, OS, pane width, card
// counts, settings problem keys. No path, prompt, answer or run log.
async function gatherDiagnostics($: EngineInterface): Promise<string> {
  const claudeCode = await $.session
    .version()
    .then(v => v.version)
    .catch(() => 'unknown')
  const dex = await read($, roster)
  const cards: Record<string, number> = {}
  for (const d of dex.length ? dex : BUILTINS) cards[d.source] = (cards[d.source] ?? 0) + 1
  const report = await read($, settingsProblems)
  return diagnosticsText(
    { grimling: BUILD, claudeCode, os: await osFamily($), paneWidth, cards, settingsProblems: report.problems.map(p => p.path) },
    await homeDir($),
  )
}

// Opens the feedback preview in the pane: the kind (asked unless the text
// starts with bug:, idea: or praise:), the message, the diagnostics.
async function startFeedback(
  $: EngineInterface,
  args: string,
  from: FeedbackDraft['from'],
  prefill?: string,
): Promise<{ draft: FeedbackDraft; isPlaced: boolean }> {
  const parsed = kindFromArgs(args)
  let kind = parsed.kind
  let message = prefill ?? parsed.message
  if (!kind && from === 'command') {
    try {
      const pick = await $.ui.ask('What kind of feedback is it?', { options: KINDS.map(k => k.label), header: 'Feedback' })
      const known = KINDS.find(k => k.label === pick)
      kind = known?.kind ?? 'bug'
      // Text typed under "Other" is the message.
      if (!known && !message) message = pick
    } catch {
      // Dismissed, or no one to ask: the preview has the kind chips.
      kind = 'bug'
    }
  }
  const draft: FeedbackDraft = { kind: kind ?? 'bug', message, diagnostics: await gatherDiagnostics($), from }
  await update($, feedback, () => draft)
  await update($, tab, () => 'feedback' as Tab)
  const placed = await $.ui.open({ ...OPEN, focus: true }).catch(() => ({ isPlaced: false }))
  await focusOn($, FEEDBACK_INPUT)
  debug($, 'feedback.open', { from, kind: draft.kind })
  return { draft, isPlaced: placed.isPlaced }
}

async function outgoing($: EngineInterface, d: FeedbackDraft): Promise<Outgoing> {
  const set = await read($, settings)
  return buildFeedback({ kind: d.kind, message: d.message, diagnostics: d.diagnostics, repo: set.feedback.repo, home: await homeDir($) })
}

// The default browser, by the OS's own opener (no shell); false when it
// could not be started.
async function openUrl($: EngineInterface, url: string): Promise<boolean> {
  try {
    const r = await $.process.run(openerFor(await osFamily($), url), { timeoutMs: 10000 })
    return r.exitCode === 0
  } catch {
    return false
  }
}

type CopySurface = Parameters<EngineInterface['ui']['copy']>[0]['surface']

// A link card (Workflows): opens its page in the browser, or with no browser
// copies the link. It launches nothing and leaves the prompt alone.
async function openLink($: EngineInterface, link: { url: string; title: string }, surface: CopySurface) {
  const opened = await openUrl($, link.url)
  if (!opened) await $.ui.copy({ text: link.url, surface }).catch(() => undefined)
  $.ui.toast(
    opened
      ? `Opened ${link.title} in your browser`
      : `Could not open the browser: the link to ${link.title} is copied. Paste it into your browser.`,
  )
  debug($, 'link.open', { url: link.url, opened })
}

// Send: opens the pre-filled form (or, when too long for a link, copies the
// text and opens the empty form); with no browser the link is copied. Grim
// thanks the person.
async function sendFeedback($: EngineInterface, surface: CopySurface) {
  const d = await read($, feedback)
  if (!d) return
  if (!d.message.trim()) {
    $.ui.toast('Write a message first: e edits it')
    await focusOn($, FEEDBACK_INPUT)
    return
  }
  const out = await outgoing($, d)
  if (out.isTooLong) await $.ui.copy({ text: out.copy, surface }).catch(() => undefined)
  const opened = await openUrl($, out.url)
  if (!opened) {
    await $.ui.copy({ text: out.isTooLong ? `${out.url}\n\n${out.copy}` : out.url, surface }).catch(() => undefined)
  }
  $.ui.toast(
    !opened
      ? 'Could not open the browser: the link is copied. Paste it into your browser, then press Submit.'
      : out.isTooLong
        ? 'GitHub opened; your text is copied (too long for a link): paste it in, then press Submit.'
        : 'GitHub opened with your feedback: press Submit there.',
  )
  debug($, 'feedback.sent', { kind: d.kind, opened, isTooLong: out.isTooLong })
  await update($, feedback, () => null)
  await update($, tab, () => 'deck' as Tab)
  await grimPop($, 'thanks', {})
}

async function cancelFeedback($: EngineInterface) {
  await update($, feedback, () => null)
  await update($, tab, () => 'deck' as Tab)
  $.ui.toast('Feedback cancelled: nothing was sent')
}

// /grimling-setup: settings.json's text (null: no file). A file that is there
// but cannot be read is `unreadable`, never treated as missing.
async function userSettingsText($: EngineInterface): Promise<{ path: string; text: string | null; unreadable?: string }> {
  const path = `${await homeDir($)}/.claude/grimling/settings.json`
  try {
    return { path, text: String(await $.fs.read(path)) }
  } catch (err) {
    const there = await $.fs.exists(path).catch(() => false)
    return there ? { path, text: null, unreadable: `cannot be read: ${errMessage(err).slice(0, 120)}` } : { path, text: null }
  }
}

async function userFileOf($: EngineInterface): Promise<{ path: string; text: string | null; file: UserFile }> {
  const f = await userSettingsText($)
  return { ...f, file: f.unreadable ? { state: 'bad', message: f.unreadable } : readUserFile(f.text) }
}

// `check`: a fresh load, then its problems and the files it read.
async function setupCheck($: EngineInterface): Promise<string> {
  settingsSig = ''
  await loadSettings($)
  const report = await read($, settingsProblems)
  return checkText({ file: (await userFileOf($)).file, problems: report.problems, files: report.files })
}

// `show`: the effective settings after a fresh load, changed ones marked.
async function setupShow($: EngineInterface): Promise<string> {
  settingsSig = ''
  await loadSettings($)
  const { file } = await userFileOf($)
  const proj = cwd ? await readJson($, `${cwd.replaceAll('\\', '/')}/.claude/grimling.json`) : ({ state: 'missing' } as JsonFile)
  return showText(await read($, settings), file.state === 'ok' ? file.raw : undefined, proj.state === 'ok' ? proj.raw : undefined)
}

// `ask`: opens the setup view on the file as it is now; a bad file is
// refused before anything is asked.
async function startSetup($: EngineInterface): Promise<string> {
  const { text, file } = await userFileOf($)
  if (file.state === 'bad') return fixFirst(file.message)
  await update($, setup, () => ({ answers: {}, base: text }))
  await update($, tab, () => 'setup' as Tab)
  const placed = await $.ui.open({ ...OPEN, focus: true }).catch(() => ({ isPlaced: false }))
  if (!placed.isPlaced) {
    await update($, setup, () => null)
    await update($, tab, () => 'deck' as Tab)
    return (
      `The guided setup needs the Grimling pane (terminal or desktop app). Nothing was written. ` +
      `Edit ${USER_FILE} yourself (docs/SETTINGS.md); /grimling-setup check and show work here.`
    )
  }
  await focusOn($, 'setup-0-0')
  debug($, 'setup.open', { hasFile: text !== null })
  return (
    'Setup is open in Grimling: pick a value on each row; the preview shows the exact JSON. ' +
    `Enter on Write saves it to ${USER_FILE} (other keys kept); x cancels.`
  )
}

// Write: exactly the previewed text, and only while the file still holds
// what the preview was built on.
async function writeSetup($: EngineInterface) {
  const d = await read($, setup)
  if (!d) return
  const plan = planWrite(d.base, d.answers)
  if (!plan.ok) {
    $.ui.toast(plan.message)
    return
  }
  if (!plan.changes.length) {
    $.ui.toast('Nothing to change: pick a different value first')
    return
  }
  const now = await userFileOf($)
  if (now.file.state === 'bad') {
    $.ui.toast(fixFirst(now.file.message))
    return
  }
  if (now.text !== d.base) {
    // Edited meanwhile: rebuild the preview on the new text, write nothing.
    await update($, setup, cur => (cur ? { ...cur, base: now.text } : cur))
    $.ui.toast('settings.json changed since the preview: nothing written. Check the new preview, then Write again.')
    return
  }
  await $.fs.write(now.path, plan.text)
  debug($, 'setup.write', plan.changes.map(c => c.key))
  settingsSig = ''
  await loadSettings($).catch(onFail($, 'settings.error'))
  await update($, setup, () => null)
  await update($, tab, () => 'deck' as Tab)
  $.ui.toast(`Saved ${plan.changes.length} setting${plan.changes.length === 1 ? '' : 's'} to ${USER_FILE}`)
}

async function cancelSetup($: EngineInterface) {
  await update($, setup, () => null)
  await update($, tab, () => 'deck' as Tab)
  $.ui.toast('Setup cancelled: nothing was written')
}

// Counts session starts in the mod's store; from the NUDGE_AFTER-th on, the
// feedback hint shows in one session, unless turned off or dismissed.
async function countLaunch($: EngineInterface) {
  const n = Number((await $.store.get('launches')) ?? 0) + 1
  await $.store.set('launches', n)
  if (n < NUDGE_AFTER || !(await read($, settings)).feedback.nudge) return
  if ((await $.store.get('nudgeDismissed')) || (await $.store.get('nudgeShown'))) return
  await $.store.set('nudgeShown', true)
  await update($, nudge, () => true)
}

function grimStop() {
  try {
    grimTimer?.cancel()
  } catch {
    // a timer the engine already dropped
  }
  grimTimer = undefined
}

async function grimHide($: EngineInterface) {
  grimStop()
  await update($, grim, () => null)
}

// An agent that ended, as notify.* in settings.json says: a toast and/or a
// desktop notification (through the user's own channel), only for the
// events in notify.events. Grim has its own switch (grim.enabled).
async function announce($: EngineInterface, event: GrimEvent, text: string) {
  const { notify } = await read($, settings)
  if (!notify.events.includes(event)) return
  if (notify.toast) void $.ui.toast(text)
  if (notify.desktop) {
    const sent = await $.ui.notify(text, { title: 'Grimling' }).catch((err: unknown) => ({ isSent: false, reason: String(err) }))
    if (!sent.isSent) debug($, 'notify.error', 'reason' in sent ? sent.reason : 'not sent')
  }
}

// Grim pops up with a line for an agent that ended (the newest event wins),
// waving first; a 400 ms timer steps its frames and takes it down after 8 s.
async function grimPop($: EngineInterface, event: GrimSay['event'], vars: Record<string, string>, report?: string) {
  const set = await read($, settings)
  if (!set.grim.enabled) return
  const own = event === 'thanks' ? [] : set.grim.lines[event]
  const pool = own.length ? own : GRIM_LINES[event]
  const line = pool[grimTurn++ % pool.length] ?? ''
  const text = line.replace(/\{(\w+)\}/g, (m: string, k: string) => vars[k] ?? m)
  const now = await $.clock.now()
  await update($, grim, () => ({ text, at: now, until: now + set.grim.seconds * 1000, event, ...(report ? { report } : {}) }))
  await update($, grimFrame, () => 'wave' as GrimFrame)
  grimStop()
  grimTimer = $.clock.every(GRIM_TICK_MS, () => void grimTick($).catch(() => undefined))
}

// Wave and idle in turn on arrival, then idle and flick, with a blink every
// few steps; past its time Grim goes.
async function grimTick($: EngineInterface) {
  const f = await read($, grim)
  const now = await $.clock.now()
  if (!f || now >= f.until) {
    await grimHide($)
    return
  }
  const step = Math.floor((now - f.at) / GRIM_TICK_MS)
  const frame: GrimFrame =
    now - f.at < GRIM_WAVE_MS ? (step % 2 ? 'idle' : 'wave') : step % 7 === 0 ? 'blink' : step % 2 ? 'flick' : 'idle'
  if (frame !== (await read($, grimFrame))) await update($, grimFrame, () => frame)
}

// A fighter's answer: scored against the key; once both are in, the winner
// is decided and both cards are rated (not a card against itself).
async function arenaAnswer($: EngineInterface, agentId: string, answer: string, durationMs: number, tokens: number) {
  const b = await read($, battle)
  if (!b || b.winner) return
  // The spawn answer's id when it gave one, else the tag in the description.
  let key: 'red' | 'blue' | null = b.red.agentId === agentId ? 'red' : b.blue.agentId === agentId ? 'blue' : null
  if (!key) {
    const desc = (await $.agent.list()).find(a => a.id === agentId)?.description ?? ''
    key = desc.includes(arenaTag(b, 'red')) ? 'red' : desc.includes(arenaTag(b, 'blue')) ? 'blue' : null
  }
  const c = (await read($, puzzles)).find(x => x.id === b.challenge)
  if (!key || !c || b[key].answer !== undefined) return
  const side: ArenaSide = { ...b[key], answer: answer.slice(0, 2000), correct: isCorrect(c, answer), durationMs, tokens }
  const next: ArenaBattle = key === 'red' ? { ...b, red: side } : { ...b, blue: side }
  if (next.red.answer !== undefined && next.blue.answer !== undefined) {
    next.winner = decide(next)
    debug($, 'arena.result', { winner: next.winner, red: next.red.correct, blue: next.blue.correct })
    // One row a scored fight in the run log (answers cut to their last line).
    const fought = (s: ArenaSide) => ({
      card: s.card,
      agentId: s.agentId,
      answer: extractAnswer(s.answer ?? '').slice(0, 200),
      correct: s.correct,
      durationMs: s.durationMs,
      tokens: s.tokens,
    })
    logRun($, {
      kind: 'arena',
      at: new Date(await $.clock.now()).toISOString(),
      challenge: c.id,
      model: b.model ?? (await read($, settings)).arena.model,
      red: fought(next.red),
      blue: fought(next.blue),
      winner: next.winner,
      reason: why(next),
    })
    if (next.red.card !== next.blue.card) {
      const rated = rate(await read($, records), next.red.card, next.blue.card, next.winner)
      await update($, records, () => rated)
      const h = await homeDir($)
      if (h) await $.fs.write(`${h}/.claude/grimling/arena.json`, JSON.stringify(rated, null, 2)).catch(() => undefined)
    }
    void $.ui.toast(next.winner === 'draw' ? 'Arena: a draw' : `Arena: ${next.winner} wins`)
  }
  await update($, battle, () => next)
}

// One line to ~/.claude/grimling/debug.log (newest DEBUG_LINES kept): key
// presses, focus moves, view changes, fights and errors, for troubleshooting.
function debug($: EngineInterface, what: string, detail: unknown = '') {
  debugQueue = debugQueue
    .then(async () => {
      const h = await homeDir($)
      if (!h) return
      const log = (await read($, settings)).log
      if (!debugWanted(what, log.debug)) return
      const path = `${h}/.claude/grimling/debug.log`
      let lines: string[] = []
      try {
        lines = String(await $.fs.read(path)).split('\n').filter(Boolean)
      } catch {
        // There but unreadable: leave it be rather than write over it.
        if (await $.fs.exists(path).catch(() => true)) return
        lines = []
      }
      const at = new Date(await $.clock.now()).toISOString()
      // Paths and error text can name the home folder or carry a key.
      const text = redact(typeof detail === 'string' ? detail : JSON.stringify(detail), log.redact, h)
      lines.push(`${at} ${BUILD} ${what} ${text}`.slice(0, 2000))
      await $.fs.write(path, `${lines.slice(-DEBUG_LINES).join('\n')}\n`)
    })
    .catch(() => undefined)
}

// The newest spawns in the run log, one per task, for the recent list.
async function keepRecent($: EngineInterface, lines: string[]) {
  const runs: RecentRun[] = []
  const seen = new Set<string>()
  for (const line of [...lines].reverse()) {
    if (runs.length >= RECENT_SHOWN) break
    let row: Partial<RecentRun> & { kind?: string }
    try {
      row = JSON.parse(line) as Partial<RecentRun> & { kind?: string }
    } catch {
      continue
    }
    if (row.kind !== 'spawn' || !row.prompt) continue
    if (row.agentId && !briefs.has(String(row.agentId))) briefs.set(String(row.agentId), row.prompt)
    if (seen.has(row.prompt)) continue
    seen.add(row.prompt)
    runs.push({
      agentId: String(row.agentId ?? ''),
      type: String(row.type ?? ''),
      description: printable(String(row.description ?? '')),
      // Whole, as the run log kept it (log.promptChars): a cut here sent a
      // half brief. No control characters: it is drawn.
      prompt: printable(row.prompt),
      at: String(row.at ?? ''),
    })
  }
  const before = await read($, recent)
  if (JSON.stringify(before) !== JSON.stringify(runs)) await update($, recent, () => runs)
}

// The newest run rows for the recent list: the day files within keepDays,
// newest first, until enough spawns are found, then the old runs.jsonl.
async function loadRecent($: EngineInterface) {
  const h = await homeDir($)
  if (!h) return
  const log = (await read($, settings)).log
  const dir = `${h}/.claude/grimling/runs`
  let names: string[] = []
  try {
    names = (await $.fs.list(dir)).filter(f => f.kind === 'file').map(f => f.name)
  } catch {
    // No day files yet.
  }
  // Oldest first, as keepRecent reads them.
  let lines: string[] = []
  let spawns = 0
  const take = (text: string) => {
    const more = text.split('\n').filter(Boolean)
    spawns += more.filter(l => l.includes('"kind":"spawn"')).length
    lines = [...more, ...lines]
  }
  for (const name of keptFiles(names, await $.clock.now(), log.keepDays)) {
    if (spawns >= RECENT_SHOWN * 4) break
    try {
      take(String(await $.fs.read(`${dir}/${name}`)))
    } catch {
      // A file that cannot be read is skipped.
    }
  }
  if (spawns < RECENT_SHOWN * 4) {
    try {
      take(String(await $.fs.read(`${h}/.claude/grimling/runs.jsonl`)))
    } catch {
      // No old log, or over the read limit.
    }
  }
  await keepRecent($, lines)
}

// The tour: a second pane that lists every command and walks through them,
// switching the deck's view to match. Esc closes it and resets the view.
const TOUR_PANE = 'grimling-tour'
const TOUR_MS = 3500
const tour = atom({ plugin: 'grimling', key: 'tour' } as const, null as number | null)
type Step = { keys: string; what: string; view?: Tab }
const STEPS: Step[] = [
  { keys: '/grimling', what: 'open Grimling and give it the keyboard', view: 'deck' },
  { keys: 'Tab / arrows', what: 'move: tabs, launch box, filters, cards, live agents', view: 'deck' },
  { keys: 'Enter on a tab', what: 'switch view: Deck, Flow, Table, Keys; mermaid copies', view: 'deck' },
  { keys: 'move onto a card', what: 'its dex entry shows (the launch target stays)', view: 'deck' },
  { keys: 'Enter on a card', what: 'make it the launch target; type the task, Enter starts it', view: 'deck' },
  { keys: '1-9', what: 'target one of the first nine shown cards and jump to the launch box', view: 'deck' },
  { keys: 'chips / filter', what: 'All Code Research Web Ops Swarm Custom; type to filter by name', view: 'deck' },
  { keys: 'Enter on a live agent', what: 'running: type a message; finished: read its answer', view: 'deck' },
  { keys: 'x on a running card', what: 'stop an agent the deck launched (Stop / Keep first)', view: 'deck' },
  { keys: 'Swarm', what: 'fill the prompt with a swarm request; send it with Enter', view: 'deck' },
  { keys: 'Workflows', what: 'open the community Claude Workflow Library in your browser (a link only)', view: 'deck' },
  { keys: 'agent-dex skill', what: 'say "collect agent types": saves specialized runs as agents', view: 'deck' },
  { keys: 'Esc', what: 'hand the keyboard back to the prompt', view: 'deck' },
  { keys: 'ctrl+x Tab', what: 'take the keyboard from the prompt into the deck', view: 'deck' },
]
let tourTimer: Timer | undefined

async function showStep($: EngineInterface, index: number) {
  const step = STEPS[index % STEPS.length]
  if (!step) return
  await update($, tour, () => index % STEPS.length)
  if (step.view) await update($, tab, () => step.view as Tab)
}

async function startTour($: EngineInterface) {
  tourTimer?.cancel()
  await showStep($, 0)
  await $.ui.open({ id: TOUR_PANE, title: 'Tour', focus: true, closeOnEscape: true, rows: 16, columns: 78 })
  tourTimer = $.clock.every(TOUR_MS, () => {
    void (async () => showStep($, ((await read($, tour)) ?? -1) + 1))()
  })
}

// A refused focus move (the pane is not holding the keys) leaves the ring be.
async function focusOn($: EngineInterface, key: string) {
  await $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
}

async function arm($: EngineInterface, next: Armed | null) {
  await update($, armed, () => next)
  if (next?.kind === 'message') await focusOn($, INPUT)
  if (next?.kind === 'result') await focusOn($, 'ans-prompt')
  // Keep has the ring: a stray Enter keeps the agent running.
  if (next?.kind === 'stop') await focusOn($, 'confirm-keep')
}

// The stop button, after the person pressed Stop on the Stop / Keep confirm:
// TaskStop with the card's id, through the permission check, the press passed
// on as the person's consent. Only an agent the deck launched, and once. A
// denial or a tool error resolves (deny / isError) rather than throwing, so
// the result is read, never assumed. The toast, Grim line and run-log row come
// from here: the poll may never see `killed` (the engine can drop the entry).
async function stopAgent($: EngineInterface, agentId: string) {
  await arm($, null)
  if (!(await read($, settings)).stop.enabled) return
  const a = (await read($, agents)).find(x => x.id === agentId)
  if (!a || !(await read($, launched)).includes(agentId)) return
  if ((await read($, stops))[agentId]) return
  if (ENDED.has(a.status)) {
    void $.ui.toast(`Not stopped: ${a.description} already ${a.status === 'gone' ? 'ended' : a.status}`)
    return
  }
  await update($, stops, all => ({
    ...Object.fromEntries(Object.entries(all).slice(-(AGENT_CAP - 1))),
    [agentId]: 'pending' as StopState,
  }))
  let reason = ''
  let said = ''
  try {
    const r = await $.tool.call({
      tool: 'TaskStop',
      task_id: agentId,
      consent: `The user pressed "Stop" on Grimling's Stop / Keep confirm to stop agent ${agentId} ("${a.description}").`,
    })
    if (r.deny !== undefined) reason = r.deny || 'refused'
    else if (r.isError) reason = r.text || 'TaskStop reported an error'
    else said = r.text ?? r.result?.message ?? ''
  } catch (err) {
    // No TaskStop tool, or the call was aborted.
    reason = errMessage(err)
  }
  const now = await $.clock.now()
  logRun($, {
    kind: 'stop',
    at: new Date(now).toISOString(),
    agentId,
    type: a.type,
    description: a.description,
    ok: !reason,
    ...(reason ? { reason: reason.slice(0, 300) } : { message: said.slice(0, 300) }),
  })
  if (reason) {
    // Not stopped: the card stays as the engine reports it, and x can try again.
    await update($, stops, all => Object.fromEntries(Object.entries(all).filter(([id]) => id !== agentId)))
    debug($, 'stop.failed', { agentId, reason })
    void $.ui.toast(`Not stopped: ${reason}`)
    return
  }
  await update($, stops, all => ({ ...all, [agentId]: 'stopped' as StopState }))
  void $.ui.toast(`Agent stopped: ${a.description}`)
  const dex = await read($, roster)
  await grimPop($, 'killed', {
    name: cardForType(dex, a.type)?.name ?? titleCase(a.type),
    type: a.type,
    duration: since(a.firstSeen, now),
    task: shortTitle(a.description),
  })
}

// Puts text after the owner's draft (a blank line between) and says whether
// the box took it: false under a dialog or with no prompt box.
async function fillPrompt($: EngineInterface, text: string): Promise<boolean> {
  const box = await $.prompt.read().catch(() => ({ text: '' }))
  const sep = box.text.trim() ? '\n\n' : ''
  const res = await $.prompt.fill({ text: `${sep}${text}`, mode: 'append' }).catch(() => ({ isFilled: false }))
  return res.isFilled
}

// A ten-cell bar and its colour: green, yellow from 60%, red from 85%.
function gauge(pct: number): { bar: string; color: string } {
  const p = Math.max(0, Math.min(100, pct))
  const full = Math.round(p / 10)
  return { bar: '█'.repeat(full) + '░'.repeat(10 - full), color: p >= 85 ? 'error' : p >= 60 ? 'warning' : 'success' }
}


// The watcher writes -1 for a value it has no reading for yet.
function percent(n: number): string {
  return n < 0 ? '-' : `${Math.round(n)}%`
}

// Seconds since the watcher last wrote, and whether that is too long.
function podAge(p: PodStatus, now: number): { age: number; stale: boolean } {
  const age = Math.max(0, Math.round(now / 1000 - p.updated))
  const limit = p.intervalS && p.intervalS > 0 ? 3 * p.intervalS : STALE_DEFAULT_S
  return { age, stale: age > limit }
}

function since(from: number, to: number): string {
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

function kTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function bar(fraction: number, width: number): string {
  const full = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

function cell(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width)
}

// Words that say nothing on an 8-column card label (S4): "Give the Grimling
// landing page" reads "landing…", not "Give th…".
const FILLER = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'on', 'in', 'my', 'our', 'please', 'give', 'grimling', "grimling's"])

function cardLabel(task: string): string {
  const words = task.trim().split(/\s+/).filter(Boolean)
  const kept = words.filter(w => !FILLER.has(w.toLowerCase().replace(/[^a-z']/g, '')))
  return (kept.length > 0 ? kept : words).join(' ')
}

// Labels for a row of live cards: cards whose cut labels would read the same
// get a number, so no two cards look alike (S4).
function cardLabels(tasks: string[], width: number): string[] {
  const base = tasks.map(cardLabel)
  const cut = base.map(b => cell(b, width).trimEnd())
  const seen = new Map<string, number>()
  return base.map((b, i) => {
    if (cut.filter(c => c === cut[i]).length < 2) return b
    const n = (seen.get(cut[i]) ?? 0) + 1
    seen.set(cut[i], n)
    return `${cell(b, width - 2).trimEnd()} ${n}`
  })
}

function shortTitle(task: string): string {
  const words = task.trim().split(/\s+/).slice(0, 5).join(' ')
  return words.length > 40 ? `${words.slice(0, 39)}…` : words
}

function artOf(d: DexEntry | undefined, fallback: string): string[] {
  return d?.art ?? (d ? SPRITES[d.id] : undefined) ?? creature(fallback)
}

function mermaidSource(list: TrackedAgent[]): string {
  const id = (s: string) => `a${s.replace(/[^A-Za-z0-9]/g, '')}`
  const label = (a: TrackedAgent) => `${a.description.replace(/["[\]<>{}|]/g, '')} (${a.status})`
  const lines = ['flowchart LR', '  main(["main session"])']
  for (const a of list) {
    lines.push(`  ${id(a.id)}["${label(a)}"]`)
    lines.push(`  ${a.parentId ? id(a.parentId) : 'main'} --> ${id(a.id)}`)
  }
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    if (identityProblem($.plugin.name)) warnIdentity($)
    await $.command.register({
      name: 'grimling',
      description: 'Open Grimling: summon agents, message running ones, browse the Grimoire',
    })
    await $.command.register({
      name: 'grimling-tour',
      description: 'Walk through every Grimling key (Esc ends)',
    })
    await $.command.register({
      name: 'grimling-feedback',
      description: 'Report a Grimling bug or share an idea (previews first; opens GitHub)',
      argumentHint: '[bug:|idea:|praise:] [text]',
    })
    await $.command.register({
      name: 'grimling-setup',
      description: 'Check Grimling settings, show them, or pick common ones (previews before writing)',
      argumentHint: '[check|show|ask]',
    })

    // Merges agent.list() into the tracked agents. Writes only on a change,
    // so an idle deck does not redraw every poll.
    const pollAgents = async () => {
      const list = await $.agent.list()
      const now = await $.clock.now()
      const before = await read($, agents)
      const byId = new Map(before.map(a => [a.id, a]))
      const listed = new Set(list.map(a => a.id))
      for (const a of list) {
        const old = byId.get(a.id)
        byId.set(a.id, {
          id: a.id,
          // Written by the model that spawned it: drawn on cards and toasts.
          description: printable(a.description),
          type: a.type,
          status: a.status,
          parentId: a.parentId,
          firstSeen: old?.firstSeen ?? now,
          endedAt: ENDED.has(a.status) ? (old?.endedAt ?? now) : undefined,
        })
      }
      // Not listed and not ended: count the misses, then call it gone.
      for (const a of before) {
        if (listed.has(a.id) || ENDED.has(a.status)) continue
        const missing = (a.missing ?? 0) + 1
        byId.set(
          a.id,
          missing >= GONE_AFTER ? { ...a, status: 'gone', missing: undefined, endedAt: now } : { ...a, missing },
        )
      }
      // Over the cap, the oldest ended agents go first.
      let kept = [...byId.values()]
      for (let i = 0; kept.length > AGENT_CAP && i < kept.length; ) {
        if (ENDED.has(kept[i]?.status ?? '')) kept.splice(i, 1)
        else i += 1
      }
      kept = kept.slice(-AGENT_CAP)
      if (JSON.stringify(kept) !== JSON.stringify(before)) await update($, agents, () => kept)

      const was = new Map(before.map(a => [a.id, a.status]))
      const dex = await read($, roster)
      // Stops the deck asked for already toasted and told Grim.
      const halted = await read($, stops)
      // Grim's words for an ended agent: its card's name, type, run time, task.
      const grimVars = (a: { id: string; type: string; description: string }) => {
        const first = byId.get(a.id)?.firstSeen ?? now
        return {
          name: cardForType(dex, a.type)?.name ?? titleCase(a.type),
          type: a.type,
          duration: since(first, now),
          task: shortTitle(a.description),
        }
      }
      for (const a of list) {
        const prior = was.get(a.id) ?? ''
        if (a.status === 'killed' && halted[a.id]) continue
        if (BAD.has(a.status) && !BAD.has(prior)) {
          await announce($, a.status === 'killed' ? 'killed' : 'failed', `Agent ${a.status}: ${a.description}`)
          const vars = grimVars(a)
          const output = a.status === 'failed' ? (await read($, answers))[a.id] : undefined
          await grimPop(
            $,
            a.status === 'killed' ? 'killed' : 'failed',
            vars,
            a.status === 'failed' ? failurePrefill({ ...vars, output }, await homeDir($)) : undefined,
          )
        } else if (a.status === 'completed' && prior && prior !== 'completed') {
          await announce($, 'done', `Agent done: ${a.description} (Enter on its card for the answer)`)
          await grimPop($, 'done', grimVars(a))
        }
      }

      const running = kept.filter(a => !ENDED.has(a.status)).length
      const failed = kept.filter(a => BAD.has(a.status)).length
      const u = await $.session.usage()
      const cost = u.cost?.usd ?? 0
      if (cost !== (await read($, costUsd))) await update($, costUsd, () => cost)
      const lastReading = await read($, meter)
      const reading: Meter = {
        // A host may leave parts out (a test, an SDK): missing reads as empty.
        ctxPct: u.context?.percent,
        ctxTokens: u.context?.tokens,
        window: u.context?.window ?? 0,
        // A window the host stopped reporting after its reset shows 0% (B5).
        limits: carryLimits(
          lastReading?.limits ?? [],
          (u.rateLimits ?? []).map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt })),
          now,
        ),
        startedAt: u.startedAt ?? now,
        sessions: lastReading?.sessions ?? 0,
      }
      if (JSON.stringify(reading) !== JSON.stringify(lastReading)) await update($, meter, () => reading)
      const p = await read($, pod)
      // Only when something is going on; the owner's own status line has the cost.
      const parts: string[] = []
      if (running) parts.push(`⚙ ${running} running`)
      if (failed) parts.push(`${failed} failed`)
      if (p && p.phase !== 'DONE') {
        const { age, stale } = podAge(p, now)
        parts.push(
          stale
            ? `pod STALE: no update for ${since(0, age * 1000)} (last ${p.phase})`
            : `pod ${percent(p.pct)} ${p.phase} kill-by ${killBy(p.deadline, now, (await read($, settings)).time)}`,
        )
      }
      const text = parts.join(' | ')
      if (text !== lastStatus) {
        lastStatus = text
        void $.ui.status(text || undefined)
      }
    }

    const pollPod = async () => {
      const h = await homeDir($)
      if (!h) return
      const set = await read($, settings)
      let fresh: PodStatus | null = null
      // Pods (not in the public v0.1.0): the first status file of pods.files
      // that parses; `off` reads nothing.
      for (const path of set.pods.enabled === 'off' ? [] : await podFiles($, set.pods.files, h)) {
        try {
          const raw = JSON.parse(String(await $.fs.read(path))) as PodStatus
          // The watcher writes the phase in lower case (`done`): compare in one case.
          fresh = printableFields({ ...raw, phase: String(raw.phase ?? '').toUpperCase() })
          break
        } catch {
          fresh = null
        }
      }
      if (JSON.stringify(fresh) !== JSON.stringify(await read($, pod))) await update($, pod, () => fresh)
      // Active sessions, from a file a status line script writes as {"n": 3}
      // (meter.sessionsFile; off by default).
      if (!set.meter.sessionsFile) return
      try {
        const file = expandHome(set.meter.sessionsFile, h)
        const n = Number((JSON.parse(String(await $.fs.read(file))) as { n?: number }).n ?? 0)
        const m = await read($, meter)
        if (m && m.sessions !== n) await update($, meter, cur => (cur ? { ...cur, sessions: n } : cur))
      } catch {
        // No count yet.
      }
    }

    // One run of each poll at a time: a slow call never overlaps the next tick.
    // After a refused write the poll skips ticks rather than retry every 2 s;
    // a run with nothing refused resets it.
    const guarded = (fn: () => Promise<void>) => {
      let busy = false
      const wait = backoff()
      return () => {
        if (busy || wait.skip()) return
        busy = true
        const before = refusals
        void fn()
          .catch(onFail($, 'poll.error'))
          .finally(() => {
            if (refusals > before) wait.denied()
            else wait.reset()
            busy = false
          })
      }
    }

    // A second session.start in this process (resume, /clear) replaces the timers.
    for (const t of timers.splice(0)) {
      try {
        t.cancel()
      } catch {
        // a timer the engine already dropped
      }
    }
    // Settings first: the polls read them.
    await loadSettings($).catch(onFail($, 'settings.error'))
    timers.push(
      $.clock.every(POLL_MS, guarded(pollAgents)),
      $.clock.every(POD_POLL_MS, guarded(pollPod)),
      // Settings first: the dex reads cards.* and templates.enabled.
      $.clock.every(DEX_POLL_MS, guarded(async () => {
        await loadSettings($).catch(onFail($, 'settings.error'))
        await loadDex($).catch(onFail($, 'dex failed'))
      })),
    )
    void pollPod()
    void loadDex($).catch(onFail($, 'dex failed'))
    void loadRecent($).catch(onFail($, 'recent.error'))
    void loadRecords($).catch(onFail($, 'records.error'))
    void countLaunch($).catch(onFail($, 'nudge.error'))
    debug($, 'session.start', { cwd: e.cwd, surface: e.surface })
    void $.ui.open(OPEN)

    return next(e)
  })

  on('command.run', { command: 'grimling' }, $ => openDeck($))
  on('command.run', { command: 'grimling-tour' }, $ => openTour($))
  on('command.run', { command: 'grimling-feedback' }, async ($, e) => {
    const { draft, isPlaced } = await startFeedback($, e.args, 'command')
    if (isPlaced) {
      return {
        text:
          'Feedback preview is open in Grimling: it shows exactly what is sent. Send opens GitHub in your browser ' +
          '(you press Submit there), e edits the message, x cancels. The mod itself sends nothing.',
      }
    }
    // No pane on this surface: the link and the text here instead.
    const out = await outgoing($, draft)
    return { text: `Open this link to send it (nothing was sent):\n${out.url}\n\n${out.copy}` }
  })

  on('command.run', { command: 'grimling-setup' }, async ($, e) => {
    const mode = modeOf(e.args)
    if (mode === 'show') return { text: await setupShow($) }
    if (mode === 'ask') return { text: await startSetup($) }
    if (mode === 'check') return { text: await setupCheck($) }
    return { text: `Unknown mode "${e.args.trim()}": use /grimling-setup check, show or ask.` }
  })

  // Every spawn, the model's and the deck's, goes to the run log.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId) {
      await logSpawn($, {
        agentId: result.agentId,
        type: e.subagentType,
        model: result.model,
        description: e.description,
        prompt: e.prompt,
      })
    }

    return result
  })

  on('ui.press', { requestId: PANE }, async ($, e, next) => {
    debug($, 'press', e.element)
    try {
      return await next(e)
    } catch (err) {
      debug($, 'press.error', { element: e.element, error: String(err) })
      throw err
    }
  })

  // The deck tracks where the ring is (hints, hotkeys off while typing, the
  // Flow/Table window). Moving onto a card does not retarget the launch box:
  // only Enter on a card or its digit does.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const el = e.element ?? null
    debug($, 'focus', el)
    if (el !== (await read($, focusKey))) await update($, focusKey, () => el)

    return next(e)
  })

  on('ui.close', { id: TOUR_PANE }, async ($, e, next) => {
    tourTimer?.cancel()
    tourTimer = undefined
    await update($, tour, () => null)
    await update($, tab, () => 'deck' as Tab)
    await update($, selected, () => null)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: TOUR_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const at = (await read($, tour)) ?? 0
    const keyWidth = Math.max(...STEPS.map(s => s.keys.length)) + 2

    return (
      <Box flexDirection="column">
        <Text bold>
          Grimling keys <Text dimColor>· {at + 1}/{STEPS.length} · Esc ends the tour</Text>
        </Text>
        {STEPS.map((s, i) => (
          <Text key={`step-${i}`} inverse={i === at} dimColor={i !== at}>
            {i === at ? '▶ ' : '  '}
            {s.keys.padEnd(keyWidth)}
            {s.what}
          </Text>
        ))}
        <Text dimColor>Full list: COMMANDS.md in the mod folder</Text>
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const u = e.usage
    if (u) {
      const key = e.agentId ?? 'main'
      await update($, usage, all => {
        const old = all[key] ?? { tokensIn: 0, tokensOut: 0, model: u.model }
        const tokensIn =
          old.tokensIn + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        return { ...all, [key]: { tokensIn, tokensOut: old.tokensOut + u.output_tokens, model: u.model } }
      })
    }
    // Keep each subagent's last answer for its card (capped, newest 40 agents:
    // a new answer moves its agent to the end) and log its head for agent-dex.
    const agentId = e.agentId
    if (agentId && e.answer) {
      // What the pane draws, copies and puts in the prompt: no terminal
      // escapes or other control characters (the run log keeps it as sent).
      const shown = printable(e.answer)
      const cut = shown.length > ANSWER_CAP
      const kept = cut
        ? `${shown.slice(0, ANSWER_CAP)}\n\n[truncated: first ${ANSWER_CAP} of ${shown.length} characters]`
        : shown
      await update($, answers, all => {
        const rest = Object.entries(all).filter(([id]) => id !== agentId)
        return Object.fromEntries([...rest, [agentId, kept]].slice(-40))
      })
      logRun($, {
        kind: 'answer',
        at: new Date(await $.clock.now()).toISOString(),
        agentId,
        reason: e.reason,
        durationMs: e.durationMs,
        answer: e.answer,
      })
      await arenaAnswer($, agentId, shown, e.durationMs, e.usage?.output_tokens ?? 0).catch(err =>
        debug($, 'arena.answer.error', String(err)),
      )
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    try {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // The mobile app draws no text field: there the deck reads only.
    const Input = 'Input' in ui ? ui.Input : undefined
    const view = await read($, tab)
    const list = await read($, agents)
    const used = await read($, usage)
    const p = await read($, pod)
    const cost = await read($, costUsd)
    const pick = await read($, selected)
    const arming = await read($, armed)
    const said = await read($, answers)
    const dex = await read($, roster)
    const aim = await read($, target)
    const typed = await read($, draft)
    const cat = await read($, dexCat)
    const query = await read($, dexText)
    const past = await read($, recent)
    const gauges = await read($, meter)
    const pickA = await read($, arenaPick)
    const fightOn = await read($, battle)
    const ladder = await read($, records)
    const quiz = await read($, puzzles)
    const grimUp = await read($, grim)
    const grimAt = await read($, grimFrame)
    const switches = await read($, settings)
    const setReport = await read($, settingsProblems)
    const fb = await read($, feedback)
    const sd = await read($, setup)
    const nudgeOn = await read($, nudge)
    const mine = await read($, launched)
    const halts = await read($, stops)
    paneWidth = e.props.bodyColumns
    // Pods is behind pods.enabled: `auto` shows the tab only while a status file is read.
    const showPods = switches.pods.enabled === 'on' || (switches.pods.enabled === 'auto' && !!p) || view === 'pods'
    const focused = e.props.isFocused ? await read($, focusKey) : null
    const now = await $.clock.now()
    // A failed agent's Grim bubble offers `f`: report it with /grimling-feedback.
    const reportUp =
      !!grimUp && grimUp.event === 'failed' && !!grimUp.report && switches.grim.enabled && now < grimUp.until
    const inline = e.props.placement === 'inline'
    const width = Math.max(30, e.props.bodyColumns)
    // Inline the pane shares the screen with the prompt: keep it short.
    const room = inline ? 5 : Math.max(4, (e.viewport?.rows ?? 24) - 9)

    const running = list.filter(a => !ENDED.has(a.status)).length
    const done = list.filter(a => a.status === 'completed').length
    const failed = list.filter(a => BAD.has(a.status)).length
    const tokens = (id: string) => {
      const u = used[id]
      return u ? kTokens(u.tokensIn + u.tokensOut) : '-'
    }
    const age = (a: TrackedAgent) => since(a.firstSeen, a.endedAt ?? now)
    const toggle = (id: string) => void update($, selected, cur => (cur === id ? null : id))
    const lit = (key: string) => focused === key
    // No hotkeys while an Input has the ring: `f` in a task must type an f,
    // not switch to Flow.
    const keyed = (k: string | undefined) => (TYPING.has(focused ?? '') ? undefined : k)

    // The tab bar: each tab a focusable button (Tab to it, Enter), with a
    // letter hotkey too. The one the ring is on is drawn in the accent color.
    const tabButton = (key: string, label: string, hotkey: string | undefined, onPress: () => void, active = false) => (
      <Button key={key} hotkey={keyed(hotkey)} plain onPress={onPress}>
        <Text
          bold={active || lit(key)}
          inverse={active}
          color={lit(key) ? 'claude' : active ? undefined : 'subtle'}
          underline={lit(key)}
        >
          {active ? ` ${label} ` : label}
        </Text>
      </Button>
    )
    // The pane is often docked narrow (about 44 columns) and the terminal
    // writes each hotkey in front of its button (`d: `): keep each row short.
    const header = (
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {TABS.filter(t => t !== 'pods' || showPods).map(t =>
          // While a failed agent's Grim bubble offers `f` (report), Flow keeps only Tab and Enter.
          tabButton(`tab-${t}`, t.toUpperCase(), t === 'flow' && reportUp ? undefined : t[0], () => void update($, tab, () => t), view === t),
        )}
      </Box>
    )
    // The owner's status line, as bars: context, plan limits, cost and time,
    // model, sessions, and the pod's runs as a heat strip.
    const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', seven_day_opus: '7d op' }
    const row = (label: string, pct: number, extra: string, key: string) => {
      const g = gauge(pct)
      return (
        <Text key={key} wrap="truncate-end">
          <Text dimColor>{label.padEnd(4)}</Text>
          <Text color={g.color}>{g.bar}</Text> <Text bold>{`${Math.round(pct)}%`.padStart(4)}</Text>
          <Text dimColor> {extra}</Text>
        </Text>
      )
    }
    const model = used.main?.model?.replace(/^claude-/, '') ?? ''
    const heat = (p: PodStatus) =>
      p.runs
        .map(([, f, st]) => (st === 'pending' ? '·' : '▁▂▃▄▅▆▇█'[Math.max(0, Math.min(7, Math.floor(f * 7.999)))] ?? '·'))
        .join('')
    // A rounded box with its title set into the top border: the title Box is
    // drawn absolute, so it paints over the border without moving anything.
    const panel = (key: string, title: string, color: string, rows: RenderChildren, pad = 1) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={pad}>
        <Box position="absolute" top={-1} left={0}>
          <Text color={color} bold>{` ${title} `}</Text>
        </Box>
        {rows}
      </Box>
    )
    const podPanel = (p: PodStatus) => {
      const { stale } = podAge(p, now)
      const doneRuns = p.runs.filter(r => r[2] === 'done').length
      const color = stale || p.phase === 'FAILED' ? 'error' : p.phase.startsWith('DONE') ? 'success' : 'warning'
      return panel(
        'm-pod',
        `pod ${p.pod}`.trim(),
        color,
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={color}>
              {heat(p)} {percent(p.pct)} {stale ? 'STALE' : p.phase.toLowerCase()} {doneRuns}/{p.runs.length}
            </Text>
            <Text dimColor>{p.gpu >= 0 ? ` · gpu ${Math.round(p.gpu)}%` : ''}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            ${p.cost.toFixed(2)} · kill-by {killBy(p.deadline, now, switches.time)}
          </Text>
        </Box>,
      )
    }
    const meterBlock = (() => {
      if (!gauges) return null
      const ctx = gauges.ctxPct ?? 0
      const tok = gauges.ctxTokens !== undefined ? `${kTokens(gauges.ctxTokens)}/${kTokens(gauges.window)}` : ''
      const facts = [
        `$${cost.toFixed(2)}`,
        since(gauges.startedAt, now),
        model,
        gauges.sessions > 1 ? `${gauges.sessions} sessions` : '',
      ].filter(Boolean)
      const livePod = p && !p.phase.startsWith('DONE') ? p : null
      if (inline) {
        const parts = [`ctx ${Math.round(ctx)}%`, ...gauges.limits.map(l => `${LIMIT_LABEL[l.kind] ?? l.kind} ${Math.round(l.pct)}%`), ...facts]
        return (
          <Text dimColor wrap="truncate-end">
            {parts.join(' · ')}
          </Text>
        )
      }
      return (
        <Box flexDirection="column">
          {panel(
            'm-usage',
            'usage',
            'subtle',
            <Box flexDirection="column">
              {row('ctx', ctx, tok, 'm-ctx')}
              {gauges.limits.map(l =>
                row(LIMIT_LABEL[l.kind] ?? l.kind, l.pct, l.reset ? 'new window' : l.resetsAt ? `resets ${resetTime(l.resetsAt, switches.time)}` : '', `m-${l.kind}`),
              )}
              <Text dimColor wrap="truncate-end">
                {facts.join(' · ')}
              </Text>
            </Box>,
          )}
          {livePod && podPanel(livePod)}
        </Box>
      )
    })()

    const footer = (line: string) => (
      <Box flexDirection="column">
        <Text color={e.props.isFocused ? 'claude' : 'subtle'} wrap="truncate-end">
          ▸ {line}
        </Text>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {tabButton('tab-mermaid', 'Mermaid', 'm', () => {
            void $.ui.copy({ text: mermaidSource(list), surface: e.surface })
            void $.ui.toast('Agent graph copied as mermaid')
          })}
          {tabButton('tab-help', 'Help', 'h', () => void startTour($))}
          {tabButton('tab-arena', 'Arena', 'a', () => void update($, tab, () => 'arena' as Tab), view === 'arena')}
          <Text>
            <Text color="warning">{running}▶</Text> <Text color="success">{done}✓</Text>{' '}
            <Text color={failed ? 'error' : 'subtle'}>{failed}✕</Text> <Text dimColor>${cost.toFixed(2)}</Text>
          </Text>
          {setReport.problems.length > 0 && (
            <Text color="warning">{`⚠ settings: ${setReport.problems.length} problem${setReport.problems.length === 1 ? '' : 's'} · k`}</Text>
          )}
          <Text dimColor>{BUILD}</Text>
        </Box>
      </Box>
    )

    const sprite = (px: string[], key: string, pal: Record<string, string> = PALETTE) => {
      const rows = []
      for (let r = 0; r < px.length; r += 2) {
        const top = px[r] ?? ''
        const low = px[r + 1] ?? ''
        rows.push(
          <Text key={`${key}-r${r}`}>
            {[...top].map((t, i) => {
              const up = pal[t]
              const down = pal[low[i] ?? '.']
              if (up && down) return <Text key={`${key}-${r}-${i}`} color={up} backgroundColor={down}>▀</Text>
              if (up) return <Text key={`${key}-${r}-${i}`} color={up}>▀</Text>
              if (down) return <Text key={`${key}-${r}-${i}`} color={down}>▄</Text>
              return <Text key={`${key}-${r}-${i}`}> </Text>
            })}
          </Text>,
        )
      }
      return rows
    }

    // One small card: sprite over its name (the focusable part: a Button
    // holds only text) and an optional status line. The border lights up with
    // the ring, marks the launch target, or carries the agent's status.
    const card = (o: {
      key: string
      art: string[]
      name: string
      sub?: string
      color: string
      hotkey?: string
      onPress: (press: { surface: CopySurface }) => void
      // A running card the deck launched: its STOP button (x while the ring is on the card).
      stop?: { key: string; hotkey?: string; onPress: () => void }
    }) => {
      const hot = lit(o.key)
      const stopButton = o.stop && (
        <Button key={o.stop.key} hotkey={o.stop.hotkey} plain onPress={o.stop.onPress}>
          <Text color="error" inverse={lit(o.stop.key)}>
            STOP
          </Text>
        </Button>
      )
      if (inline) {
        const named = (
          <Button key={o.key} hotkey={keyed(o.hotkey)} plain onPress={o.onPress}>
            <Text inverse={hot} color={o.color === 'subtle' ? 'text' : o.color}>
              {o.hotkey ? `${o.hotkey}·` : ''}
              {cell(o.name, 10).trimEnd()}
            </Text>
          </Button>
        )
        return stopButton ? (
          <Box key={`pair-${o.key}`} flexDirection="row" columnGap={1}>
            {named}
            {stopButton}
          </Box>
        ) : (
          named
        )
      }
      return (
        <Box
          key={`box-${o.key}`}
          flexDirection="column"
          alignItems="center"
          borderStyle={hot ? 'double' : 'round'}
          borderColor={hot ? 'claude' : o.color}
          width={10}
        >
          {sprite(o.art, o.key)}
          <Button key={o.key} hotkey={keyed(o.hotkey)} plain onPress={o.onPress}>
            <Text bold={hot} inverse={hot}>
              {cell(o.name, o.hotkey && keyed(o.hotkey) ? 5 : 8).trimEnd()}
            </Text>
          </Button>
          {o.sub !== undefined && <Text dimColor>{cell(o.sub, 8).trimEnd()}</Text>}
          {stopButton}
        </Box>
      )
    }

    const detail = (a: TrackedAgent) => {
      const u = used[a.id]
      return (
        <Text key={`detail-${a.id}`} dimColor>
          {'     '}id {a.id.slice(0, 10)} · {a.type}
          {a.parentId ? ` · parent ${a.parentId.slice(0, 8)}` : ' · from main'}
          {u ? ` · in ${kTokens(u.tokensIn)} out ${kTokens(u.tokensOut)} · ${u.model}` : ' · no turn yet'}
        </Text>
      )
    }

    // The rows in view: around the focused row (with a neighbour each side
    // drawn, so Tab and the arrows can always reach the next one), else the
    // selected row, else the newest. Counts what is cut above and below.
    function windowOf<T>(rows: T[], ids: string[]): { rows: T[]; above: number; below: number } {
      if (rows.length <= room) return { rows, above: 0, below: 0 }
      const fit = Math.max(3, room - 2)
      const ringAt = ids.findIndex(id => `row-${id}` === focused)
      const index = ringAt >= 0 ? ringAt : ids.indexOf(pick ?? '')
      const start =
        index < 0 ? rows.length - fit : Math.min(rows.length - fit, Math.max(0, index - Math.floor(fit / 2)))
      return { rows: rows.slice(start, start + fit), above: start, below: rows.length - start - fit }
    }
    const more = (n: number, arrow: string) =>
      n > 0 ? <Text key={`more-${arrow}`} dimColor>{`${arrow} ${n} more`}</Text> : null

    // Grim with its speech bubble while it is up: the sprite (12 columns, 6
    // rows) and the line wrapped in what is left; inline a single line.
    const grimBlock = (() => {
      if (!grimUp || !switches.grim.enabled || now >= grimUp.until) return null
      const color = grimUp.event === 'done' || grimUp.event === 'thanks' ? 'success' : 'error'
      const report = reportUp && (
        <Button
          key="grim-report"
          hotkey={keyed('f')}
          plain
          onPress={() => void startFeedback($, '', 'grim', grimUp.report).catch(onFail($, 'feedback.error'))}
        >
          <Text color="error" inverse={lit('grim-report')}>
            [f] report it
          </Text>
        </Button>
      )
      if (inline) {
        return (
          <Box key="grim-row" flexDirection="row" columnGap={1}>
            <Text key="grim-say" wrap="truncate-end">
              <Text color={GRIM_PAL.S} bold>Grim:</Text> {grimUp.text}
            </Text>
            {report}
          </Box>
        )
      }
      return (
        <Box key="grim" flexDirection="row" alignItems="center">
          <Box flexDirection="column" width={12}>
            {sprite(GRIM[grimAt], 'grim', GRIM_PAL)}
          </Box>
          <Text color={color}>◀</Text>
          <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={Math.max(14, width - 13)}>
            <Text key="grim-say" wrap="wrap">
              {grimUp.text}
            </Text>
            {report}
          </Box>
        </Box>
      )
    })()

    // The one line that says what the next key does.
    let hint: string
    let body

    if (view === 'deck') {
      const entries = dex.length ? dex : BUILTINS.map((d, i) => ({ ...d, no: i + 1 }))
      const q = query.trim().toLowerCase()
      const shown = entries.filter(
        d =>
          (cat === 'all' || d.cat === cat) &&
          (!q || `${d.name} ${d.type ?? ''} ${d.what}`.toLowerCase().includes(q)),
      )
      // A link card is never the launch target.
      const targets = entries.filter(d => !d.link)
      const chosen = targets.find(d => d.id === aim) ?? targets[1] ?? targets[0]
      const byType = (type: string) => cardForType(entries, type)
      const allLive = [...list.filter(a => !ENDED.has(a.status)), ...list.filter(a => ENDED.has(a.status)).reverse()]
      const live = allLive.slice(0, inline ? 6 : 12)
      // Cards past the cap are counted, so the totals in the footer match (S1).
      const liveCut = allLive.length - live.length
      const agentOf = arming ? list.find(a => a.id === arming.agentId) : undefined

      // The draft is cleared only once the task went somewhere; a refused
      // spawn or fill leaves it in the box to retry.
      const launch = async (text: string) => {
        const task = text.trim()
        if (!task || !chosen) return
        // A template card fills the prompt; the person reads it and sends it.
        if (chosen.fill) {
          const vars = { task, cwd, date: dayOf(await $.clock.now()) }
          const ok = await fillPrompt($, fillTemplate(chosen.text ?? '{task}', vars))
          await update($, draft, () => (ok ? '' : text))
          const from = chosen.tag === 'proj' ? ' (a project template: read it first)' : ''
          void $.ui.toast(
            ok
              ? `${chosen.name} request is in the prompt${from}: Esc, then Enter to send it`
              : `${chosen.name} request not put in the prompt (a dialog is open, or no prompt box)`,
          )
          return
        }
        // Another running agent on this brief or in this worktree: warn once,
        // keep the draft; Enter on the same task again launches anyway.
        const running = list
          .filter(a => !ENDED.has(a.status))
          .map(a => ({ id: a.id, description: a.description, prompt: briefs.get(a.id) ?? '' }))
        const clash = launchClash(task, running)
        if (clash && clashWarned !== task) {
          clashWarned = task
          await update($, draft, () => text)
          debug($, 'launch.clash', { agentId: clash.agent.id, why: clash.why, path: clash.path ?? '' })
          void $.ui.toast(
            `${clash.agent.description} is still running ${
              clash.why === 'brief' ? 'this same brief' : `in ${clash.path}`
            }: Enter again to launch anyway`,
            { timeoutMs: 10000 },
          )
          return
        }
        clashWarned = ''
        const description = shortTitle(task)
        const res = await $.agent.spawn({ prompt: task, description, subagentType: chosen.type })
        // Only agents the deck launched get a stop button.
        const id = res.agentId
        if (id) await update($, launched, ids => [...ids.filter(x => x !== id), id].slice(-AGENT_CAP))
        if (id) await logSpawn($, { agentId: id, type: chosen.type, model: res.model, description, prompt: task })
        await update($, draft, () => (res.deny ? text : ''))
        void $.ui.toast(
          res.deny ? `${chosen.name} not started: ${res.deny}` : `${chosen.name} started: ${shortTitle(task)}`,
        )
      }
      const message = async (a: TrackedAgent, text: string) => {
        const msg = text.trim()
        await arm($, null)
        if (!msg) return
        const res = await $.session.send({ to: { agentId: a.id }, text: msg })
        void $.ui.toast(res.isDelivered ? `Sent to ${a.description}` : `Not sent: ${res.reason}`)
      }

      const launchBox = Input ? (
        <Input
          key={LAUNCH}
          label={`${chosen?.short ?? chosen?.name ?? ''} ›`}
          placeholder={chosen?.fill ? 'topic (fills the prompt)' : 'task, Enter launches'}
          value={typed}
          submitLabel={chosen?.fill ? 'fill' : 'go'}
          onInput={(value: string) => {
            // An edited task is a new one: the clash warning applies again.
            if (value.trim() !== clashWarned) clashWarned = ''
            void update($, draft, () => value)
          }}
          onSubmit={(value: string) => void launch(value)}
        />
      ) : (
        <Text dimColor>Launching needs the terminal or desktop app.</Text>
      )

      const chips = (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {CATS.map(c => {
            const n = c === 'all' ? entries.length : entries.filter(d => d.cat === c).length
            if (!n && cat !== c) return null
            return (
              <Button key={`cat-${c}`} plain onPress={() => void update($, dexCat, () => c)}>
                <Text
                  inverse={cat === c}
                  color={lit(`cat-${c}`) ? 'claude' : cat === c ? undefined : 'subtle'}
                  underline={lit(`cat-${c}`)}
                >
                  {`${CAT_LABEL[c] ?? titleCase(c)} ${n}`}
                </Text>
              </Button>
            )
          })}
          </Box>
          {Input && !inline && (
            <Input
              key={FILTER}
              label="find"
              placeholder="agent by name"
              value={query}
              onInput={(value: string) => void update($, dexText, () => value)}
              onSubmit={(value: string) => void update($, dexText, () => value)}
            />
          )}
        </Box>
      )

      const dexCards = shown.map((d, i) =>
        card({
          key: `card-${d.id}`,
          art: artOf(d, d.type ?? d.id),
          name: d.short ?? d.name,
          color: d.id === chosen?.id ? 'warning' : d.fill ? 'suggestion' : 'subtle',
          hotkey: i < 9 ? String(i + 1) : undefined,
          // A link card opens its page; it never becomes the launch target.
          onPress: press =>
            void (async () => {
              if (d.link) return openLink($, d.link, press.surface)
              await update($, target, () => d.id)
              await focusOn($, LAUNCH)
            })().catch(onFail($, 'card.error')),
        }),
      )

      // The dex entry for the card under the ring, else the launch target:
      // number, category, type, purpose.
      const about = entries.find(d => `card-${d.id}` === focused) ?? chosen
      const entry = about && (
        <Text wrap="truncate-end">
          <Text color="warning">#{String(about.no).padStart(3, '0')}</Text> <Text bold>{about.name}</Text>
          <Text dimColor>
            {' · '}
            {about.what} · {about.link ? 'opens in your browser' : about.fill ? 'fills the prompt' : about.type}
            {about.tag ? ` · ${about.tag}` : about.source === 'builtin' ? '' : ` · ${about.source}`}
          </Text>
        </Text>
      )
      const entryNote = about?.note && (
        <Text dimColor wrap="wrap">
          {about.note}
        </Text>
      )

      // STOP only on a running card the deck launched, with no stop asked yet;
      // x is its hotkey while the ring is on that card.
      const canStop = (a: TrackedAgent) =>
        switches.stop.enabled && mine.includes(a.id) && !ENDED.has(a.status) && !halts[a.id]
      const ringOn = (a: TrackedAgent) => focused === `agent-${a.id}` || focused === `stop-${a.id}`
      const stopKeyOn = !arming && live.some(a => canStop(a) && ringOn(a))
      // The result box's two actions, each always ending in a toast (B1, B2).
      const putAnswer = async (a: TrackedAgent) => {
        const text = said[a.id] ?? ''
        const cut = /\[truncated: first \d+ of \d+ characters\]$/.test(text)
        if (!text) {
          void $.ui.toast(`No answer recorded for ${a.description}`)
          return
        }
        let ok = false
        try {
          ok = await fillPrompt($, `Result from agent "${a.description}":\n\n${text}\n\n`)
        } catch (err) {
          debug($, 'result.error', errMessage(err))
        }
        debug($, 'result.fill', { agentId: a.id, ok, chars: text.length })
        if (ok) await arm($, null)
        void $.ui.toast(
          ok
            ? `Answer from ${a.description} is in the prompt${cut ? ' (truncated)' : ''}: Esc to go to it`
            : 'Answer not put in the prompt (a dialog is open, or no prompt box): c copies it',
        )
      }
      const copyAnswer = async (a: TrackedAgent, surface: typeof e.surface) => {
        const text = said[a.id] ?? ''
        if (!text) {
          void $.ui.toast(`No answer recorded for ${a.description}`)
          return
        }
        let note: string
        try {
          const res = await $.ui.copy({ text, surface })
          note = res.isCopied
            ? `Answer from ${a.description} copied (${text.length} characters)`
            : `Answer not copied (${res.reason}): Enter puts it in the prompt`
          debug($, 'result.copy', res.isCopied ? { ok: true } : { ok: false, reason: res.reason })
        } catch (err) {
          debug($, 'result.error', errMessage(err))
          note = 'Answer not copied: Enter puts it in the prompt'
        }
        void $.ui.toast(note)
      }

      const labels = cardLabels(live.map(a => a.description), 8)
      const liveCards = live.map((a, i) =>
        card({
          key: `agent-${a.id}`,
          art: artOf(byType(a.type), a.type),
          name: labels[i],
          sub:
            halts[a.id] && !ENDED.has(a.status)
              ? halts[a.id] === 'pending' ? 'stopping' : 'stopped'
              : `${GLYPH[a.status] ?? '?'} ${a.status === 'running' ? age(a) : tokens(a.id)}`,
          color: agentOf?.id === a.id ? 'warning' : (COLOR[a.status] ?? 'subtle'),
          // The ring may stay on the card when the box opens (the focus move
          // can land before the box is drawn): Enter there again puts the
          // answer in the prompt instead of reopening the box (B1).
          onPress: () =>
            void (arming?.kind === 'result' && arming.agentId === a.id
              ? putAnswer(a)
              : arm($, ENDED.has(a.status) ? { kind: 'result', agentId: a.id } : { kind: 'message', agentId: a.id })),
          stop: canStop(a)
            ? {
                key: `stop-${a.id}`,
                hotkey: !arming && ringOn(a) ? keyed('x') : undefined,
                onPress: () => void arm($, { kind: 'stop', agentId: a.id }),
              }
            : undefined,
        }),
      )

      let action = null
      if (arming?.kind === 'message' && agentOf && Input) {
        action = (
          <Input
            key={INPUT}
            label={`to ${cell(agentOf.description, 20).trimEnd()} ›`}
            placeholder="message, Enter sends it"
            submitLabel="send"
            autoFocus
            onSubmit={(value: string) => void message(agentOf, value)}
          />
        )
      } else if (arming?.kind === 'stop' && agentOf) {
        action = (
          <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
            <Text bold wrap="truncate-end">
              Stop {agentOf.description}?
            </Text>
            <Text dimColor wrap="wrap">
              Grimling only stops an agent when you confirm. Claude Code may ask too.
            </Text>
            <Box flexDirection="row" gap={2}>
              <Button key="confirm-keep" autoFocus hotkey={keyed('x')} plain onPress={() => void arm($, null)}>
                <Text inverse={lit('confirm-keep')}>Keep</Text>
              </Button>
              <Button
                key="confirm-stop"
                plain
                onPress={() => void stopAgent($, agentOf.id).catch(onFail($, 'stop.error'))}
              >
                <Text color="error" inverse={lit('confirm-stop')}>
                  Stop
                </Text>
              </Button>
            </Box>
          </Box>
        )
      } else if (arming?.kind === 'result' && agentOf) {
        const text = said[agentOf.id] ?? ''
        const cut = /\[truncated: first \d+ of \d+ characters\]$/.test(text)
        const preview = text ? text.split('\n').slice(0, inline ? 2 : 6) : ['(no answer recorded for this agent)']
        action = (
          <Box flexDirection="column" borderStyle="round" borderColor="success" paddingX={1}>
            <Text bold>
              {agentOf.description}
              {cut ? <Text color="warning"> (truncated)</Text> : null}
            </Text>
            {preview.map((line, i) => (
              <Text key={`ans-${i}`} wrap="truncate-end">
                {line}
              </Text>
            ))}
            <Box flexDirection="row" gap={2}>
              <Button key="ans-prompt" autoFocus plain onPress={() => void putAnswer(agentOf)}>
                <Text color="claude" inverse={lit('ans-prompt')}>[Enter] put in prompt</Text>
              </Button>
              <Button key="ans-copy" hotkey={keyed('c')} plain onPress={press => void copyAnswer(agentOf, press.surface)}>
                <Text dimColor inverse={lit('ans-copy')}>copy</Text>
              </Button>
              <Button key="ans-close" hotkey={keyed('x')} plain onPress={() => void arm($, null)}>
                <Text dimColor>close</Text>
              </Button>
            </Box>
          </Box>
        )
      }

      const f = focused ?? ''
      const focusedLink = entries.find(d => `card-${d.id}` === f)?.link
      if (arming?.kind === 'message') hint = 'Type, then Enter sends · empty Enter cancels'
      else if (arming?.kind === 'result') hint = 'Enter puts the answer in the prompt · c copy · x close'
      else if (arming?.kind === 'stop') hint = 'Enter on Keep (or x) keeps it · Tab to Stop, Enter stops it'
      else if (f === LAUNCH) hint = `Type the task for ${chosen?.name ?? 'the target'}, Enter ${chosen?.fill ? 'fills the prompt' : 'launches'}`
      else if (f === FILTER) hint = 'Type to filter the dex by name · Tab to the cards'
      else if (focusedLink) hint = `Enter: open ${focusedLink.title} in your browser · Tab/arrows: next card`
      else if (f.startsWith('card-')) hint = 'Enter: make it the launch target (type the task) · Tab/arrows: next card'
      else if (stopKeyOn) hint = 'Enter: message it · x: stop it (asks Stop / Keep first)'
      else if (f.startsWith('agent-')) hint = 'Enter: message it (running) or read its answer (finished)'
      else if (f.startsWith('tab-')) hint = 'Enter switches view · Tab moves on to the launch box'
      else if (f.startsWith('cat-')) hint = 'Enter filters the dex by this category'
      else if (f.startsWith('recent-')) hint = 'Enter: load this task and agent into the launch box'
      else
        hint = e.props.isFocused
          ? 'Tab / Shift+Tab or arrows · Enter picks · 1-9 cards · Esc prompt'
          : 'ctrl+x Tab (or click) to use the deck · /grimling-tour for help'

      // Docked, the deck fits the pane's rows: recent runs, then Grimoire
      // rows, give way so the engine never scrolls the tab bar out (B4).
      const perRow = Math.max(1, Math.floor((width - 2) / 10))
      const userCards = entries.some(d => d.source === 'user' || d.source === 'project')
      const answerLines = (said[agentOf?.id ?? ''] ?? '').split('\n').length
      const actionRows =
        arming?.kind === 'result' ? 4 + Math.min(6, answerLines)
          : arming?.kind === 'stop' ? 6
          : arming?.kind === 'message' ? 1
          : 0
      const fixed =
        3 + (width < 44 ? 1 : 0) + // tab bar panel
        (gauges ? 4 + gauges.limits.length + (p && !p.phase.startsWith('DONE') ? 4 : 0) : 0) +
        (grimBlock ? 6 : 0) +
        (nudgeOn ? 1 : 0) +
        3 + // footer
        4 + // summon panel
        3 + (width < 60 ? 1 : 0) + (Input ? 1 : 0) + (userCards ? 0 : 2) + // grimoire chrome
        2 + actionRows + (live.length ? Math.ceil(live.length / perRow) * 9 : 2) + // agents panel
        2 + (past.length ? 0 : 2) // recent chrome
      const fit = inline
        ? { cards: shown.length, recent: past.length }
        : fitDeck({
            budget: e.props.scroll?.bodyRows ?? Math.max(10, (e.viewport?.rows ?? 40) - 4),
            fixed,
            cards: shown.length,
            perRow,
            cardH: 7,
            recent: past.length,
          })
      const cardAt = shown.findIndex(d => `card-${d.id}` === focused)
      const cardWin = windowAt(shown.length, fit.cards, cardAt >= 0 ? cardAt : shown.findIndex(d => d.id === chosen?.id))
      const cardsCut = shown.length - (cardWin.end - cardWin.start)
      const recentCut = past.length - fit.recent
      const grid = shown.length ? (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap">
            {dexCards.slice(cardWin.start, cardWin.end)}
          </Box>
          {cardsCut > 0 && (
            <Text dimColor wrap="truncate-end">{`${cardsCut} more card${cardsCut === 1 ? '' : 's'}: find, a category, or Tab`}</Text>
          )}
        </Box>
      ) : (
        <Text dimColor>No agent matches this filter.</Text>
      )
      const liveGrid = live.length > 0 && (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap">
            {liveCards}
          </Box>
          {liveCut > 0 && (
            <Text key="live-more" dimColor wrap="truncate-end">{`+${liveCut} older agent${liveCut === 1 ? '' : 's'}: Table (t) lists all`}</Text>
          )}
        </Box>
      )
      const recentRows =
        !inline &&
        past.map((r, i) => {
              const d = byType(r.type)
              const ago = r.at ? since(Date.parse(r.at), now) : ''
              return (
                <Button
                  key={`recent-${i}`}
                  plain
                  onPress={() =>
                    void (async () => {
                      // This load's whole brief when it has one; the run log's otherwise.
                      const brief = briefs.get(r.agentId) ?? r.prompt
                      await update($, target, () => d?.id ?? 'builder')
                      clashWarned = ''
                      await update($, draft, () => brief)
                      await focusOn($, LAUNCH)
                      if (isCutBrief(brief)) {
                        void $.ui.toast(
                          'This brief was cut or redacted in the run log (log.promptChars, log.runs): check its end before Enter',
                          { timeoutMs: 10000 },
                        )
                      }
                    })()
                  }
                >
                  <Text wrap="truncate-end" color={lit(`recent-${i}`) ? 'claude' : undefined}>
                    <Text color="suggestion">{cell(d?.short ?? d?.name ?? r.type, 6)}</Text> {r.description}
                    <Text dimColor> · {ago}</Text>
                  </Text>
                </Button>
              )
            })

      // The one-time feedback hint (after the 5th start); x hides it for good.
      const nudgeLine = nudgeOn && (
        <Box key="nudge" flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text color="suggestion" wrap="truncate-end">
            Grim: enjoying it? /grimling-feedback sends a bug or an idea
          </Text>
          <Button
            key="nudge-dismiss"
            hotkey={arming || stopKeyOn ? undefined : keyed('x')}
            plain
            onPress={() =>
              void (async () => {
                await update($, nudge, () => false)
                await $.store.set('nudgeDismissed', true).catch(onFail($, 'nudge.error'))
              })()
            }
          >
            <Text dimColor inverse={lit('nudge-dismiss')}>
              [x] hide
            </Text>
          </Button>
        </Box>
      )

      body = inline ? (
        <Box flexDirection="column">
          {nudgeLine}
          {launchBox}
          {entry}
          {entryNote}
          {chips}
          {grid}
          {action}
          <Text dimColor>{live.length ? `agents · ${live.length}` : 'agents · none yet: launch one above'}</Text>
          {liveGrid}
        </Box>
      ) : (
        <Box flexDirection="column">
          {nudgeLine}
          {panel(
            'p-summon',
            'summon',
            focused === LAUNCH ? 'claude' : 'subtle',
            <Box flexDirection="column">
              {launchBox}
              {entry}
              {entryNote}
            </Box>,
          )}
          {panel(
            'p-grimoire',
            `grimoire · ${shown.length}`,
            'subtle',
            <Box flexDirection="column">
              {chips}
              {grid}
              {!userCards && (
                <Text dimColor wrap="wrap">
                  {emptyHint('cards')}
                </Text>
              )}
            </Box>,
            0,
          )}
          {panel(
            'p-agents',
            live.length ? `agents · ${running} running` : 'agents',
            running ? 'warning' : 'subtle',
            <Box flexDirection="column">
              {action}
              {liveGrid || (
                <Text dimColor wrap="wrap">
                  {emptyHint('agents')}
                </Text>
              )}
            </Box>,
            live.length ? 0 : 1,
          )}
          {panel(
            'p-recent',
            'recent',
            'subtle',
            past.length ? (
              <Box flexDirection="column">
                {recentRows && recentRows.slice(0, fit.recent)}
                {recentCut > 0 && <Text dimColor>{`${recentCut} more (pane too short)`}</Text>}
              </Box>
            ) : (
              <Text dimColor wrap="wrap">
                {emptyHint('recent', switches.log.runs)}
              </Text>
            ),
          )}
        </Box>
      )
    } else if (view === 'flow') {
      const children = new Map<string, TrackedAgent[]>()
      const known = new Set(list.map(a => a.id))
      for (const a of list) {
        const parent = a.parentId && known.has(a.parentId) ? a.parentId : 'main'
        children.set(parent, [...(children.get(parent) ?? []), a])
      }
      const lines: { prefix: string; a: TrackedAgent }[] = []
      const walk = (parent: string, indent: string) => {
        const kids = children.get(parent) ?? []
        kids.forEach((a, i) => {
          const last = i === kids.length - 1
          lines.push({ prefix: `${indent}${last ? '└─▶ ' : '├─▶ '}`, a })
          walk(a.id, `${indent}${last ? '    ' : '│   '}`)
        })
      }
      walk('main', '')
      const win = windowOf(lines, lines.map(l => l.a.id))
      body = (
        <Box flexDirection="column">
          {inline ? (
            <Text color="claude">◆ main session</Text>
          ) : (
            <Box flexDirection="column">
              <Text color="claude">┌──────────────┐</Text>
              <Text color="claude">│ main session │</Text>
              <Text color="claude">└┬─────────────┘</Text>
            </Box>
          )}
          {lines.length === 0 && <Text dimColor>└─ no subagents yet</Text>}
          {more(win.above, '↑')}
          {win.rows.flatMap(({ prefix, a }) => [
            <Button key={`row-${a.id}`} plain onPress={() => toggle(a.id)}>
              <Text dimColor>{prefix}</Text>
              <Text color={COLOR[a.status] ?? 'text'}>
                {GLYPH[a.status] ?? '?'} {cell(a.description, Math.max(12, width - prefix.length - 28))}
              </Text>
              <Text dimColor>
                {' '}
                {cell(a.status, 9)} {cell(age(a), 7)} {tokens(a.id)}
              </Text>
            </Button>,
            ...(pick === a.id ? [detail(a)] : []),
          ])}
          {more(win.below, '↓')}
        </Box>
      )
      hint = 'Tab/↑↓ move · Enter details · Tab up to the tabs, Enter on Deck to go back'
    } else if (view === 'table') {
      const descWidth = Math.max(12, width - 40)
      const win = windowOf(list, list.map(a => a.id))
      body = (
        <Box flexDirection="column">
          <Text bold>
            {cell('agent', descWidth)} {cell('type', 14)} {cell('status', 9)} {cell('time', 7)} tok
          </Text>
          {list.length === 0 && <Text dimColor>No subagents in this session yet.</Text>}
          {more(win.above, '↑')}
          {win.rows.flatMap(a => [
            <Button key={`row-${a.id}`} plain onPress={() => toggle(a.id)}>
              <Text>{cell(a.description, descWidth)} </Text>
              <Text dimColor>{cell(a.type, 14)} </Text>
              <Text color={COLOR[a.status] ?? 'text'}>{cell(a.status, 9)} </Text>
              <Text>{cell(age(a), 7)} </Text>
              <Text>{tokens(a.id)}</Text>
            </Button>,
            ...(pick === a.id ? [detail(a)] : []),
          ])}
          {more(win.below, '↓')}
        </Box>
      )
      hint = 'Tab/↑↓ move · Enter details · Tab up to the tabs, Enter on Deck to go back'
    } else if (view === 'keys') {
      const keyWidth = Math.max(...KEY_GROUPS.flatMap(g => g.rows.map(r => r[0].length))) + 1
      body = (
        <Box flexDirection="column">
          {!inline && switches.grim.enabled ? (
            <Box key="keys-grim" flexDirection="row" columnGap={1} alignItems="center">
              <Box flexDirection="column" width={12}>
                {sprite(GRIM.idle, 'keys-grim', GRIM_PAL)}
              </Box>
              <Box flexDirection="column">
                <Text bold>Boo. I am Grim.</Text>
                <Text dimColor>Every key, grouped below.</Text>
              </Box>
            </Box>
          ) : null}
          {KEY_GROUPS.map(g =>
            panel(
              `keys-${g.title}`,
              g.title,
              'subtle',
              <Box flexDirection="column">
                {g.rows.map(([k, what]) => (
                  <Text key={`${g.title}-${k}`} wrap="truncate-end">
                    <Text color="claude" bold>
                      {k.padEnd(keyWidth)}
                    </Text>
                    <Text dimColor>{what}</Text>
                  </Text>
                ))}
              </Box>,
            ),
          )}
          {panel(
            'keys-settings',
            setReport.problems.length ? `settings · ${setReport.problems.length} problems` : 'settings',
            setReport.problems.length ? 'warning' : 'subtle',
            <Box flexDirection="column">
              {setReport.problems.map((pr, i) => (
                <Text key={`set-problem-${i}`} color="warning" wrap="wrap">
                  {problemLine(pr)}
                </Text>
              ))}
              {setReport.files.length ? (
                setReport.files.map(f => (
                  <Text key={`set-file-${f}`} dimColor wrap="truncate-end">
                    read {f}
                  </Text>
                ))
              ) : (
                <Text dimColor wrap="wrap">
                  no settings file: all defaults (~/.claude/grimling/settings.json)
                </Text>
              )}
            </Box>,
          )}
        </Box>
      )
      hint = 'Every command · d back to the deck · Esc to the prompt'
    } else if (view === 'setup') {
      if (!sd) {
        body = <Text dimColor>No setup in progress: /grimling-setup ask starts one.</Text>
        hint = 'd back to the deck'
      } else {
        const picked = { ...currentAnswers(sd.base), ...sd.answers }
        const local = zoneOf({ zone: 'system', clock: '24h', showUtc: false })
        const plan = planWrite(sd.base, sd.answers)
        const choose = (key: string, value: string | boolean) =>
          void update($, setup, cur => (cur ? { ...cur, answers: { ...cur.answers, [key]: value } } : cur))
        body = panel(
          'p-setup',
          'setup',
          'claude',
          <Box flexDirection="column">
            {questions(local, String(picked['time.zone'] ?? 'system')).map((q, qi) => (
              <Box key={`setup-q-${qi}`} flexDirection="row" columnGap={1} flexWrap="wrap">
                <Text dimColor>{q.label}:</Text>
                {q.options.map((o, oi) => {
                  const key = `setup-${qi}-${oi}`
                  const isOn = picked[q.key] === o.value
                  return (
                    <Button key={key} plain onPress={() => choose(q.key, o.value)}>
                      <Text inverse={isOn} color={lit(key) ? 'claude' : isOn ? undefined : 'subtle'} underline={lit(key)}>
                        {o.label}
                      </Text>
                    </Button>
                  )
                })}
              </Box>
            ))}
            {!plan.ok ? (
              <Text color="warning" wrap="wrap">
                {plan.message}
              </Text>
            ) : plan.changes.length ? (
              <Box flexDirection="column">
                <Text bold wrap="wrap">
                  Write saves exactly this to {USER_FILE}:
                </Text>
                {plan.text
                  .trimEnd()
                  .split('\n')
                  .map((l, i) => (
                    <Text key={`setup-json-${i}`} wrap="wrap">
                      {l || ' '}
                    </Text>
                  ))}
                <Text dimColor wrap="wrap">
                  changes: {plan.changes.map(c => `${c.key} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join(', ')}
                </Text>
              </Box>
            ) : (
              <Text dimColor wrap="wrap">
                Nothing to change yet: pick a value above.{sd.base === null ? ' No settings file: all defaults.' : ''}
              </Text>
            )}
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Button key="setup-write" plain onPress={() => void writeSetup($).catch(onFail($, 'setup.error'))}>
                <Text color="claude" bold inverse={lit('setup-write')}>
                  [Enter] Write
                </Text>
              </Button>
              <Button key="setup-cancel" hotkey={keyed('x')} plain onPress={() => void cancelSetup($)}>
                <Text dimColor inverse={lit('setup-cancel')}>
                  [x] Cancel
                </Text>
              </Button>
            </Box>
            <Text dimColor wrap="wrap">
              Only your settings file is written; other keys stay. A project file is never touched.
            </Text>
          </Box>,
        )
        hint =
          focused === 'setup-write' ? 'Enter writes the previewed JSON · x cancel' : 'Enter picks a value · Tab moves · Write saves · x cancel'
      }
    } else if (view === 'feedback') {
      if (!fb) {
        body = <Text dimColor>No feedback in progress: /grimling-feedback starts one.</Text>
        hint = 'd back to the deck'
      } else {
        const out = buildFeedback({
          kind: fb.kind,
          message: fb.message,
          diagnostics: fb.diagnostics,
          repo: switches.feedback.repo,
          home: await homeDir($),
        })
        const Link = 'Link' in ui ? ui.Link : undefined
        body = panel(
          'p-feedback',
          `feedback · ${out.where}`,
          'claude',
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              {KINDS.map(k => (
                <Button
                  key={`fb-kind-${k.kind}`}
                  plain
                  onPress={() => void update($, feedback, cur => (cur ? { ...cur, kind: k.kind } : cur))}
                >
                  <Text
                    inverse={fb.kind === k.kind}
                    color={lit(`fb-kind-${k.kind}`) ? 'claude' : fb.kind === k.kind ? undefined : 'subtle'}
                    underline={lit(`fb-kind-${k.kind}`)}
                  >
                    {k.label}
                  </Text>
                </Button>
              ))}
            </Box>
            {Input ? (
              <Input
                key={FEEDBACK_INPUT}
                label="message ›"
                placeholder="what happened, or your idea"
                value={fb.message}
                onInput={(value: string) => void update($, feedback, cur => (cur ? { ...cur, message: value } : cur))}
                onSubmit={(value: string) => void update($, feedback, cur => (cur ? { ...cur, message: value } : cur))}
              />
            ) : null}
            <Text bold wrap="wrap">
              What is sent, to github.com/{switches.feedback.repo}:
            </Text>
            <Text key="fb-title" wrap="wrap">
              <Text dimColor>title: </Text>
              {out.title}
            </Text>
            {out.fields.map(f => (
              <Box key={`fb-field-${f.label}`} flexDirection="column">
                <Text dimColor>{f.label}:</Text>
                {f.text.split('\n').map((l, i) => (
                  <Text key={`fb-${f.label}-${i}`} wrap="wrap">
                    {l || ' '}
                  </Text>
                ))}
              </Box>
            ))}
            {out.isTooLong && (
              <Text color="warning" wrap="wrap">
                Too long for a link: Send copies the text and opens the empty form; paste it in.
              </Text>
            )}
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Button key="fb-send" plain onPress={press => void sendFeedback($, press.surface).catch(onFail($, 'feedback.error'))}>
                <Text color="claude" bold inverse={lit('fb-send')}>
                  [Enter] Send
                </Text>
              </Button>
              <Button key="fb-edit" hotkey={keyed('e')} plain onPress={() => void focusOn($, FEEDBACK_INPUT)}>
                <Text dimColor inverse={lit('fb-edit')}>
                  [e] Edit
                </Text>
              </Button>
              <Button key="fb-cancel" hotkey={keyed('x')} plain onPress={() => void cancelFeedback($)}>
                <Text dimColor inverse={lit('fb-cancel')}>
                  [x] Cancel
                </Text>
              </Button>
            </Box>
            {Link && !out.isTooLong && <Link href={out.url} label="or open the form yourself" />}
            <Text dimColor wrap="wrap">
              The mod sends nothing: Send opens GitHub in your browser and you press Submit there.
            </Text>
          </Box>,
        )
        hint =
          focused === FEEDBACK_INPUT
            ? 'Type the message, Enter keeps it · Tab to Send'
            : 'Enter on Send opens GitHub · e edit · x cancel · kind chips above'
      }
    } else if (view === 'arena') {
      const pool = (dex.length ? dex : BUILTINS.map((d, i) => ({ ...d, no: i + 1 }))).filter(d => d.type)
      const turn = (id: string, by: number) => {
        const i = Math.max(0, pool.findIndex(d => d.id === id))
        return pool[(i + by + pool.length) % pool.length]?.id ?? id
      }
      const redD = pool.find(d => d.id === pickA.red) ?? pool[0]
      const blueD = pool.find(d => d.id === pickA.blue) ?? pool[1] ?? pool[0]
      const ch = quiz[((pickA.challenge % quiz.length) + quiz.length) % quiz.length]
      const model = switches.arena.model
      const busy = !!fightOn && !fightOn.winner
      const rec = (id: string) => {
        const r = ladder[id]
        return r ? `${r.wins}-${r.losses}${r.draws ? `-${r.draws}` : ''} · ${r.rating}` : 'new'
      }
      const stepper = (key: string, label: string, onPress: () => void) => (
        <Button key={key} plain onPress={onPress}>
          <Text color={lit(key) ? 'claude' : 'subtle'} inverse={lit(key)}>
            {label}
          </Text>
        </Button>
      )
      const pickRow = (side: 'red' | 'blue', d: DexEntry | undefined) => (
        <Box key={`pick-${side}`} flexDirection="row" columnGap={1}>
          <Text bold color={side === 'red' ? 'error' : 'suggestion'}>
            {side === 'red' ? 'Red ' : 'Blue'}
          </Text>
          {stepper(`arena-${side}-prev`, '‹', () => void update($, arenaPick, cur => ({ ...cur, [side]: turn(d?.id ?? '', -1) })))}
          <Text bold>{cell(d?.name ?? '-', 12)}</Text>
          {stepper(`arena-${side}-next`, '›', () => void update($, arenaPick, cur => ({ ...cur, [side]: turn(d?.id ?? '', 1) })))}
          <Text dimColor>{d ? rec(d.id) : ''}</Text>
        </Box>
      )
      const fight = async () => {
        if (!redD || !blueD || !ch) return
        if (busy) {
          void $.ui.toast('A battle is already running')
          return
        }
        const prompt = arenaPrompt(ch)
        const go = (d: DexEntry, side: 'red' | 'blue') =>
          $.agent.spawn({
            prompt,
            description: `Arena ${arenaTag({ startedAt: now }, side)}: ${ch.title}`,
            subagentType: d.type,
            model,
          })
        debug($, 'arena.fight', { red: redD.id, blue: blueD.id, task: ch.id })
        let r: Awaited<ReturnType<typeof go>>
        let b: Awaited<ReturnType<typeof go>>
        try {
          ;[r, b] = await Promise.all([go(redD, 'red'), go(blueD, 'blue')])
        } catch (err) {
          debug($, 'arena.error', String(err))
          void $.ui.toast(`Arena failed to start: ${String(err)}`)
          return
        }
        debug($, 'arena.spawned', { red: r, blue: b })
        if (r.deny || b.deny) {
          void $.ui.toast(`Arena not started: ${r.deny ?? b.deny}`)
          return
        }
        await update($, battle, () => ({
          challenge: ch.id,
          red: { card: redD.id, agentId: r.agentId },
          blue: { card: blueD.id, agentId: b.agentId },
          startedAt: now,
          model,
        }))
      }
      // A fighter: sprite, name, health from the result (full until scored),
      // and what it answered. The health bars move only once there are scores.
      const fighter = (key: 'red' | 'blue', d: DexEntry | undefined, s: ArenaSide | undefined) => {
        const w = fightOn?.winner
        const hp = !w ? 10 : w === key ? 10 : w === 'draw' ? 8 : s?.correct ? 6 : 2
        const status = !s
          ? 'ready'
          : s.answer === undefined
            ? 'thinking...'
            : `${s.correct ? '✓' : '✕'} ${cell(extractAnswer(s.answer), 7).trimEnd()} ${((s.durationMs ?? 0) / 1000).toFixed(1)}s`
        return (
          <Box key={`fighter-${key}`} width={20}>
            {panel(
              `arena-${key}`,
              key,
              w === key ? 'success' : key === 'red' ? 'error' : 'suggestion',
              <Box flexDirection="column" alignItems="center">
                {sprite(artOf(d, d?.type ?? key), `ar-${key}`)}
                <Text bold>{cell(d?.short ?? d?.name ?? '-', 10).trimEnd()}</Text>
                <Text color={hp > 5 ? 'success' : hp > 2 ? 'warning' : 'error'}>
                  {'█'.repeat(hp)}
                  {'░'.repeat(10 - hp)}
                </Text>
                <Text dimColor>{status}</Text>
              </Box>,
              0,
            )}
          </Box>
        )
      }
      const shownBattle = fightOn && quiz.find(c => c.id === fightOn.challenge)
      const fRed = fightOn ? pool.find(d => d.id === fightOn.red.card) : redD
      const fBlue = fightOn ? pool.find(d => d.id === fightOn.blue.card) : blueD
      // A scored fight copies as a small text card (same copy as Mermaid).
      const share = (surface: typeof e.surface) => {
        if (!fightOn?.winner || !shownBattle) return
        const names = { red: fRed?.name ?? fightOn.red.card, blue: fBlue?.name ?? fightOn.blue.card }
        const text = shareCard(fightOn, names, shownBattle.title, fightOn.model ?? model, ladder)
        debug($, 'arena.share', { winner: fightOn.winner })
        void $.ui.copy({ text, surface })
        void $.ui.toast('Arena result copied')
      }
      body = panel(
        'p-arena',
        `arena · ${fightOn?.model ?? model}`,
        busy ? 'warning' : 'subtle',
        <Box flexDirection="column">
          {pickRow('red', redD)}
          {pickRow('blue', blueD)}
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>Task</Text>
            {stepper('arena-ch-prev', '‹', () => void update($, arenaPick, cur => ({ ...cur, challenge: cur.challenge - 1 })))}
            <Text bold>{cell(ch?.title ?? '-', 16)}</Text>
            {stepper('arena-ch-next', '›', () => void update($, arenaPick, cur => ({ ...cur, challenge: cur.challenge + 1 })))}
          </Box>
          <Box flexDirection="row" columnGap={2}>
            <Button key="arena-fight" plain onPress={() => void fight()}>
              <Text bold inverse={lit('arena-fight')} color={busy ? 'subtle' : 'claude'}>
                {busy ? ' fighting... ' : ' FIGHT '}
              </Text>
            </Button>
            {fightOn && (
              // Clears the result, or releases a battle whose fighter never
              // answered; the agents themselves end once they answer.
              <Button
                key="arena-clear"
                plain
                onPress={() => {
                  debug($, 'arena.clear', { winner: fightOn.winner ?? 'unfinished' })
                  void update($, battle, () => null)
                }}
              >
                <Text inverse={lit('arena-clear')} color="subtle">
                  {' CLEAR '}
                </Text>
              </Button>
            )}
            {fightOn?.winner && (
              <Button key="arena-share" hotkey={keyed('s')} plain onPress={press => share(press.surface)}>
                <Text inverse={lit('arena-share')} color="claude">
                  {' SHARE '}
                </Text>
              </Button>
            )}
          </Box>
          <Box flexDirection="row" columnGap={1}>
            {fighter('red', fRed, fightOn?.red)}
            {fighter('blue', fBlue, fightOn?.blue)}
          </Box>
          {shownBattle && (
            <Text dimColor wrap="truncate-end">
              {fightOn?.winner
                ? `${fightOn.winner === 'draw' ? 'Draw' : `${fightOn.winner === 'red' ? fRed?.name : fBlue?.name} wins`} · ${shownBattle.title} (key ${shownBattle.answer})`
                : `${shownBattle.title}: both fighters are working`}
            </Text>
          )}
        </Box>,
      )
      hint = busy
        ? 'Battle on: answers are scored against the key as they land'
        : fightOn?.winner
          ? 's (or SHARE) copies the result card · FIGHT again · CLEAR resets'
          : `Tab to ‹ › to pick fighters and a task · Enter on FIGHT (${model})`
    } else if (!p) {
      body = <Text dimColor>No pod status file (pods.files in settings.json). No pod is being watched.</Text>
      hint = 'Tab to Deck and Enter to go back'
    } else {
      const { age, stale } = podAge(p, now)
      const phaseColor = p.phase === 'FAILED' ? 'error' : p.phase === 'DONE' ? 'success' : 'warning'
      body = (
        <Box flexDirection="column">
          <Text>
            <Text bold>pod {p.pod}</Text> <Text color={phaseColor}>{p.phase}</Text>{' '}
            <Text color={p.reachable ? 'success' : 'error'}>{p.reachable ? 'reachable' : 'unreachable'}</Text>
            <Text dimColor> · {since(0, age * 1000)} ago</Text>
          </Text>
          {stale && p.phase !== 'DONE' && (
            <Text bold color="error">
              STALE: the watcher has not written for {since(0, age * 1000)}. This is the last known state; check the pod.
            </Text>
          )}
          <Text>
            {bar(p.pct / 100, 20)} {percent(p.pct)} · GPU {percent(p.gpu)} · ${p.cost.toFixed(2)} · kill-by{' '}
            <Text bold color="warning">
              {killBy(p.deadline, now, switches.time)}
            </Text>
          </Text>
          {p.runs.slice(0, inline ? room - 2 : p.runs.length).map(([name, progress, state]) => (
            <Text key={`run-${name}`}>
              {cell(name, 10)}{' '}
              <Text color={state === 'fail' ? 'error' : state === 'done' ? 'success' : 'subtle'}>
                {bar(progress, 12)} {state}
              </Text>
            </Text>
          ))}
        </Box>
      )
      hint = 'Tab to Deck and Enter to go back'
    }

    return (
      <Box flexDirection="column">
        {inline ? header : panel('p-tabs', 'grimling', e.props.isFocused ? 'claude' : 'subtle', header)}
        {meterBlock}
        {grimBlock}
        {body}
        {footer(hint)}
      </Box>
    )
    } catch (err) {
      debug($, 'render.error', String(err instanceof Error ? (err.stack ?? err.message) : err))
      const { Text } = $.ui.resolve(e)
      return <Text color="error">Grimling hit an error drawing the pane: {String(err)} (see ~/.claude/grimling/debug.log)</Text>
    }
  })
}
