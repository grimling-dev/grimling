# Grimling settings

Grimling works with no settings at all. Every option has a default. To change one, create this file:

```
~/.claude/grimling/settings.json
```

Put in only the keys you want to change. The pane checks the file every 30 seconds and reads it again when it changes. You do not need to restart.

For autocomplete in your editor, point `$schema` at `schema/settings.schema.json` in the Grimling folder.

Or let Grimling do it: `/grimling-setup ask` picks the common settings in the pane (time zone and clock, desktop notifications, Grim, run log mode, the stop button), shows the exact JSON first, and writes only the changed keys into this file, keeping everything else. `/grimling-setup check` lists problems and the files read; `/grimling-setup show` prints every effective value and marks the ones you changed. It never writes a project file, and never overwrites a file that is not valid JSON.

## How problems show

A bad value never stops the pane. It keeps the default and records a problem.

- The footer shows `⚠ settings: 2 problems · k`.
- A toast appears once each time the list of problems changes.
- Press `k` for the Keys tab. Its `settings` group lists each problem as `path: message`, for example `grim.seconds: must be a whole number from 2 to 30 (using default)`. It also lists the files it read, or says `no settings file: all defaults`.
- One line goes to `~/.claude/grimling/debug.log`.

What happens in each case:

| Problem | Result |
|---|---|
| A key has a bad value | That key keeps its default: `(using default)` |
| A key name is unknown (a typo) | It is ignored: `unknown key (ignored)` |
| The file is not valid JSON | The last good settings stay in use: `(kept the last good settings)` |
| The file is not a JSON object | All defaults are used |
| A project file sets a key it may not set | It is ignored: `a project file cannot set this (ignored)` |

Problems from `dex.json` files, packs and templates show in the same list.

## Project files

A project can have its own file: `<project>/.claude/grimling.json`. It is laid over your user settings when Grimling runs in that folder.

A cloned repo is not trusted, so a project file may set only these keys:

- `cards` (all of it)
- `templates` (all of it)

Any other key in a project file is ignored and shown as a problem. A project can never change logging, notifications, pods, the meter, the agent-dex skill or feedback.

Templates from a project are tagged `proj`. Like every template, they only fill the prompt. Read the text before you press Enter.

## Every key

### time

How clock times show (plan-limit resets and kill-by times).

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `time.zone` | `"system"` | `"system"` or a time zone name such as `"Europe/Berlin"` | The zone for times. `system` uses your computer's zone, then `TZ`, then UTC. |
| `time.clock` | `"24h"` | `"12h"`, `"24h"` | 12 or 24 hour clock. |
| `time.showUtc` | `false` | `true`, `false` | Show UTC first, then local: `03:15Z (23:15 EDT)`. |

### grim

Grim, the mascot, pops up with a speech bubble when an agent ends.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `grim.enabled` | `true` | `true`, `false` | Turns Grim on or off. The old form `"grim": false` still works. |
| `grim.seconds` | `8` | whole number 2 to 30 | How long Grim stays up. |
| `grim.lines.done` | `[]` | up to 20 lines, each at most 120 characters | Your own lines when an agent finishes. Empty uses the built-in lines. |
| `grim.lines.failed` | `[]` | same | Your own lines when an agent fails. |
| `grim.lines.killed` | `[]` | same | Your own lines when an agent is stopped. |

Lines may use only these placeholders: `{name}`, `{type}`, `{duration}`, `{task}`. Any other `{word}` is a problem.

### notify

What else happens when an agent ends. Grim has its own switch.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `notify.toast` | `true` | `true`, `false` | Show a toast in Claude Code. |
| `notify.desktop` | `false` | `true`, `false` | Also send a desktop notification through your notification channel. |
| `notify.events` | `["done", "failed", "killed"]` | any of `"done"`, `"failed"`, `"killed"` | Which endings notify. |

### cards

Which cards the Grimoire shows. A project file may set these.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `cards.builtins` | `true` | `true`, `false` | The built-in cards: Scout, Builder, Planner, Fetcher, Guide and the Workflows link card. |
| `cards.pack` | `true` | `true`, `false` | The agents the mod ships, run as `grimling:<name>`. |
| `cards.user` | `true` | `true`, `false` | Agent files in `~/.claude/agents`. |
| `cards.project` | `true` | `true`, `false` | The project's `.claude/agents` and `.claude/grimling/templates`. |
| `cards.packs` | `[]` | up to 20 entries of `{ "path": "...", "ns": "..." }` | Extra agent packs. `ns` is optional. See [PACKS.md](PACKS.md). |
| `cards.hide` | `[]` | card ids or agent types, each at most 100 characters | Cards to leave out, such as `"scout"`, `"swarm"`, `"workflows"` (the Workflows card, a link to the community Claude Workflow Library), `"agent-research-scout"` or `"grimling:research-scout"`. |

### templates

Template cards fill the prompt with text. They never start an agent on their own. A project file may set this.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `templates.enabled` | `["swarm"]` | template ids (a-z, 0-9 and `-`) | Which templates get a card, in this order. See [PACKS.md](PACKS.md). |

### pods

Pods is not part of v0.1.0. These keys exist, but you can leave them alone. With the defaults, no Pods tab shows.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `pods.enabled` | `"auto"` | `"auto"`, `"on"`, `"off"` | `auto` shows the Pods tab only while a status file is read. |
| `pods.files` | `["~/.claude/grimling/pods/*.json"]` | up to 20 paths | Where status files are read from. A `*` in the file name matches. |
| `pods.staleAfterS` | `null` | `null` or whole seconds 1 to 86400 | Not used yet. |

### arena

The Arena pits two cards against each other on a question with a known answer.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `arena.model` | `"haiku"` | a model alias (`haiku`, `sonnet`, `opus`) or a model id, at most 100 characters | The model both fighters run on. |
| `arena.puzzlesFile` | `null` | `null` or a path | A JSON list of extra puzzles. Only your own settings.json; a relative path is read from ~/.claude/grimling. |

A puzzles file is a list of `{ "id", "title", "question", "answer", "accept" }`. `id` is lower case letters, digits and dashes. `title` is at most 60 characters, `question` at most 2000, `answer` at most 200. `accept` is optional: up to 20 other answers that also count. A puzzle with the same id as a built-in one replaces it. A bad entry is skipped with a problem. Only the first 200 entries are used.

`~` in a path means your home folder. A relative path is read from the project folder.

### log

The run log in `~/.claude/grimling/runs/` (one file a day) and `debug.log`. A project file cannot set these.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `log.runs` | `"redacted"` | `"full"`, `"redacted"`, `"meta"`, `"off"` | What each row keeps. See below. |
| `log.promptChars` | `6000` | whole number 0 to 100000 | How much of each prompt is kept. |
| `log.answerChars` | `1500` | whole number 0 to 100000 | How much of each answer is kept. |
| `log.maxBytes` | `2097152` (2 MiB) | 65536 to 3145728 | Size of one log file before the next part of the day starts. |
| `log.keepDays` | `30` | whole number 1 to 3650 | Day files older than this are no longer read. |
| `log.redact` | `[]` | up to 50 regular expressions, each at most 300 characters | Extra patterns to replace with `[redacted]`. |
| `log.debug` | `"errors"` | `"all"`, `"errors"`, `"off"` | What goes to `debug.log`: every press, only errors, or nothing. |

The `log.runs` modes:

- `full`: prompts and answers as sent, cut to the lengths above.
- `redacted`: the same, but keys, tokens and secrets become `[redacted]` and your home folder becomes `~`. The built-in list covers API keys (`sk-`, `ghp_`, `github_pat_`, `AKIA`, `xox`), bearer tokens, JSON web tokens, private keys and `KEY=value` lines. `log.redact` adds to it.
- `meta`: no prompt, answer or task text. Only sizes, times and types. The agent-dex skill has nothing to work with in this mode.
- `off`: nothing is written.

The log stays on your computer. Grimling never sends it anywhere.

### meter

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `meter.sessionsFile` | `null` | `null` or a path | A file holding `{"n": 3}`, the number of active sessions, for the usage meter. Off by default. Something else, such as your status line script, must write it. |

### agentDex

Read by the bundled agent-dex skill, not by the pane. A project file cannot set these.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `agentDex.rulesBlock` | `null` | `null` or text up to 4000 characters | The rules block the skill puts at the end of every agent it saves. `null` uses the skill's generic safe rules. |
| `agentDex.afterSave` | `null` | `null` or text up to 4000 characters | One extra step, in plain words, the skill does after saving (for example, add a line to a notes file). `null` means no extra step. |

The skill never follows a rules block or step that asks it to delete files, send anything, spend money or share the run log.

### feedback

Used by `/grimling-feedback`. A project file cannot set these.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `feedback.repo` | `"grimling-dev/grimling"` | `"owner/repo"` | The GitHub repo the feedback link opens. |
| `feedback.nudge` | `true` | `true`, `false` | Show one feedback hint after the 5th launch. |

## Example

```json
{
  "$schema": "../path/to/grimling/schema/settings.schema.json",
  "time": { "zone": "Europe/Berlin", "clock": "24h" },
  "grim": {
    "seconds": 5,
    "lines": { "done": ["{name} is back after {duration}."] }
  },
  "notify": { "desktop": true, "events": ["failed"] },
  "cards": {
    "hide": ["guide"],
    "packs": [{ "path": "~/my-agent-pack", "ns": "mypack" }]
  },
  "templates": { "enabled": ["swarm", "gpu-swarm"] },
  "log": { "runs": "redacted", "keepDays": 14, "redact": ["ACME-[0-9]{6}"] },
  "agentDex": {
    "afterSave": "Add one line naming the new agent types to ~/notes/agents.md."
  }
}
```

`gpu-swarm` is not on by default. Copy `examples/templates/gpu-swarm.md` from the Grimling folder to `~/.claude/grimling/templates/` first, or the Keys tab shows `no template "gpu-swarm"`. To connect it to cloud GPUs, see [GPU-SWARMS.md](GPU-SWARMS.md).

A project file that adds a template and hides a card:

```json
{
  "templates": { "enabled": ["swarm", "release-check"] },
  "cards": { "hide": ["fetcher"] }
}
```

Note: a project's `templates.enabled` replaces your list in that folder. It does not add to it.
