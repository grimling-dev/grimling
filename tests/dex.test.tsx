import { expect, test } from 'claude-code/testing'
import { envHome, HOME, PACKS, PROJ, slash } from './paths'

import { artProblem, cardForType, fillTemplate, parseTemplate, readMeta } from '../hooks/dex'

// The Grimoire reads the mod's own agents/ folder, cards.packs, project and
// user agent files, and the templates in templates.enabled. Every load says
// what it found (debug.log, "dex" lines); bad entries are settings problems.

const PANE = {
  plugin: 'grimling',
  component: 'Pane',
  requestId: 'grimling',
  surface: 'terminal',
  props: {
    title: 'Grimling',
    isFocused: true,
    bodyColumns: 78,
    placement: 'dock',
    // Tall enough for every card: a short pane cuts Grimoire rows (B4, fit.test).
    scroll: { offset: 0, bodyRows: 120 },
    view: {},
  },
} as const

const SCOUT = ['---', 'name: research-scout', 'description: Research worker for one angle.', 'model: sonnet', '---', 'You scout.'].join('\n')
const GATEKEEPER = ['---', 'name: ops-admin', 'description: Network administrator.', '---', 'You admin.'].join('\n')
const X = ['---', 'name: x', 'description: Does x.', '---', 'You do x.'].join('\n')

const SETTINGS = `${HOME}/.claude/grimling/settings.json`
const MYPACK = `${PACKS}/mypack`

const file = (name: string) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })
// Lets the first polls and the dex load land, then draws again: the stub
// clock never advances, so the pane is not redrawn on its own.
const settle = async (ui: { redraw: () => Promise<unknown> }) => {
  await new Promise(resolve => setTimeout(resolve, 50))
  await ui.redraw()
}

// Quiet engine; `listing` answers fs.list per folder (a function may throw);
// `files` are read as written (and collect writes).
function engine(
  on: Parameters<Parameters<typeof test>[1]>[1],
  listing: (path: string) => string[],
  files: Record<string, string> = {},
) {
  const seen = { toasts: [] as string[], filled: [] as string[] }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({ value: {} }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(JSON.stringify(e))
    return { value: {} }
  })
  on('ui.status', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: envHome(e.name) }))
  on('session.usage', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('prompt.fill', (_, e) => {
    seen.filled.push(e.text)
    return { isFilled: true }
  })
  on('fs.list', (_, e) => ({ value: listing(slash(e.path)).map(file) }))
  on('fs.read', (_, e) => {
    const p = slash(e.path)
    if (p in files) return { value: files[p] }
    if (p.endsWith('/research-scout.md')) return { value: SCOUT }
    if (p.endsWith('/ops-admin.md')) return { value: GATEKEEPER }
    if (p.endsWith('/agents/x.md')) return { value: X }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => {
    files[slash(e.path)] = String(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: slash(e.path) in files }))
  return { files, seen }
}

const inUserDir = (p: string) => p === `${HOME}/.claude/agents`
const inPack = (p: string) =>
  p.endsWith('/agents') && !p.includes('/.claude/') && !p.includes('/proj/') && !p.startsWith(`${PACKS}/`)

test('pack agents and the user agent file get cards, and the load is logged with counts', async ($, on) => {
  const { files } = engine(on, p => (inPack(p) ? ['research-scout.md'] : inUserDir(p) ? ['ops-admin.md'] : []))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await settle(ui)
  expect(await ui.find({ type: 'Button', key: 'card-agent-research-scout' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'card-agent-ops-admin' })).toBeTruthy()
  const log = files[`${HOME}/.claude/grimling/debug.log`] ?? ''
  expect(log).toContain(' dex ')
  expect(log).toContain('"pack":1')
  expect(log).toContain('"user":1')
  await ui.unmount()
})

test('a folder that cannot be listed is named in the debug log not swallowed', async ($, on) => {
  const { files } = engine(on, p => {
    if (inPack(p)) throw new Error('EACCES: permission denied')
    return inUserDir(p) ? ['ops-admin.md'] : []
  })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await settle(ui)
  expect(await ui.find({ type: 'Button', key: 'card-agent-ops-admin' })).toBeTruthy()
  const log = files[`${HOME}/.claude/grimling/debug.log`] ?? ''
  expect(log).toContain('list pack')
  expect(log).toContain('"pack":0')
  await ui.unmount()
})

test('cards.packs: a pack agent runs as mypack:x; the mod pack wins a shared name; dex.json layers by ns', async ($, on) => {
  engine(
    on,
    p =>
      inPack(p)
        ? ['research-scout.md']
        : p === `${MYPACK}/agents`
          ? ['research-scout.md', 'x.md']
          : inUserDir(p)
            ? ['research-scout.md']
            : [],
    {
      [SETTINGS]: JSON.stringify({ cards: { packs: [{ path: MYPACK }] } }),
      [`${MYPACK}/.claude-plugin/plugin.json`]: '{"name": "mypack"}',
      [`${MYPACK}/agents/dex.json`]: '{"x": {"name": "Ex"}, "mypack:x": {"short": "Exx", "cat": "ops"}}',
    },
  )
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await settle(ui)
  expect((await ui.find({ type: 'Button', key: 'card-agent-x' }))?.text).toBe('Exx')
  await ui.press({ key: 'card-agent-x' })
  expect(await ui.find({ type: 'Text', text: /Does x · mypack:x · pack/ })).toBeTruthy()
  // One research-scout card, the mod's own: the earlier source wins.
  await ui.press({ key: 'card-agent-research-scout' })
  expect(await ui.find({ type: 'Text', text: /grimling:research-scout · pack/ })).toBeTruthy()
  await ui.unmount()
})

test('sources can be switched off, cards hidden, and a recent run follows its agent to another pack', async ($, on) => {
  engine(on, p => (inPack(p) || p === `${MYPACK}/agents` ? ['research-scout.md'] : inUserDir(p) ? ['ops-admin.md'] : []), {
    [SETTINGS]: JSON.stringify({ cards: { pack: false, user: false, hide: ['scout', 'Plan'], packs: [{ path: MYPACK, ns: 'mypack' }] } }),
    [`${MYPACK}/.claude-plugin/plugin.json`]: '{"name": "mypack"}',
    [`${HOME}/.claude/grimling/runs.jsonl`]:
      '{"kind":"spawn","at":"1970-01-01T00:00:00.000Z","agentId":"r1","type":"grimling:research-scout","description":"find papers","prompt":"find papers on x"}\n',
  })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await settle(ui)
  expect(await ui.find({ type: 'Button', key: 'card-scout' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'card-planner' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'card-builder' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'card-agent-ops-admin' })).toBeUndefined()
  // The run was logged under grimling:research-scout; that type is gone, the
  // mypack one has the same name, so the recent row loads it.
  await ui.press({ key: 'recent-0' })
  expect(await ui.find({ type: 'Text', text: /mypack:research-scout · pack/ })).toBeTruthy()
  expect((await ui.find({ type: 'Input', key: 'launch-input' }))?.text).toBe('find papers on x')
  await ui.unmount()
})

test('bad dex.json art is dropped with a problem; the rest of the entry is kept', async ($, on) => {
  engine(on, p => (inUserDir(p) ? ['ops-admin.md'] : []), {
    [`${HOME}/.claude/grimling/dex.json`]: JSON.stringify({
      'ops-admin': { name: 'Gatekeeper', short: 'Gate', cat: 'ops', art: ['zz', 'kk'] },
    }),
  })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await settle(ui)
  expect((await ui.find({ type: 'Button', key: 'card-agent-ops-admin' }))?.text).toBe('Gate')
  expect(await ui.find({ type: 'Text', text: /⚠ settings: 1 problem · k/ })).toBeTruthy()
  await ui.press({ key: 'tab-keys' })
  expect(
    await ui.find({ type: 'Text', text: /dex\.json ops-admin\.art: art must be 8 rows of 8 pixels.*generated creature/ }),
  ).toBeTruthy()
  await ui.unmount()
})

const GPU_TEMPLATE = [
  '---',
  'id: gpu-swarm',
  'name: GPU swarm',
  'short: GPU',
  'cat: swarm',
  'what: open-weight model swarm on cloud GPUs',
  '---',
  'Open-weight model research swarm on cloud GPUs: {task}. Quote the price and wait for my go before creating any cloud resource.',
].join('\n')

test('a user template in templates.enabled becomes a card that fills the prompt; a missing one is a problem', async ($, on) => {
  let spawns = 0
  const { seen } = engine(on, () => [], {
    [SETTINGS]: JSON.stringify({ templates: { enabled: ['swarm', 'gpu-swarm', 'nope'] } }),
    [`${HOME}/.claude/grimling/templates/gpu-swarm.md`]: GPU_TEMPLATE,
  })
  on('agent.spawn', () => {
    spawns += 1
    return { model: 'test', agentId: 'x' }
  })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await settle(ui)
  expect(await ui.find({ type: 'Button', key: 'card-swarm' })).toBeTruthy()
  expect((await ui.find({ type: 'Button', key: 'card-gpu-swarm' }))?.text).toBe('GPU')
  await ui.press({ key: 'card-gpu-swarm' })
  await ui.input({ key: 'launch-input', text: 'compare 7B adapters', kind: 'submit' })
  expect(spawns).toBe(0)
  expect(seen.filled[0]).toContain('on cloud GPUs: compare 7B adapters.')
  expect(seen.filled[0]).toContain('wait for my go before creating any cloud resource')
  await ui.press({ key: 'tab-keys' })
  expect(await ui.find({ type: 'Text', text: /templates\.enabled: no template "nope"/ })).toBeTruthy()
  await ui.unmount()
})

test('a project template is tagged proj and only fills the prompt, with {cwd} and {date}', async ($, on) => {
  const { seen } = engine(on, () => [], {
    [`${PROJ}/.claude/grimling.json`]: JSON.stringify({ templates: { enabled: ['swarm', 'review'] } }),
    [`${PROJ}/.claude/grimling/templates/review.md`]: '---\nname: Review\n---\nReview {task} in {cwd} on {date}.',
  })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await settle(ui)
  await ui.press({ key: 'card-review' })
  expect(await ui.find({ type: 'Text', text: /prompt template · fills the prompt · proj/ })).toBeTruthy()
  await ui.input({ key: 'launch-input', text: 'the parser', kind: 'submit' })
  expect(seen.filled[0]).toBe(`Review the parser in ${PROJ} on 1970-01-01.`)
  expect(seen.toasts.join('\n')).toContain('a project template: read it first')
  await ui.unmount()
})

test('dex helpers: art check, dex.json fields, template parse and fill, base-name lookup', () => {
  expect(artProblem(['kkkkkkkk', '........', 'tttttttt', 'wwwwwwww', 'yyyyyyyy', 'oooooooo', 'pppppppp', 'ssssssss'])).toBeNull()
  expect(artProblem(['kkkkkkkk'])).toContain('8 rows of 8 pixels')
  expect(artProblem(['zzzzzzzz', '', '', '', '', '', '', ''])).toContain('8 rows')

  const meta = readMeta({ a: { short: 'toolongname', what: 'ok' }, b: 'x' }, 'dex.json')
  expect(meta.meta.a).toEqual({ what: 'ok' })
  expect(meta.problems.map(p => p.path)).toEqual(['dex.json a.short', 'dex.json b'])

  const t = parseTemplate('---\nid: t\nname: T\nart: [".", "x"]\n---\nDo {task}.', 't', 'templates/t.md')
  expect(t.card?.fill).toBe('t')
  expect(t.card?.art).toBeUndefined()
  expect(t.problems[0]?.path).toBe('templates/t.md')
  expect(parseTemplate('---\nid: other\n---\nx', 't', 'f').card).toBeUndefined()
  expect(parseTemplate('---\nid: t\n---\n', 't', 'f').problems[0]?.message).toContain('no text')

  expect(fillTemplate('On {task} at {cwd} {date} $1', { task: 'x$&', cwd: '/p', date: 'd' })).toBe('On x$& at /p d $1')
  expect(fillTemplate('No placeholder.', { task: 'x', cwd: '', date: '' })).toBe('No placeholder.\n\nx')

  const entries = [{ type: 'mypack:scout' }, { type: 'Explore' }, { type: 'a:dup' }, { type: 'b:dup' }]
  expect(cardForType(entries, 'grimling:scout')?.type).toBe('mypack:scout')
  expect(cardForType(entries, 'Explore')?.type).toBe('Explore')
  expect(cardForType(entries, 'c:dup')).toBeUndefined()
})
