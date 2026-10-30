# Grimling

[![License: MIT](https://img.shields.io/github/license/grimling-dev/grimling)](LICENSE)
[![Release](https://img.shields.io/github/v/release/grimling-dev/grimling)](https://github.com/grimling-dev/grimling/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/grimling-dev/grimling/ci.yml?branch=main&label=CI)](https://github.com/grimling-dev/grimling/actions/workflows/ci.yml)

A Claude Code mod: a pane of pixel-art agent cards beside the chat. Pick a card, type the task, press Enter. Watch the agent work, message it, read its answer and hand it to your prompt.

Unofficial community mod for Claude Code, not affiliated with Anthropic.

## Install

In a Claude Code session:

```
/plugin install grimling --marketplace grimling-dev/grimling
```

Or from a terminal:

```
claude plugin marketplace add grimling-dev/grimling
claude plugin install grimling@grimling
```

Then run `/reload-plugins` (or start a new session) and type `/grimling`. Update with `claude plugin update grimling`.

**Requirements.** Claude Code 2.1.312 or newer (the version it is tested on; the one-line install needs 2.1.275 or newer). Mods are an early-access Claude Code feature, so the surface Grimling is built on may change between Claude Code releases. The pane is built for a narrow docked column of about 44 columns.

| Platform | Status |
|---|---|
| Windows 11 | tested |
| Linux | tested (test suite) |
| macOS | test suite passes in CI; not yet tried live. If something looks wrong, `/grimling-feedback` or an issue helps |

## What it does

- **Tabs.** Deck, Flow, Table and Keys across the top; Mermaid, Help and Arena on the bottom row. Tab, arrows or the tab letter move around; Esc hands the keyboard back to the prompt.
- **The Grimoire.** A filterable grid of agent cards: the built-in agent types (Scout, Builder, Planner, Fetcher, Guide), every agent file in `~/.claude/agents` and in the project's `.claude/agents`, and agent packs you add in `cards.packs`. Agents without art get a generated pixel creature. Category chips and a `/` name filter. Cards shrink (full, compact, mini) so the whole deck fits the pane; `z` cycles the size.
- **Launch in one line.** Pick a card, type the task, Enter starts it. A refused launch keeps the task in the box. Recent runs can be put back in the launch box to run again.
- **Template cards.** Swarm (and any template in `templates.enabled`) only fills a request into your prompt, so you and the main session decide what runs.
- **Workflows card.** Opens the [Claude Workflow Library](https://www.claudeworkflows.org/), a community index of Claude workflows run by the r/ClaudeAI moderators, in your browser. Grimling only links to it (unofficial, not affiliated); `cards.hide: ["workflows"]` hides it.
- **Live agent cards.** Running agents get their own cards: Enter, type, Enter sends a message. Finished ones show their answer; Enter adds it after your prompt draft, `c` copies it. `v` opens the agent's transcript in Claude Code's own main view (`v` again goes back).
- **Stop button.** `x` or STOP on a running agent the deck launched opens a Stop / Keep confirm (Keep is the default). The stop goes through Claude Code's permission check. `stop.enabled: false` hides it.
- **Flow, Table and Mermaid.** Who spawned whom, every run as a table, and the agent graph copied as a Mermaid diagram.
- **Meter.** Your status line as bars: context window, plan limits with reset times and, while a limit is burning, when it runs out at the recent rate ("limit in ~40m"), cost, session time and model. It updates when Claude Code measures the session, not on a timer. Green, yellow from 60%, red from 85%.
- **Grim, the mascot.** Pops up with a speech bubble when an agent finishes, fails or is stopped. Your own lines, or turn it off with `grim.enabled: false`.
- **Arena lite (early).** Pit two cards against a question with a known answer. Both run on haiku (`arena.model`); the right answer wins, then the faster, then fewer tokens. Wins, losses and a rating per card are kept; `s` copies a results card.
- **Run log and the agent-dex skill.** Launches, answers, stops and scored fights are logged on your computer, redacted by default. The bundled `agent-dex` skill ("collect agent types") proposes reusable agent types from that log and saves only the ones you approve.
- **Setup and feedback.** `/grimling-setup` checks, shows or asks for your settings. `/grimling-feedback` previews exactly what it would send (no paths, prompts or answers) and opens a pre-filled GitHub issue or discussion in your browser.

Commands and keys: [COMMANDS.md](COMMANDS.md), or run `/grimling-tour` in the pane.

## Settings and packs

- [docs/SETTINGS.md](docs/SETTINGS.md): every key in the optional `~/.claude/grimling/settings.json`, its default and allowed values, what a project file may set, and how problems show in the Keys tab. `schema/settings.schema.json` gives your editor autocomplete.
- [docs/PACKS.md](docs/PACKS.md): agent packs, `dex.json` cards and sprites, prompt templates, which card wins, and how to share a pack safely.
- [docs/GPU-SWARMS.md](docs/GPU-SWARMS.md): set up the GPU swarm card with cloud GPU pods (your account, your tools), and safety rules for paid runs.

v0.1.0 ships no agent pack of its own: the Grimoire shows the built-ins and your own agent files. More packs later.

## Files it writes

All in `~/.claude/grimling/`, all on your computer:

- `runs/YYYY-MM-DD.jsonl`: the run log, one file a day. `log.runs` picks `redacted` (default), `full`, `meta` or `off`.
- `arena.json`: Arena wins, losses and ratings.
- `debug.log`: errors and one line per load (`log.debug`).
- `settings.json`: only when you write it, or approve `/grimling-setup ask`.
- `dex.json` and agent files in `~/.claude/agents`: only when you approve them in the `agent-dex` skill.

## Safety

- **No network calls.** The mod makes no network calls of its own. `/grimling-feedback` only opens a link in your browser after showing you what it holds; you press Submit there.
- **Agents run in your session.** Agents it launches run in your Claude Code session, under your permission settings, and use your plan. Arena runs two haiku agents per fight.
- **Stops only when you confirm.** The stop button needs your confirm, then Claude Code's permission check.
- **Sharing agents: read a file before you copy it.** An agent file is a prompt plus tool grants, and a cloned project's `.claude/agents` shows up as cards (marked `project`). A project's `.claude/grimling.json` may set only cards (including extra pack folders) and templates. An answer added to your prompt is subagent output: review it.

See [SECURITY.md](SECURITY.md) to report a problem privately.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: load a clone with `claude --plugin-dir <path to your clone>`, then

- `claude plugin validate .` checks the manifest and hooks module;
- `claude plugin test .` runs `tests/*.test.tsx`;
- `npx -p typescript@5.6.3 tsc -p .` type-checks (types are written to `.claude-plugin/types/` once a session has loaded the mod).

## Roadmap

Now (v0.3.0, early access): arrow keys around the pane, cards that shrink to fit the whole deck, transcript peek (`v`), a live meter with a "limit in ~40m" forecast, waiting badges with a Grim popup, the Workflows card, tests passing on Windows, Linux and macOS in CI, the GPU swarm setup guide, feedback through `/grimling-feedback`. Next: a demo video, more agent packs, a live try on macOS, Arena tuning. Later: save a community workflow as your own recipe card, credited and linked to its author; a prompt library with `@` shortcuts, saved Mermaid diagrams, a full "needs you" queue with permission asks and richer notification rules, per-agent cost bars, one pane for every terminal. Order can change.

## License and contact

Code: MIT, see [LICENSE](LICENSE). Grim and the sprite art: CC BY 4.0, see [NOTICE](NOTICE). "Claude" and "Claude Code" are trademarks of Anthropic, PBC. Changes: [CHANGELOG.md](CHANGELOG.md).

Copyright (c) 2026 Light House Automations LLC · alexz@lightauto.tech · https://lightauto.tech
