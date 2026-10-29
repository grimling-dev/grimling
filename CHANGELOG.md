# Changelog

All notable changes to Grimling are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-29

First public release. Grimling is an unofficial community mod for Claude Code:
a pane beside the chat for summoning, watching and messaging subagents.

### Added

- **Pane and tabs.** `/grimling` opens a pane built for a narrow docked column
  (about 44 columns) with Deck, Flow, Table, Mermaid and Keys tabs. Tab, arrows
  and tab letters move around; Esc hands the keyboard back to the prompt.
  `/grimling-tour` walks through every key.
- **The Grimoire.** A filterable grid of pixel-art agent cards: the built-in
  agent types, every agent file in `~/.claude/agents` and in the project's
  `.claude/agents` (a project file wins over a user file of the same name),
  and Swarm, which fills a workflow request into your prompt instead of
  launching anything. Agents without drawn art get a generated creature.
  Category chips and a `/` name filter. Card art, short names and categories
  can be set in `~/.claude/grimling/dex.json`.
- **Launch in one line.** Pick a card, type the task, press Enter. A refused
  launch keeps the task in the box. Recent runs can be put back in the launch
  box to edit and run again.
- **Live agent cards.** Running agents get their own cards; send a message to a
  running agent, read a finished agent's answer, copy it or add it after your
  prompt draft. Long answers are cut and marked. Agents that leave the list
  without a final status show as gone.
- **Stop button.** Stops an agent launched from the deck, only after you
  confirm it in Claude Code's permission prompt.
- **Flow and Table views** of the agents in the session, and a Mermaid tab that
  copies the agent graph.
- **Grim, the mascot.** A small reaper pops up with a speech bubble when an
  agent finishes, fails or is stopped. Lines and duration can be changed, or
  Grim turned off.
- **Meter.** Your status line as bars: context window, plan limits with their
  reset times, cost, session time and model. Green, then yellow from 60 percent
  and red from 85 percent.
- **Arena lite.** Pit two cards against each other on a question with a known
  answer; both run on a small model and are scored by correctness, then speed,
  then tokens. Wins, losses and a rating per card are kept, and a results card
  can be copied to share.
- **Run log and the agent-dex skill.** Launches, answers and scored fights are
  logged on your computer in `~/.claude/grimling/runs/`, one file a day,
  redacted by default (modes: redacted, full, meta, off). The bundled
  `agent-dex` skill proposes reusable agent types from that log; you approve
  each one before it is saved.
- **Settings file.** Optional `~/.claude/grimling/settings.json` with a default
  for every key and a JSON schema for editor autocomplete. Bad values keep
  their default and are listed in the pane. A project's
  `.claude/grimling.json` may set only cards and templates.
- **Feedback.** `/grimling-feedback` previews exactly what would be sent (no
  paths, prompts or answers) and opens a pre-filled GitHub issue or discussion
  in your browser. The mod itself makes no network calls.

### Known limitations

- **macOS is untested.** The test suite passes on Windows and Linux; nobody
  has run Grimling on macOS yet. It should work; if something looks wrong,
  `/grimling-feedback` or an issue with what you see helps.
