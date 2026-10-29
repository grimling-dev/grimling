import { anyHomeless, homeless, redact } from './runlog'

// /grimling-feedback: what is sent and where. Pure functions; the mod makes
// no network call: Send opens a pre-filled GitHub form in the browser, and
// the person presses Submit there.
//
// Bugs go to the issue form .github/ISSUE_TEMPLATE/bug.yml (fields `what`
// and `diagnostics`, filled by query parameters of those ids); ideas and
// praise go to GitHub Discussions (Ideas, Show and tell).

export type FeedbackKind = 'bug' | 'idea' | 'praise'

export const KINDS: { kind: FeedbackKind; label: string }[] = [
  { kind: 'bug', label: 'Bug' },
  { kind: 'idea', label: 'Idea' },
  { kind: 'praise', label: 'Praise' },
]

// A link longer than this is not opened pre-filled (terminals and browsers
// cut long links; a Link's href may be 2048 characters once encoded): the
// text is copied instead and the empty form opened.
export const MAX_URL = 2000

// What the diagnostics may say: versions, OS family, pane width, card counts
// and the settings keys that had problems. Never a path, prompt, answer or
// any part of the run log.
export type DiagnosticsInput = {
  grimling: string
  claudeCode: string
  os: string
  paneWidth: number | null
  cards: Record<string, number>
  settingsProblems: string[]
}

export function diagnosticsText(d: DiagnosticsInput, home = ''): string {
  const cards = ['builtin', 'pack', 'user', 'project'].map(k => `${d.cards[k] ?? 0} ${k === 'builtin' ? 'built-in' : k}`).join(', ')
  // Only the dotted key names, never their values or file paths.
  const keys = d.settingsProblems
    .map(p => p.replace(/^.*\s(?=\S+$)/, ''))
    .filter(k => /^[A-Za-z$][\w.$]*$/.test(k))
    .slice(0, 10)
  const lines = [
    `Grimling: ${d.grimling}`,
    `Claude Code: ${d.claudeCode}`,
    `OS: ${d.os}`,
    `Pane width: ${d.paneWidth ?? 'not open'}`,
    `Cards: ${cards}`,
    `Settings problems: ${d.settingsProblems.length}${keys.length ? ` (${keys.join(', ')})` : ''}`,
  ]
  return scrub(lines.join('\n'), home)
}

// Everything that leaves goes through this: keys and tokens redacted, the
// home folder (and any other user folder) written as ~.
export function scrub(text: string, home = ''): string {
  return anyHomeless(homeless(redact(text, [], home), home))
}

export type Outgoing = {
  // Where it goes, for the preview: "issue form" or "discussion (Ideas)".
  where: string
  title: string
  // The fields exactly as sent, in order.
  fields: { label: string; text: string }[]
  url: string
  // The link was too long: `url` is the empty form, `copy` the text to paste.
  isTooLong: boolean
  copy: string
}

const enc = encodeURIComponent

export function titleOf(kind: FeedbackKind, message: string): string {
  const first = message.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const head = first.length > 70 ? `${first.slice(0, 69)}…` : first
  return head || (kind === 'bug' ? 'Bug report' : kind === 'idea' ? 'Idea' : 'Thanks')
}

// The pre-filled link for one piece of feedback.
export function buildFeedback(o: { kind: FeedbackKind; message: string; diagnostics: string; repo: string; home?: string }): Outgoing {
  const home = o.home ?? ''
  const message = scrub(o.message.trim(), home)
  const diagnostics = scrub(o.diagnostics, home)
  const title = titleOf(o.kind, message)
  const base = `https://github.com/${o.repo}`
  if (o.kind === 'bug') {
    const fields = [
      { label: 'What happened', text: message },
      { label: 'Diagnostics', text: diagnostics },
    ]
    const short = `${base}/issues/new?template=bug.yml&title=${enc(title)}`
    const url = `${short}&what=${enc(message)}&diagnostics=${enc(diagnostics)}`
    const copy = `What happened:\n${message}\n\nDiagnostics:\n${diagnostics}`
    return url.length > MAX_URL
      ? { where: 'issue form', title, fields, url: short, isTooLong: true, copy }
      : { where: 'issue form', title, fields, url, isTooLong: false, copy }
  }
  const category = o.kind === 'idea' ? 'ideas' : 'show-and-tell'
  const body = `${message}\n\n---\n${diagnostics}`
  const fields = [{ label: 'Body', text: body }]
  const short = `${base}/discussions/new?category=${category}&title=${enc(title)}`
  const url = `${short}&body=${enc(body)}`
  const where = o.kind === 'idea' ? 'discussion (Ideas)' : 'discussion (Show and tell)'
  return url.length > MAX_URL
    ? { where, title, fields, url: short, isTooLong: true, copy: body }
    : { where, title, fields, url, isTooLong: false, copy: body }
}

// The message `f` on a failed agent's Grim bubble starts with: the card, its
// type, how long it ran and the first line of its last output (scrubbed).
export function failurePrefill(v: { name: string; type: string; duration: string; output?: string }, home = ''): string {
  const line = (v.output ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  const error = line ? `\nError: ${scrub(line.slice(0, 300), home)}` : ''
  return `${v.name} (${v.type}) failed after ${v.duration}.${error}\n\nWhat I was doing: `
}

// The argv that opens a URL in the default browser, per OS family (no shell).
export function openerFor(os: string, url: string): string[] {
  if (os === 'windows') return ['rundll32', 'url.dll,FileProtocolHandler', url]
  if (os === 'macos') return ['open', url]
  return ['xdg-open', url]
}

// The kind named at the start of the command's text (`bug: ...`), if any.
export function kindFromArgs(args: string): { kind?: FeedbackKind; message: string } {
  const m = /^\s*(bug|idea|praise)\b\s*[:\-]?\s*/i.exec(args)
  if (!m) return { message: args.trim() }
  return { kind: (m[1] ?? 'bug').toLowerCase() as FeedbackKind, message: args.slice(m[0].length).trim() }
}
