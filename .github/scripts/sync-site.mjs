#!/usr/bin/env node
// Writes the site's version strings and changelog block from CHANGELOG.md.
//
//   node sync-site.mjs [--root <dir>] [--check] [--strict]
//
// Source of truth: CHANGELOG.md (history; its newest `## [x.y.z]` section is
// the public version) and .claude-plugin/plugin.json (the shipped version).
// In site/index.html it rewrites:
//   - every <span data-sync="version">...</span>  -> vX.Y.Z
//   - everything between <!-- sync-site:changelog --> and
//     <!-- /sync-site:changelog -->               -> one entry per section
// --check  writes nothing; exit 1 when the site differs from what it would write.
// --strict also exit 1 when plugin.json's version is not the CHANGELOG version
//          (the public repo; the private repo keeps its own version line and
//          publish.mjs sets the public one in the copy).
// No dependencies.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Inline markdown: `code`, **bold**, [text](url). Escapes everything else.
function inline(md) {
  const parts = md.split(/(`[^`]*`)/)
  return parts.map(p => {
    if (p.startsWith('`') && p.endsWith('`') && p.length > 1) return `<code>${esc(p.slice(1, -1))}</code>`
    return esc(p)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  }).join('')
}

// CHANGELOG.md -> [{ version, date, intro, groups: [{ name, items: [md] }] }]
export function parseChangelog(text) {
  const sections = []
  let cur = null
  let group = null
  let item = null
  let para = []
  const flushPara = () => {
    if (cur && !group && para.length && !cur.intro) cur.intro = para.join(' ')
    para = []
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const h2 = /^## \[?(\d+\.\d+\.\d+[^\]\s]*)\]?\s*(?:-\s*(.+))?$/.exec(line)
    if (h2) {
      flushPara()
      cur = { version: h2[1], date: (h2[2] ?? '').trim(), intro: '', groups: [] }
      sections.push(cur)
      group = null; item = null
      continue
    }
    if (!cur) continue
    if (/^## /.test(line)) { flushPara(); cur = null; continue }
    const h3 = /^### (.+)$/.exec(line)
    if (h3) { flushPara(); group = { name: h3[1].trim(), items: [] }; cur.groups.push(group); item = null; continue }
    const li = /^[-*] (.+)$/.exec(line)
    if (li && group) { item = li[1]; group.items.push(item); continue }
    if (line.trim() === '') { flushPara(); item = null; continue }
    if (group && item !== null && /^\s+\S/.test(raw)) {
      group.items[group.items.length - 1] += ' ' + line.trim()
      item = group.items[group.items.length - 1]
      continue
    }
    if (!group) para.push(line.trim())
  }
  flushPara()
  return sections
}

// One bullet on the site: the bold lead plus the first sentence after it.
function shortItem(md) {
  const lead = /^\*\*(.+?)\*\*\s*(.*)$/.exec(md)
  const rest = lead ? lead[2] : md
  const first = (/^(.+?[.!?])(\s|$)/.exec(rest)?.[1] ?? rest).trim()
  return lead ? `<strong>${inline(lead[1])}</strong> ${inline(first)}` : inline(first)
}

export function renderChangelog(sections, indent = '        ') {
  return sections.map(s => {
    const title = s.intro ? inline((/^(.+?[.!?])(\s|$)/.exec(s.intro)?.[1] ?? s.intro)) : esc(s.groups.map(g => g.name).join(', '))
    const many = s.groups.length > 1
    const items = s.groups.flatMap(g => g.items.map(it => `<li>${many ? `<em>${esc(g.name)}:</em> ` : ''}${shortItem(it)}</li>`))
    return `${indent}<div class="entry"><div class="when"><b>v${esc(s.version)}</b>${esc(s.date)}</div><div><strong>${title}</strong><ul>${items.join('')}</ul></div></div>`
  }).join('\n')
}

const START = '<!-- sync-site:changelog -->'
const END = '<!-- /sync-site:changelog -->'

export function syncSite(root) {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  const sitePath = join(root, 'site', 'index.html')
  const site = readFileSync(sitePath, 'utf8')
  const sections = parseChangelog(changelog)
  if (!sections.length) throw new Error('CHANGELOG.md has no "## [x.y.z]" section')
  const version = sections[0].version
  const problems = []

  const a = site.indexOf(START)
  const b = site.indexOf(END)
  if (a < 0 || b < a) throw new Error(`site/index.html lacks the ${START} ... ${END} markers`)
  const lineStart = site.lastIndexOf('\n', b) + 1
  const indent = /^[ \t]*/.exec(site.slice(lineStart, b))[0]
  const eol = site.includes('\r\n') ? '\r\n' : '\n'
  let next = site.slice(0, a + START.length) + eol + renderChangelog(sections, indent).replace(/\n/g, eol) + eol + indent + site.slice(b)

  let versionSpans = 0
  next = next.replace(/(<span data-sync="version">)[^<]*(<\/span>)/g, (_, o, c) => { versionSpans++; return `${o}v${version}${c}` })
  if (!versionSpans) problems.push('site/index.html has no <span data-sync="version"> element')

  return { sitePath, site, next, version, pluginVersion: plugin.version, problems }
}

function main(argv) {
  let root = process.cwd()
  let check = false
  let strict = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') root = resolve(argv[++i])
    else if (a === '--check') check = true
    else if (a === '--strict') strict = true
    else { console.error(`unknown argument ${a}`); return 2 }
  }
  const r = syncSite(root)
  let code = 0
  for (const p of r.problems) { console.error(`sync-site: ${p}`); code = 1 }
  if (r.pluginVersion !== r.version) {
    const msg = `plugin.json version ${r.pluginVersion} differs from CHANGELOG version ${r.version}`
    if (strict) { console.error(`sync-site: ${msg}`); code = 1 } else console.log(`sync-site: note: ${msg} (publish.mjs sets ${r.version} in the copy)`)
  }
  if (r.next === r.site) {
    console.log(`sync-site: site is in sync with CHANGELOG (v${r.version})`)
  } else if (check) {
    console.error(`sync-site: site/index.html is out of date; run node release/sync-site.mjs`)
    code = 1
  } else {
    writeFileSync(r.sitePath, r.next)
    console.log(`sync-site: wrote site/index.html (v${r.version})`)
  }
  return code
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))) } catch (e) { console.error(`sync-site: ${e.message}`); process.exit(2) }
}
