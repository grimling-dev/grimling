import type { ArenaBattle, ArenaPuzzle, ArenaRecord } from '../types'
import { printable } from './printable'

// Arena lite: two cards answer the same question with a known answer, on the
// same cheap model; the key decides, then time, then tokens. No judge model.

export type Challenge = ArenaPuzzle

export const CHALLENGES: Challenge[] = [
  {
    id: 'bat-ball',
    title: 'Bat and ball',
    question: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost, in cents?',
    answer: '5',
  },
  { id: 'strawberry', title: "Strawberry r's", question: "How many times does the letter r appear in the word 'strawberry'?", answer: '3' },
  { id: 'sheep', title: 'All but nine', question: 'A farmer has 17 sheep. All but 9 run away. How many sheep are left?', answer: '9' },
  {
    id: 'widgets',
    title: 'Five machines',
    question: 'If 5 machines take 5 minutes to make 5 widgets, how many minutes would 100 machines take to make 100 widgets?',
    answer: '5',
  },
  {
    id: 'lily-pads',
    title: 'Lily pads',
    question:
      'A patch of lily pads doubles in size every day. It takes 48 days to cover the whole lake. How many days does it take to cover half of the lake?',
    answer: '47',
  },
]

export const START_RATING = 1500

// A puzzles file (arena.puzzlesFile): a JSON list of
// `{ id, title, question, answer, accept? }`. A bad entry is skipped with a
// problem; an id that is already built in replaces that puzzle.
export function parsePuzzles(raw: unknown): { puzzles: Challenge[]; problems: string[] } {
  const list = Array.isArray(raw) ? raw : null
  if (!list) return { puzzles: [], problems: ['must be a JSON list of puzzles'] }
  const puzzles: Challenge[] = []
  const problems: string[] = []
  const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  for (const [i, p] of list.slice(0, 200).entries()) {
    const at = `puzzle ${i + 1}`
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      problems.push(`${at}: must be { id, title, question, answer } (skipped)`)
      continue
    }
    const o = p as Record<string, unknown>
    const bad = !(typeof o.id === 'string' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(o.id))
      ? '"id" must be lower-case letters, digits and dashes'
      : !str(o.title, 60)
        ? '"title" must be text of at most 60 characters'
        : !str(o.question, 2000)
          ? '"question" must be text of at most 2000 characters'
          : !str(o.answer, 200)
            ? '"answer" must be text of at most 200 characters'
            : o.accept !== undefined && !(Array.isArray(o.accept) && o.accept.length <= 20 && o.accept.every(a => str(a, 200)))
              ? '"accept" must be a list of at most 20 answers'
              : null
    if (bad) {
      problems.push(`${at}: ${bad} (skipped)`)
      continue
    }
    if (puzzles.some(x => x.id === o.id)) {
      problems.push(`${at}: id "${String(o.id)}" comes twice (skipped)`)
      continue
    }
    puzzles.push({
      id: String(o.id),
      title: printable(String(o.title)),
      question: printable(String(o.question)),
      answer: printable(String(o.answer)),
      ...(Array.isArray(o.accept) ? { accept: o.accept.map(a => printable(String(a))) } : {}),
    })
  }
  if (list.length > 200) problems.push(`only the first 200 of ${list.length} puzzles are used`)
  return { puzzles, problems }
}

// The built-in puzzles with a file's laid over them: same id replaces in its
// place, new ones follow.
export function withPuzzles(extra: Challenge[]): Challenge[] {
  const byId = new Map(extra.map(p => [p.id, p]))
  return [...CHALLENGES.map(c => byId.get(c.id) ?? c), ...extra.filter(p => !CHALLENGES.some(c => c.id === p.id))]
}

export function arenaPrompt(c: Challenge): string {
  return `${c.question}\n\nWork it out, then end with one line of the form "ANSWER: <answer>" and nothing after it. Do not use any tools.`
}

// The text after the last "ANSWER:", else the last non-empty line.
export function extractAnswer(text: string): string {
  const tagged = [...text.matchAll(/ANSWER:\s*(.+)/gi)].pop()?.[1]
  const line = tagged ?? text.split('\n').map(l => l.trim()).filter(Boolean).pop() ?? ''
  return line.trim()
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.]/g, '')
}

export function isCorrect(c: Challenge, text: string): boolean {
  const got = norm(extractAnswer(text))
  return [c.answer, ...(c.accept ?? [])].some(a => {
    const want = norm(a)
    return got === want || got === `${want}cents` || got === `${want}days` || got === `${want}minutes`
  })
}

// The key first, then the faster answer, then fewer tokens.
export function decide(b: ArenaBattle): 'red' | 'blue' | 'draw' {
  const { red, blue } = b
  if (red.correct !== blue.correct) return red.correct ? 'red' : 'blue'
  const dt = (red.durationMs ?? 0) - (blue.durationMs ?? 0)
  if (Math.abs(dt) > 250) return dt < 0 ? 'red' : 'blue'
  const dk = (red.tokens ?? 0) - (blue.tokens ?? 0)
  if (dk !== 0) return dk < 0 ? 'red' : 'blue'
  return 'draw'
}

// Plain Elo, K = 32: enough for a local ladder; Glicko-2 comes with ELO P4.
export function rate(
  records: Record<string, ArenaRecord>,
  red: string,
  blue: string,
  winner: 'red' | 'blue' | 'draw',
): Record<string, ArenaRecord> {
  const blank: ArenaRecord = { wins: 0, losses: 0, draws: 0, rating: START_RATING }
  const a = records[red] ?? blank
  const b = records[blue] ?? blank
  const expectA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400))
  const scoreA = winner === 'red' ? 1 : winner === 'draw' ? 0.5 : 0
  const delta = Math.round(32 * (scoreA - expectA))
  return {
    ...records,
    [red]: {
      wins: a.wins + (winner === 'red' ? 1 : 0),
      losses: a.losses + (winner === 'blue' ? 1 : 0),
      draws: a.draws + (winner === 'draw' ? 1 : 0),
      rating: a.rating + delta,
    },
    [blue]: {
      wins: b.wins + (winner === 'blue' ? 1 : 0),
      losses: b.losses + (winner === 'red' ? 1 : 0),
      draws: b.draws + (winner === 'draw' ? 1 : 0),
      rating: b.rating - delta,
    },
  }
}

// Why `decide` picked its winner: the key, the clock, tokens, or all tied.
export type Reason = 'answer' | 'speed' | 'tokens' | 'tie'
export function why(b: ArenaBattle): Reason {
  const { red, blue } = b
  if (red.correct !== blue.correct) return 'answer'
  if (Math.abs((red.durationMs ?? 0) - (blue.durationMs ?? 0)) > 250) return 'speed'
  if ((red.tokens ?? 0) !== (blue.tokens ?? 0)) return 'tokens'
  return 'tie'
}

const REASON_LABEL: Record<Reason, string> = {
  answer: 'right answer',
  speed: 'speed',
  tokens: 'fewer tokens',
  tie: 'all tied',
}

// Inside width of the share card: with its borders and padding it is 37
// columns, under the docked pane's ~44.
export const CARD_INNER = 33

// A scored battle as a small box-drawn text card for the clipboard: the task
// and model, each fighter's mark, time and tokens, the winner and why, and
// the winner's record after the fight (both records on a draw).
export function shareCard(
  b: ArenaBattle,
  names: { red: string; blue: string },
  title: string,
  model: string,
  records: Record<string, ArenaRecord>,
): string {
  const fit = (s: string) => (s.length > CARD_INNER ? `${s.slice(0, CARD_INNER - 1)}…` : s.padEnd(CARD_INNER))
  const tok = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`)
  const name = (s: string) => (s.length > 9 ? `${s.slice(0, 8)}…` : s.padEnd(9))
  const side = (label: string, n: string, s: ArenaBattle['red']) =>
    `${label}${name(n)}${s.correct ? '✓' : '✕'} ${((s.durationMs ?? 0) / 1000).toFixed(2)} s${s.tokens ? `  ${tok(s.tokens)} tok` : ''}`
  const rec = (card: string, n: string) => {
    const r = records[card]
    return r ? `${n} ${r.wins}-${r.losses}-${r.draws} · ${r.rating}` : `${n} unrated`
  }
  const w = b.winner ?? decide(b)
  const reason = REASON_LABEL[why(b)]
  const lines = [
    `${title} · ${model}`,
    side('Red  ', names.red, b.red),
    side('Blue ', names.blue, b.blue),
    w === 'draw' ? `Draw (${reason})` : `Winner: ${names[w]} (${reason})`,
    ...(w === 'draw'
      ? [rec(b.red.card, names.red), rec(b.blue.card, names.blue)]
      : [rec(b[w].card, names[w])]),
  ]
  const head = '┌ GRIMLING ARENA '
  return [
    `${head}${'─'.repeat(CARD_INNER + 2 - head.length + 1)}┐`,
    ...lines.map(l => `│ ${fit(l)} │`),
    `└${'─'.repeat(CARD_INNER + 2)}┘`,
  ].join('\n')
}
