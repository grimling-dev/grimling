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
| `grim.waiting` | `true` | `true`, `false` | Grim pops up when an agent starts waiting (once per wait, at most once a minute per agent; built-in lines). The card's `wait 32s` badge and the `◎ N waiting` count show either way. |
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
| `cards.size` | `"auto"` | `"auto"`, `"full"`, `"compact"`, `"mini"` | Grimoire card size in the docked pane. `auto` takes the largest size at which every shown card fits (typing in the find box does not change it); `full`, `compact` or `mini` always draws that size. See below. |

Card sizes (`cards.size`):

- `full`: the card's 8x8 pixel sprite (four text rows of half blocks) over its name, in a border. 10 columns wide, 7 rows tall.
- `compact`: the same sprite at half height (two text rows; each pair of pixel rows becomes one), the same border and name. 10 wide, 5 tall.
- `mini`: one line, a dot in the sprite's main colour and the short name. 12 wide, so three across a 44-column pane.
- `auto` works out the room the Grimoire has after the tab bar, meter, launch box, chips, find box, live agent cards and the bottom row. Recent runs give way first (down to one row), then it takes `full`, else `compact`, else `mini`, whichever is the largest that shows every card the filter lets through. When even `mini` cannot, it draws `mini` with the dim "N more cards" line, as before.
- Live agent cards (the running and finished ones under "agents") are always full size.
- `z` cycles auto, full, compact, mini for this session (a toast says which; for auto it names the size that fits now). The label in the Grimoire's top border shows the size (`auto·compact`); Tab to it and Enter does the same. `z` is off while a text box has the ring. The setting is the size each new session starts with.
- The inline pane keeps its one-line cards at any setting.

### templates

Template cards fill the prompt with text. They never start an agent on their own. A project file may set this.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `templates.enabled` | `["swarm"]` | template ids (a-z, 0-9 and `-`) | Which templates get a card, in this order. See [PACKS.md](PACKS.md). |

### keys

How the keyboard moves around the pane.

| Key | Default | Allowed | What it does |
|---|---|---|---|
| `keys.arrows` | `true` | `true`, `false` | Arrow keys move the focus ring to the item above, below or beside it in the docked pane. `false`: arrows behave as before. Tab and Shift+Tab are the same either way. |

With `keys.arrows` on, in the docked pane:

- `↑` `↓` go to the row above or below: tab bar, launch box, chips, find box, Grimoire rows, live agents, recent runs, the bottom row. In the card grids the column is kept where the next row has one, else the ring lands on that row's last card; the column is kept through a one-item row in between.
- `←` `→` go along a row: tabs, chips, cards, live agents, dialog buttons.
- At an edge the ring stays. Nothing wraps.
- In a text box (launch box, message box, find box) `←` `→` move the text cursor. `↑` `↓` leave the box to the row above or below, as from any other item (not in Tab order: `↑` from the find box goes to the first chip, not the last).
- In the Stop / Keep confirm and the answer box, every arrow stays on that box's buttons.
- STOP buttons are not on the arrow path: `x` stops the card under the ring (Stop / Keep first), and Tab still reaches STOP. The card size label in the Grimoire's border is off the path the same way (`z` and Tab reach it), and so is the `[v] transcript` row under a live card (`v` and Tab reach it). An arrow from either moves on from where it is drawn: `↑` from STOP goes back to its card, `↓` from the size label into the Grimoire.
- Enter presses what has the ring. Esc hands the keyboard back to the prompt.

How it works, and its limits (Claude Code 2.1.312):

- Claude Code does not tell a pane which key moved the ring, and it gives a pane `↑` `↓` only as a scroll while the pane's content is taller than the pane. So with `keys.arrows` on, Grimling keeps the docked deck one row taller than the pane and turns those scrolls into moves. You may see Claude Code's dim "more" row at the bottom of the pane; it is that padding. A view taller than the pane on its own (a long Keys or Setup view) still scrolls when an arrow reaches its top or bottom item. The mouse wheel and Page Up / Page Down scroll as before.
- Claude Code binds no `←` `→` in a pane, so they need one keybinding, once. Add this block to the `bindings` list in `~/.claude/keybindings.json` (create the file if it does not exist):

  ```json
  {
    "bindings": [
      { "context": "Pane", "bindings": { "left": "pane:top", "right": "pane:bottom" } }
    ]
  }
  ```

  Grimling reads those as left and right. Home and End reach a pane as the very same scroll, so with `keys.arrows` on they move left and right too (binding or not). In a text box Grimling drops that scroll: Home and End neither move the ring nor scroll the pane there. A pane cannot hand a key on to the box, so they do not move its text cursor either, unless Claude Code gives them to the box first.
- The inline pane (a narrow terminal) is not padded: there `↑` `↓` walk in Tab order as before.

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
