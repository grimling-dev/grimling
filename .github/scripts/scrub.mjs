#!/usr/bin/env node
// Scrub check: fails when a file holds a pattern that must not be published
// (personal names, home paths, private projects, secrets). Generic: every
// pattern lives in a patterns file, so this script holds no personal data.
//
//   node scrub.mjs [--root <dir>] [--patterns <file>] [--allowlist <file>]
//                  [--json] [file ...]
//
// Files: the paths given, else the allowlisted files (--allowlist, private
// repo only), else every file git tracks under --root (default: cwd).
// Exit 0 clean, 1 hits found, 2 usage or setup error. No dependencies.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, relative, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Glob to RegExp: `**` spans folders, `*` stays inside one, `?` one char.
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function toRegExp(src, flags = '') {
  if (src.startsWith('(?i)')) return new RegExp(src.slice(4), flags + 'i')
  return new RegExp(src, flags)
}

export function parsePatterns(text) {
  const classes = [] // { name, res: [{ src, re }] }
  const allowMatch = []
  const allowIn = [] // { glob, file: RegExp, line: RegExp, match?: RegExp }
  let section = null
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const head = /^\[([a-z0-9-]+)\]$/i.exec(line)
    if (head) {
      section = head[1]
      if (section !== 'allow-match' && section !== 'allow-in') classes.push({ name: section, res: [] })
      return
    }
    if (!section) throw new Error(`patterns line ${i + 1}: pattern before any [class]`)
    try {
      if (section === 'allow-match') allowMatch.push(toRegExp(line))
      else if (section === 'allow-in') {
        const at = line.indexOf('::')
        if (at < 0) throw new Error('expected <glob> :: <regex>')
        const glob = line.slice(0, at).trim()
        // Optional third field: <glob> :: <line regex> :: <match regex>. Then
        // only hits whose matched text fits <match regex> are excused.
        const rest = line.slice(at + 2)
        const third = rest.indexOf(' :: ')
        const entry = { glob, file: globToRegExp(glob), line: toRegExp((third < 0 ? rest : rest.slice(0, third)).trim()) }
        if (third >= 0) entry.match = toRegExp(rest.slice(third + 4).trim())
        allowIn.push(entry)
      } else classes.at(-1).res.push({ src: line, re: toRegExp(line, 'g') })
    } catch (e) {
      throw new Error(`patterns line ${i + 1}: ${e.message}`)
    }
  })
  return { classes, allowMatch, allowIn }
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

// Scans files (paths relative to root). Returns { hits, scanned, binaries }.
// `display` maps a scanned path to the name used in allow-in globs and output
// (publish passes the published path for remapped files).
export function scrub({ root, files, patterns, display = f => f, skip = [] }) {
  const hits = []
  const binaries = []
  let scanned = 0
  const skipSet = new Set(skip.map(s => resolve(root, s)))
  for (const file of files) {
    const abs = resolve(root, file)
    const name = display(file)
    // Pattern files hold the patterns themselves; never flag them.
    if (skipSet.has(abs) || /(^|\/)scrub-patterns[^/]*\.txt$/.test(name) || !existsSync(abs)) continue
    const buf = readFileSync(abs)
    const binary = isBinary(buf)
    if (binary) binaries.push(name)
    const lines = buf.toString(binary ? 'latin1' : 'utf8').split(/\r?\n/)
    scanned++
    lines.forEach((text, idx) => {
      for (const cls of patterns.classes) {
        for (const { src, re } of cls.res) {
          re.lastIndex = 0
          let m
          while ((m = re.exec(text))) {
            if (m[0] === '') { re.lastIndex++; continue }
            const allowed = patterns.allowMatch.some(a => a.test(m[0])) ||
              patterns.allowIn.some(a => a.file.test(name) && a.line.test(text) && (!a.match || a.match.test(m[0])))
            if (!allowed) {
              hits.push({ class: cls.name, file: name, line: binary ? 0 : idx + 1, match: m[0], pattern: src, text: text.trim().slice(0, 140) })
            }
          }
        }
      }
    })
  }
  return { hits, scanned, binaries }
}

export function formatHits(hits) {
  const byClass = new Map()
  for (const h of hits) {
    if (!byClass.has(h.class)) byClass.set(h.class, [])
    byClass.get(h.class).push(h)
  }
  const out = []
  for (const [cls, list] of byClass) {
    const files = new Set(list.map(h => h.file))
    out.push(`\n[${cls}] ${list.length} hit(s) in ${files.size} file(s)`)
    for (const h of list) out.push(`  ${h.file}:${h.line}  ${JSON.stringify(h.match)}  | ${h.text}`)
  }
  return out.join('\n')
}

async function main(argv) {
  const opts = { root: process.cwd(), patterns: null, allowlist: null, json: false, files: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') opts.root = resolve(argv[++i])
    else if (a === '--patterns') opts.patterns = resolve(argv[++i])
    else if (a === '--allowlist') opts.allowlist = resolve(argv[++i])
    else if (a === '--json') opts.json = true
    else if (a === '-h' || a === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n')); return 0 }
    else if (a.startsWith('--')) { console.error(`unknown option ${a}`); return 2 }
    else opts.files.push(a)
  }
  const here = dirname(fileURLToPath(import.meta.url))
  if (!opts.patterns) {
    const candidates = [join(here, 'scrub-patterns.txt'), join(opts.root, '.github', 'scrub-patterns.txt')]
    opts.patterns = candidates.find(existsSync)
    if (!opts.patterns) { console.error('no patterns file; pass --patterns <file>'); return 2 }
  }
  const patterns = parsePatterns(readFileSync(opts.patterns, 'utf8'))
  let files = opts.files
  let display = f => f
  if (!files.length && opts.allowlist) {
    const { resolveAllowlist } = await import(pathToFileURL(join(here, 'allowlist.mjs')).href)
    const { entries } = resolveAllowlist(opts.root, opts.allowlist)
    const dest = new Map(entries.map(e => [e.src, e.dest]))
    files = entries.map(e => e.src)
    display = f => dest.get(f) ?? f
  } else if (!files.length) {
    files = execFileSync('git', ['-C', opts.root, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  }
  // Never flag the patterns file itself.
  const skip = [relative(opts.root, opts.patterns)]
  const result = scrub({ root: opts.root, files, patterns, display, skip })
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else {
    if (result.hits.length) console.log(formatHits(result.hits))
    const counts = {}
    for (const h of result.hits) counts[h.class] = (counts[h.class] ?? 0) + 1
    console.log(`\nscrub: ${result.scanned} file(s) scanned, ${result.hits.length} hit(s)` +
      (result.hits.length ? ` (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})` : '') +
      (result.binaries.length ? `; binary files scanned as raw text: ${result.binaries.join(', ')}` : ''))
  }
  return result.hits.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(`scrub: ${e.message}`); process.exit(2) })
}
