// Text from an agent, a file or a project, made safe to draw in the pane.
//
// Subagent answers often carry web pages or tool output, and agent, dex and
// pod files are written by someone else. Terminal escape sequences in that
// text (an OSC 52 clipboard write, an OSC 8 link, a title change, cursor moves
// that redraw over the pane) and bidi overrides must never reach the
// terminal. printable() removes them and every other control character except
// a newline and a tab; the rest of the text is kept as it was.

// OSC, DCS, SOS, PM and APC: ESC ] / P / X / ^ / _ (or their 8-bit forms) up
// to BEL or ST (ESC \ or 0x9c); an unterminated one runs to the end.
const STRING_SEQ = /(?:\x1b[\]PX^_]|[\x90\x98\x9d\x9e\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?/g
// CSI: ESC [ (or 0x9b), parameters, intermediates and a final byte.
const CSI = /(?:\x1b\[|\x9b)[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]?/g
// Any other ESC sequence: intermediates and a final byte.
const ESC = /\x1b[\x20-\x2f]*[\x30-\x7e]?/g
// Controls left over: C0 but \t and \n, DEL, C1, and bidi embeddings,
// overrides and isolates.
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩]/g

export function printable(s: string): string {
  if (!s) return s
  return s.replace(STRING_SEQ, '').replace(CSI, '').replace(ESC, '').replace(CONTROLS, '')
}

// The same for each string value of a flat record (a pod status file).
export function printableFields<T extends object>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' ? printable(v) : v
  return out as T
}
