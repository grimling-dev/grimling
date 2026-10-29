#!/usr/bin/env node
// Prints the CSP sha256 hashes of the inline <script> and <style> blocks in
// site/index.html and checks that site/vercel.json carries them.
//
//   node release/site-csp-hashes.mjs [--root <dir>] [--write]
//
// Exit 1 when:
//   - an inline <script> hash is missing from script-src in site/vercel.json
//     (or an inline <style> hash from style-src, unless style-src allows
//     'unsafe-inline');
//   - script-src carries a hash that no longer matches any inline script
//     (stale hashes left behind after an edit);
//   - the page loads a script, stylesheet, font, image or preconnect from
//     another origin (the site must make no third-party requests).
// --write replaces the hash list in script-src (and style-src when it uses
//         hashes) with the current hashes, then checks again.
//
// Hashes are taken over the text with CRLF turned into LF, which is what git
// (site/** is eol=lf in .gitattributes) and therefore Vercel serve. A CRLF
// working copy only gets a warning: deploy from a clean checkout.
// No dependencies.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
const rootArg = args.indexOf('--root')
const root = resolve(rootArg >= 0 ? args[rootArg + 1] : '.')
const write = args.includes('--write')
const htmlPath = join(root, 'site', 'index.html')
const vercelPath = join(root, 'site', 'vercel.json')

const raw = readFileSync(htmlPath, 'utf8')
if (raw.includes('\r\n')) {
  console.warn('warning: site/index.html has CRLF line endings in this working copy. Hashes below are for the LF')
  console.warn('         text git serves. Deploy from git or a fresh checkout, not from this folder with the CLI.')
}
const html = raw.replace(/\r\n/g, '\n')
const sha = s => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`

// Inline blocks: <script> without src, and <style>. Content is the exact text
// between the tags, which is what browsers hash.
const blocks = { script: [], style: [] }
for (const m of html.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
  const [, tag, attrs, body] = m
  if (tag.toLowerCase() === 'script' && /\bsrc\s*=/i.test(attrs)) continue
  if (tag.toLowerCase() === 'script' && /\btype\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(attrs)) continue
  const line = html.slice(0, m.index).split('\n').length
  blocks[tag.toLowerCase()].push({ line, hash: sha(body) })
}

// Third-party loads. Plain <a href> links to other sites are navigation, not
// requests, and are allowed.
const external = []
const ext = /^(https?:)?\/\//i
for (const m of html.matchAll(/<(script|img|iframe|source|video|audio|embed)\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) if (ext.test(m[2])) external.push(`<${m[1]} src=${m[2]}>`)
for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
  const href = (m[0].match(/\bhref\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || ''
  const rel = ((m[0].match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || '').toLowerCase()
  if (ext.test(href) && !/^(canonical|alternate|me|author|license)$/.test(rel.trim())) external.push(`<link rel=${rel} href=${href}>`)
}
for (const m of html.matchAll(/url\(\s*["']?((https?:)?\/\/[^"')]+)/gi)) external.push(`url(${m[1]})`)
for (const m of html.matchAll(/@import\s+(url\()?["']?((https?:)?\/\/[^"')\s;]+)/gi)) external.push(`@import ${m[2]}`)

console.log('Inline <script> hashes (script-src):')
for (const b of blocks.script) console.log(`  line ${b.line}: ${b.hash}`)
console.log('Inline <style> hashes (style-src):')
for (const b of blocks.style) console.log(`  line ${b.line}: ${b.hash}`)

const problems = []
for (const e of external) problems.push(`third-party request in site/index.html: ${e}`)

const getCsp = cfg => {
  for (const rule of cfg.headers || []) for (const h of rule.headers || []) if (/^content-security-policy$/i.test(h.key)) return h
  return null
}
const parse = v => Object.fromEntries(v.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...rest] = s.split(/\s+/); return [k.toLowerCase(), rest] }))
const unparse = d => Object.entries(d).map(([k, v]) => [k, ...v].join(' ')).join('; ')

let cfg = JSON.parse(readFileSync(vercelPath, 'utf8'))
let header = getCsp(cfg)
if (!header) {
  problems.push('site/vercel.json has no Content-Security-Policy header')
} else {
  if (write) {
    const d = parse(header.value)
    const swap = (dir, list) => {
      if (!d[dir]) return
      d[dir] = [...d[dir].filter(t => !/^'sha(256|384|512)-/.test(t)), ...new Set(list.map(b => b.hash))]
    }
    swap('script-src', blocks.script)
    if (!(d['style-src'] || []).includes("'unsafe-inline'")) swap('style-src', blocks.style)
    header.value = unparse(d)
    writeFileSync(vercelPath, JSON.stringify(cfg, null, 2) + '\n')
    console.log('wrote the hashes into site/vercel.json')
    cfg = JSON.parse(readFileSync(vercelPath, 'utf8'))
    header = getCsp(cfg)
  }
  const d = parse(header.value)
  const scriptSrc = d['script-src'] || d['default-src'] || []
  const styleSrc = d['style-src'] || d['default-src'] || []
  if (scriptSrc.includes("'unsafe-inline'") && !scriptSrc.some(t => t.startsWith("'sha"))) problems.push("script-src allows 'unsafe-inline'; use hashes")
  for (const b of blocks.script) if (!scriptSrc.includes(b.hash)) problems.push(`script-src lacks ${b.hash} (inline <script> at line ${b.line})`)
  const want = new Set(blocks.script.map(b => b.hash))
  for (const t of scriptSrc) if (/^'sha256-/.test(t) && !want.has(t)) problems.push(`script-src has a stale hash ${t}`)
  if (!styleSrc.includes("'unsafe-inline'")) {
    for (const b of blocks.style) if (!styleSrc.includes(b.hash)) problems.push(`style-src lacks ${b.hash} (inline <style> at line ${b.line})`)
  }
}

if (problems.length) {
  console.error('\nFAIL')
  for (const p of problems) console.error('  - ' + p)
  console.error('\nFix: self-host every third-party file under site/vendor/, then `node release/site-csp-hashes.mjs --write` and commit site/vercel.json.')
  process.exit(1)
}
console.log('\nOK: site/vercel.json matches site/index.html and the page loads nothing from other origins.')
