import { expect, test } from 'claude-code/testing'

import { printable, printableFields } from '../hooks/printable'

// Agent, file and project text is drawn in the terminal pane: escape sequences
// and other control characters are removed; newlines, tabs and the text stay.

const ESC = '\x1b'
const BEL = '\x07'
// String terminator: ESC and a backslash.
const ST = ESC + String.fromCharCode(92)

test('CSI sequences go: clear screen, cursor moves, colours', () => {
  expect(printable(`a${ESC}[2Jb${ESC}[10;5Hc${ESC}[1;31mred${ESC}[0m`)).toBe('abcred')
  expect(printable(`x${ESC}[?1049hy`)).toBe('xy')
})

test('OSC sequences go, ended by BEL, by ST, or not ended at all', () => {
  expect(printable(`copy${ESC}]52;c;ZXZpbA==${BEL}done`)).toBe('copydone')
  expect(printable(`${ESC}]8;;https://evil.example${ST}link${ESC}]8;;${ST}`)).toBe('link')
  expect(printable(`title${ESC}]0;pwned${BEL}`)).toBe('title')
  expect(printable(`start${ESC}]52;c;never ended`)).toBe('start')
  expect(printable(`dcs${ESC}Pq#0;2;0;0;0${ST}end`)).toBe('dcsend')
})

test('C1 controls, 8-bit CSI and OSC, BEL, backspace, carriage return and DEL go', () => {
  expect(printable('a\x9b2Jb')).toBe('ab')
  expect(printable('a\x9d0;title\x07b')).toBe('ab')
  expect(printable('a\x85b\x91c')).toBe('abc')
  // 8-bit APC up to its 8-bit ST.
  expect(printable('a\x9fapc string\x9cb')).toBe('ab')
  expect(printable(`ding${BEL}\b\r\x7fdone`)).toBe('dingdone')
  expect(printable(`lone ${ESC}c reset ${ESC}`)).toBe('lone  reset ')
})

test('bidi overrides and isolates go', () => {
  expect(printable('abc\u202edcba\u202c \u2066x\u2069')).toBe('abcdcba x')
})

test('newlines, tabs and other text stay as they were', () => {
  const text = 'line one\n\tindented ✓ émoji-free — ünïcode 日本\nlast'
  expect(printable(text)).toBe(text)
  expect(printable('')).toBe('')
})

test('printableFields cleans each string value and keeps the rest', () => {
  const out = printableFields({ pod: `p${ESC}[2J1`, pct: 40, phase: `RUN${BEL}` })
  expect(out).toEqual({ pod: 'p1', pct: 40, phase: 'RUN' })
})
