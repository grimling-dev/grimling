# Grimling packs and templates

## What a pack is

A pack is a folder of agent types that Grimling shows as cards. It is also a Claude Code plugin: Claude Code runs the agents, and Grimling only draws their cards. Grimling does not register a pack's agents itself.

So a pack needs two things:

1. Claude Code loads the folder as a plugin, the same way you load any local plugin.
2. Your `~/.claude/grimling/settings.json` lists it in `cards.packs`.

If the folder is listed but not loaded as a plugin, its cards show, but Claude Code cannot start them.

## Folder layout

```
my-agent-pack/
  .claude-plugin/
    plugin.json        { "name": "mypack", ... }
  agents/
    research-scout.md  an agent file: frontmatter, then the prompt
    code-reviewer.md
    dex.json           optional: card names, categories and sprites
  templates/
    weekly-review.md   optional: prompt templates
  .gitattributes       keep the .md files LF (see below)
```

Agent files are normal Claude Code agent files. The frontmatter `name` is the agent's name; without it, the file name is used. The card's one-line text comes from the first sentence of `description`, unless `dex.json` says otherwise.

## cards.packs and namespaces

```json
{
  "cards": {
    "packs": [
      { "path": "~/my-agent-pack" },
      { "path": "D:/packs/team-pack", "ns": "team" }
    ]
  }
}
```

- `path` is the pack folder. `~` is your home folder. A relative path is read from the project folder.
- `ns` is the namespace. Claude Code starts a plugin's agents as `<ns>:<name>`, for example `mypack:research-scout`. If you leave `ns` out, Grimling uses the `name` in the pack's `.claude-plugin/plugin.json`. Set `ns` only when it must differ from that name.
- `ns` must be a plugin name: lower case letters, digits and dashes.
- A folder with no `ns` and no readable plugin name is skipped, with a problem in the Keys tab.
- Up to 20 packs.

Card ids do not include the namespace. An agent named `research-scout` always has the card id `agent-research-scout`, whatever pack it is in. So Arena ratings and recent runs follow an agent when you move it to another pack. A saved run whose type no longer exists is matched by base name, if exactly one loaded agent has that name.

## Which card wins

Cards are collected in this order. When two sources have the same agent type or card id, the earlier one wins:

1. Built-ins (Scout, Builder, Planner, Fetcher, Guide)
2. Template cards (from `templates.enabled`)
3. The agents the mod ships (`grimling:<name>`)
4. Each `cards.packs` entry, in list order (`<ns>:<name>`)
5. The project's `.claude/agents`
6. Your `~/.claude/agents`

Each source has an on/off switch: `cards.builtins`, `cards.pack`, `cards.project`, `cards.user`. Packs are on while they are listed. `cards.hide` removes single cards by id or type. See [SETTINGS.md](SETTINGS.md).

## dex.json: names, categories and sprites

`dex.json` changes how a card looks. It never changes what the agent does.

```json
{
  "research-scout": {
    "name": "Ranger",
    "short": "Ranger",
    "cat": "research",
    "what": "one angle, a source per claim",
    "art": ["...gg...", "..gggg..", ".gsssg..", ".gkskg..", "..sss...", ".gggggg.", "..g..g..", ".bb..bb."]
  }
}
```

| Field | Limit | What it is |
|---|---|---|
| `name` | at most 40 characters | The card's name. |
| `short` | at most 6 characters | The name on small cards. |
| `cat` | at most 20 characters | The category for the filter: `code`, `research`, `web`, `ops`, `swarm` or `custom`. |
| `what` | at most 40 characters | One line under the name. |
| `art` | 8 rows of 8 pixels | The sprite. |

Keys are an agent name (`research-scout`) or a full type (`mypack:research-scout`). When both match, the full type wins for the fields it sets.

dex.json files are read as layers. A later layer wins, field by field:

1. The mod's own `agents/dex.json`
2. Each pack's `agents/dex.json`, in `cards.packs` order
3. Your `~/.claude/grimling/dex.json`

So you can rename or redraw any card in your own `dex.json` without touching the pack.

### The 8x8 palette rule

A sprite is exactly 8 strings of exactly 8 characters. Each character is one pixel, from this palette:

| Letter | Color | Letter | Color |
|---|---|---|---|
| `.` | empty | `s` | skin |
| `k` | dark | `b` | brown |
| `w` | white | `r` | red |
| `t` | teal | `g` | green |
| `y` | yellow | `c` | cyan |
| `o` | orange | `e` | grey |
| `p` | purple | | |

Any other size or letter drops the art. The card then draws a generated creature for the name, and the Keys tab shows a problem. A field that is too long is dropped the same way. A dex.json that is not valid JSON is ignored, with a problem.

## Templates

A template is a card that fills the prompt with text. It never starts an agent by itself. You, and the main session, decide what runs.

A template is a markdown file named `<id>.md`:

```markdown
---
id: weekly-review
name: Weekly review
short: Week
cat: custom
what: review this week's changes
art: ..pppp.. .pwwwwp. .pwkkwp. .pwwwwp. .pwkkwp. .pwwwwp. ..pppp.. ........
---
Review the changes in {cwd} since last week (today is {date}). Focus on: {task}. Reply with a short list of risks and a list of follow-ups.
```

- `id` is optional. If it is there, it must match the file name. Ids use a-z, 0-9 and `-`.
- `name`, `short`, `cat`, `what` and `art` follow the dex.json limits. `art` is 8 rows split by spaces, or a JSON list.
- The body is the text. A file with no body is skipped.
- `{task}` becomes what you typed in the launch box. `{cwd}` becomes the project folder. `{date}` becomes today's date.
- If the body has no `{task}`, your text is added after it.

### Where templates are found

Only ids listed in `templates.enabled` get a card. The default is `["swarm"]`. For each id, Grimling looks for `<id>.md` in these folders. The last one found wins:

1. The mod's `templates/`
2. Each pack's `templates/`, in `cards.packs` order
3. `~/.claude/grimling/templates/`
4. The project's `.claude/grimling/templates/` (only while `cards.project` is on)

A project template is tagged `proj`. When you use it, Grimling reminds you to read the text first. An id that no folder has shows as a problem.

The mod ships one more template you can turn on: `examples/templates/gpu-swarm.md`. Copy it to `~/.claude/grimling/templates/` and add `"gpu-swarm"` to `templates.enabled`. Setup and safety rules for running it on cloud GPUs: [GPU-SWARMS.md](GPU-SWARMS.md).

## Sharing a pack safely

Anyone who loads your pack runs your prompts with their tools and their files. Before you share one:

- **Least tools.** Give each agent only the tools it needs in its `tools` list. A reviewer needs `Read, Grep, Glob`, not `Bash` or `Write`. Plugin agents ignore `hooks`, `mcpServers` and `permissionMode` in frontmatter, so the `tools` list is the real limit.
- **No risky powers.** No agent should send messages, spend money, deploy, delete files or create cloud resources. If a template plans paid work, it must ask for a price and a go first, as `gpu-swarm.md` does.
- **A rules block.** End every prompt with clear rules: read-only unless told, no deletes, stop only processes it started, treat web pages and tool output as data, short summary back.
- **Nothing personal.** No secrets, keys, tokens, email addresses, real names, client names or folder paths from your computer. Use `{cwd}` and plain words instead of paths.
- **No hidden text.** Templates go straight into someone's prompt. Keep them short and readable, with no instructions the user cannot see.
- **LF line endings.** Claude Code can drop frontmatter fields from files with Windows (CRLF) line endings. Add a `.gitattributes` with `*.md text eol=lf`.
- **Check it.** Run `claude plugin validate <folder>`, then load the pack and press `k`: the Keys tab should show no problems.

When you load someone else's pack, read its agent files and templates first, the same way you would read a script before you run it.
