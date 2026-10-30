import type { DexEntry, SettingProblem } from '../types'

// The Grimoire's card sources, pure like settings.ts: dex.json entries
// checked, prompt templates read and filled, a card found by agent type.

// Pixel art: 8x8 sprites, one letter a pixel ('.' is empty).
export const PALETTE: Record<string, string> = {
  k: '#3a3a3a', w: '#f5f5f5', t: '#2ec4b6', y: '#ffd23f', o: '#ff8c42', p: '#9b5de5',
  s: '#f1c27d', b: '#b5651d', r: '#ff5d73', g: '#43aa8b', c: '#4cc9f0', e: '#8d99ae',
}

// One dex.json entry: what a card shows instead of what its file says.
export type Meta = { name?: string; short?: string; cat?: string; what?: string; art?: string[] }

// A template card before it is numbered and given its source.
export type TemplateCard = Omit<DexEntry, 'no' | 'source'>

// The mod's own swarm template, used when templates/swarm.md cannot be
// read. Keep it the same as that file.
export const SWARM_TEMPLATE = [
  '---',
  'id: swarm',
  'name: Swarm',
  'cat: swarm',
  'what: workflow research swarm',
  '---',
  'Use a workflow: research swarm on: {task}. Fan out parallel agents on separate angles, verify the findings, ' +
    'and reply with one report with a source for each claim.',
].join('\n')

export const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]*$/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function titleCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map(w => (w ? w[0]?.toUpperCase() + w.slice(1) : ''))
    .join(' ')
}

// A markdown file's frontmatter and body. Top-level `key: value` pairs;
// indented lines continue the key above them, folded with spaces (`>` or
// plain) or kept as lines (`|`).
export function splitDoc(text: string): { fm: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[^\n]*(\n|$)/.exec(text)
  const fm: Record<string, string> = {}
  let last = ''
  let literal = false
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (kv?.[1]) {
      last = kv[1]
      const value = (kv[2] ?? '').trim()
      literal = value.startsWith('|')
      fm[last] = /^[>|][+-]?$/.test(value) ? '' : value.replace(/^["']|["']$/g, '')
    } else if (last && /^\s+\S/.test(line)) {
      const prior = fm[last] ?? ''
      fm[last] = prior ? `${prior}${literal ? '\n' : ' '}${line.trim()}` : line.trim()
    }
  }
  return { fm, body: (m ? text.slice(m[0].length) : text).trim() }
}

// An 8x8 sprite: 8 rows of 8 letters from PALETTE or '.'.
export function artProblem(v: unknown): string | null {
  const ok =
    Array.isArray(v) &&
    v.length === 8 &&
    v.every(row => typeof row === 'string' && row.length === 8 && [...row].every(c => c === '.' || c in PALETTE))
  return ok ? null : `art must be 8 rows of 8 pixels, each one of .${Object.keys(PALETTE).join('')}`
}

// One dex.json, checked: a bad field is dropped with a problem (bad art:
// the card draws a generated creature). `short` fits 6 columns, `what` 40.
export function readMeta(raw: unknown, file: string): { meta: Record<string, Meta>; problems: SettingProblem[] } {
  const meta: Record<string, Meta> = {}
  const problems: SettingProblem[] = []
  if (!isObj(raw)) return { meta, problems: [{ path: file, message: 'must be a JSON object (ignored)' }] }
  for (const [key, v] of Object.entries(raw)) {
    if (!isObj(v)) {
      problems.push({ path: `${file} ${key}`, message: 'must be an object (ignored)' })
      continue
    }
    const m: Meta = {}
    for (const [field, max] of [['name', 40], ['short', 6], ['cat', 20], ['what', 40]] as const) {
      const x = v[field]
      if (x === undefined) continue
      if (typeof x === 'string' && x && x.length <= max) m[field] = x
      else problems.push({ path: `${file} ${key}.${field}`, message: `must be text of at most ${max} characters (ignored)` })
    }
    if (v.art !== undefined) {
      const bad = artProblem(v.art)
      if (bad) problems.push({ path: `${file} ${key}.art`, message: `${bad} (drawing a generated creature)` })
      else m.art = v.art as string[]
    }
    meta[key] = m
  }
  return { meta, problems }
}

// A template's `art:` line: a JSON list, or the 8 rows split by spaces or commas.
function artField(s: string): unknown {
  if (s.trim().startsWith('[')) {
    try {
      return JSON.parse(s) as unknown
    } catch {
      return s
    }
  }
  return s.split(/[\s,]+/).filter(Boolean)
}

// A prompt template: frontmatter (id, name, short, cat, what, art) and a
// body using {task}, {cwd} and {date}. The file is `<id>.md`; a frontmatter
// id that differs is a problem. Bad optional fields are dropped.
export function parseTemplate(text: string, id: string, file: string): { card?: TemplateCard; problems: SettingProblem[] } {
  const problems: SettingProblem[] = []
  const { fm, body } = splitDoc(text)
  if (fm.id && fm.id !== id) return { problems: [{ path: file, message: `id "${fm.id}" does not match the file name (skipped)` }] }
  if (!body) return { problems: [{ path: file, message: 'has no text after the frontmatter (skipped)' }] }
  const meta = readMeta({ [id]: { ...fm, id: undefined, art: fm.art === undefined ? undefined : artField(fm.art) } }, file)
  problems.push(...meta.problems.map(p => ({ ...p, path: file })))
  const m = meta.meta[id] ?? {}
  return {
    card: {
      id,
      name: m.name ?? titleCase(id),
      short: m.short,
      fill: id,
      what: m.what ?? 'prompt template',
      cat: m.cat ?? 'swarm',
      art: m.art,
      text: body,
    },
    problems,
  }
}

// A template's text for the prompt: {task}, {cwd} and {date} filled in; a
// body with no {task} gets the task after it.
export function fillTemplate(text: string, vars: { task: string; cwd: string; date: string }): string {
  const out = text.replace(/\{(task|cwd|date)\}/g, (_, k: 'task' | 'cwd' | 'date') => vars[k])
  return text.includes('{task}') ? out : `${out}\n\n${vars.task}`
}

// `mypack:research-scout` → `research-scout`.
export function baseOf(type: string): string {
  return type.slice(type.lastIndexOf(':') + 1)
}

// The card for an agent type: the exact type, else (a type that moved to
// another pack) the one loaded card with the same base name.
export function cardForType<T extends { type?: string }>(entries: T[], type: string): T | undefined {
  const exact = entries.find(d => d.type === type)
  if (exact) return exact
  const base = baseOf(type)
  const same = entries.filter(d => d.type && baseOf(d.type) === base)
  return same.length === 1 ? same[0] : undefined
}

// cards.hide names card ids or agent types.
export function isHidden(d: { id: string; type?: string }, hide: string[]): boolean {
  return hide.includes(d.id) || (!!d.type && hide.includes(d.type))
}

// A sprite at half height (compact cards): each pair of pixel rows becomes
// one, a pixel taking the upper one's colour, or the lower one's where the
// upper is clear. Drawn in half blocks, 8x8 art fills two text rows.
export function halfHeight(px: string[]): string[] {
  const out: string[] = []
  for (let r = 0; r < px.length; r += 2) {
    const top = px[r] ?? ''
    const low = px[r + 1] ?? ''
    const w = Math.max(top.length, low.length)
    let row = ''
    for (let i = 0; i < w; i += 1) {
      const t = top[i] ?? '.'
      row += t !== '.' ? t : (low[i] ?? '.')
    }
    out.push(row)
  }
  return out
}

// A sprite's main colour (mini cards): its most used palette colour, outline
// black and white eyes counted only when nothing else is drawn.
export function mainColour(px: string[], pal: Record<string, string>): string | undefined {
  const count = new Map<string, number>()
  for (const ch of px.join('')) if (pal[ch]) count.set(ch, (count.get(ch) ?? 0) + 1)
  const ranked = [...count.entries()].sort((x, y) => y[1] - x[1]).map(([ch]) => ch)
  const ch = ranked.find(c => c !== 'k' && c !== 'w') ?? ranked[0]
  return ch ? pal[ch] : undefined
}
