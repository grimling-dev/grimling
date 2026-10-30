# Grimling commands (work in progress)

The pane's bottom line always says what the next key does.

Get in and out:
- `/grimling`        open Grimling and give it the keyboard
- `ctrl+x` `Tab`    take the keyboard from the prompt into the deck (or click it)
- `Shift+Tab`, `↑`, `←` move back (Tab, `↓`, `→` move forward)
- `Esc`             hand the keyboard back to the prompt
- `/grimling-tour`   walk through every key; Esc ends it

Tab bar (Tab to a tab, Enter; or its letter): `Deck` d · `Flow` f · `Table` t · `Mermaid` m (copies the agent graph) · `Help` h (the tour).

While a text box has the ring (launch box, `/` filter, message box) letters and digits only type: tab letters, card digits and `c`/`x` work again once you Tab out.

Launch an agent:
- move onto a card (Tab or arrows): its dex entry shows (#number, category, type, purpose); the launch target does not change
- `Enter` on the card (or its number `1`-`9`) makes it the launch target and jumps into the launch box; type the task; `Enter` starts it
- or Tab straight to the launch box and type: it launches the current target
- if the spawn is refused, the task stays in the launch box to retry
- template cards (Swarm, and any in `templates.enabled`) add the filled-in request after your prompt draft instead; press Esc, then Enter to send. A project's template is marked `proj`: read it before sending
- the Workflows card (`Lore`) is a link: `Enter` (or a click, or its number) opens the Claude Workflow Library (https://www.claudeworkflows.org/) in your browser; with no browser the link is copied. It never launches an agent or fills the prompt. The library is a community index run by the r/ClaudeAI moderators; Grimling only links to it (unofficial, not affiliated)

Grimoire (the cards):
- built-ins: Scout (Explore), Builder (general-purpose), Planner (Plan), Fetcher (web-fetch), Guide (claude-code-guide), and the Workflows link card; then the template cards (Swarm by default)
- agent cards, an earlier source winning a shared name: the mod's own agents (`grimling:<name>`), each pack in `cards.packs` (`<ns>:<name>`), the project's `.claude/agents`, then `~/.claude/agents`; card ids are `agent-<name>` whatever the pack, so a recent run follows its agent to another pack; ones without art get a generated pixel creature
- category chips: All, Code, Research, Web, Ops, Swarm, Custom (Enter on a chip); `/` box filters by name
- card names, short names (6 characters), purpose (40), categories and art (8 rows of 8 pixels) come from dex.json: the mod's `agents/dex.json`, each pack's, then `~/.claude/grimling/dex.json`, the later winning; a key is `<name>` or `<ns>:<name>`; bad art is a settings problem and the card gets a creature

Recent runs (under the agents when there is room): your last 6 distinct launches from the run log; `Enter` on one puts its task and agent back in the launch box to edit and run again.

Meter (under the tabs, every view): your status line as bars. `ctx` context window used (tokens/window), `5h` and `7d` plan limits with their reset time in your time zone (the `time` settings), then cost · session time · model · active sessions. Green, yellow from 60%, red from 85%. Inline it is one line.

Layout: built for a narrow docked pane (about 44 columns); card labels are short (Build, Plan, Fetch) so they fit beside their number; Mermaid, Help and the counters sit on the bottom row; the status line only shows when agents are running or failed.

Live agents (the cards under "agents"): a running card shows how long it has run, a finished card the tokens it used (in + out, e.g. `● 358.3k`). Labels skip filler words, and cards that would read alike get a number. Up to 12 cards show (6 inline); a dim `+N older agents` line counts the rest, which the Table tab lists.
- `Enter` on a running agent    type a message, `Enter` sends it to that agent
- `Enter` on a finished agent   shows its answer: `Enter` adds it after your prompt draft, `c` copies, `x` closes (answers over 8,000 characters are cut and marked "truncated"; if the prompt cannot take it, a toast says so and the view stays open)
- `x` (or the STOP button) on a running agent the deck launched   stop it. A Stop / Keep confirm opens with Keep under the ring (`Enter` or `x` keeps it; Tab to Stop, `Enter` stops it). Grimling only stops an agent when you confirm. The stop goes through Claude Code's permission check (TaskStop), so Claude Code may ask too. On success: a toast, Grim's line and a `"kind":"stop"` row in the run log; the card says `stopped` until the engine drops it. If it is refused or fails: a "Not stopped: <reason>" toast and STOP stays to try again. Agents the model started (and workflow agents, which have no card) get no STOP. `stop.enabled: false` hides it
- an agent that drops out of the engine's list without a final status shows as `gone` after about 10 s

Flow and Table: the rows scroll with the ring; "↑ n more" / "↓ n more" count the rows out of view.

Collecting agent types:
- every spawn, answer, stop and scored fight is logged to `~/.claude/grimling/runs/`, one file a day (`YYYY-MM-DD.jsonl`; a file that reaches `log.maxBytes`, 2 MiB, goes on in `YYYY-MM-DD.2.jsonl`), so the log can never grow past what the mod can read; the older single `runs.jsonl` is left as it is and still read for recent runs
- `log.runs`: `"redacted"` (default: API keys, `sk-`/`ghp_`/`AKIA` tokens, bearer tokens, private keys and `KEY=value` secrets become `[redacted]`, your home folder `~`), `"full"` (as sent), `"meta"` (ids, types, times and lengths only: no prompt, answer or task text; recent runs need prompts, so the recent list stays empty), `"off"` (nothing written)
- `log.promptChars` (6000) and `log.answerChars` (1500) cap each text; `log.redact` adds your own regular expressions; `log.keepDays` (30): older day files are no longer read (the mod cannot delete files: remove old ones from `runs/` yourself)
- `log.debug` for `debug.log`: `"errors"` (default: errors and one line per load), `"all"` (also every press and focus move), `"off"`
- the log stays on this computer; for sensitive work use `"meta"` or `"off"`
- the `agent-dex` skill ("collect agent types", "save this agent") proposes specialized agents from that log; approved ones become agent files and dex cards

Always on:
- status line       running agents, failures and session cost
- toast             when an agent finishes, fails or is killed
- Grim               the mascot pops up in the pane with a speech bubble at the same moments ("Scout's work is done. Answer ready.", "Builder has met its end (failed)."), waves its scythe hand, then idles; it stays about 8 s or until the next event. Inline it is one line (`Grim: ...`). Grim also says hi at the top of the KEYS tab.

Settings (`~/.claude/grimling/settings.json`, optional; checked every 30 s and read again when it changes):
- every key has a default, so no file is needed; `"$schema": "<mod folder>/schema/settings.schema.json"` gives an editor autocomplete
- a bad value keeps its default and is listed as a problem: the footer shows `⚠ settings: 2 problems · k`, and the Keys tab (`k`) has a "settings" group with each `key: message (using default)` and the files read; a file that is not valid JSON keeps the last good settings
- `grim.enabled` (true) and `grim.seconds` (8, 2-30); `grim.lines.done` / `failed` / `killed` your own lines with `{name} {type} {duration} {task}`; the old `{"grim": false}` still hides Grim (toasts stay)
- `log.*` the run log (see "Collecting agent types")
- `feedback.repo` ("grimling-dev/grimling"), `feedback.nudge` (true)
- `stop.enabled` (true): the STOP button and `x` on running cards the deck launched; false hides them
- `meter.sessionsFile` (null): a file holding `{"n": 3}`, shown as "3 sessions" in the meter
- `cards.builtins` / `pack` / `user` / `project` (true) switch each card source; `cards.packs` ([{"path", "ns"?}]: a folder with `agents/`, optional `agents/dex.json` and `templates/`; `ns` defaults to its `.claude-plugin/plugin.json` name; enable the folder as a plugin too, or its cards cannot start); `cards.hide` (card ids or agent types; `["workflows"]` hides the Workflows card)
- `templates.enabled` (["swarm"]): template ids that get a card; `<id>.md` is looked up in the mod's `templates/`, each pack's `templates/`, `~/.claude/grimling/templates/` and the project's `.claude/grimling/templates/`, the last found winning; frontmatter `id, name, short, cat, what, art`, body with `{task}` `{cwd}` `{date}`; `examples/templates/gpu-swarm.md` is a cloud GPU example to copy
- `agentDex` is checked but not used yet
- a project's `.claude/grimling.json` may set only `cards` and `templates` (a cloned repo is not trusted with the log, the Arena puzzles file or anything else)

Arena lite (`a` or the Arena button on the bottom row; early: scoring and ratings may change between releases):
- pick Red and Blue fighters (Tab to `‹` `›`, Enter) and a task with a known answer, then Enter on FIGHT
- both run on haiku; answers are checked against the key, then the faster, then fewer tokens; a draw when all tie
- health bars move only once scored; wins, losses and a rating per card are kept in `~/.claude/grimling/arena.json`
- after a scored fight, `s` or the SHARE button copies a small text results card (task, model, each side's mark, time and tokens, the winner and why: right answer, speed, fewer tokens, or a draw; the winner's record and rating) and toasts "Arena result copied"; `s` does not fire while a text box has the ring
- every scored fight is also a `"kind":"arena"` row in the run log (`~/.claude/grimling/runs/`)


Setup (`/grimling-setup [check|show|ask]`):
- `check` (also with no word): the settings problems (the same list as the Keys tab) and the files read; with no settings file it says "all defaults" and how to start one
- `show`: every setting's effective value; `*` marks one that differs from the default, with where it came from (`settings.json` or the project's `.claude/grimling.json`) and the default
- `ask`: opens a setup view in the pane for the common settings: time zone (system, your computer's zone, UTC), 12h/24h clock, desktop notifications, Grim on/off, run log mode, the stop button. `Enter` on a value picks it; the preview shows the exact JSON that will be written. `Enter` on Write saves it to `~/.claude/grimling/settings.json`, laying only the changed keys over the file (unknown keys and `$schema` stay); `x` cancels. It never writes a project file. A settings file that is not valid JSON is never overwritten: fix it first (`check` names the problem). If the file changes while the preview is open, nothing is written and the preview is rebuilt
- empty places say what to do: no agents yet (type a task in the launch box), no recent runs (or why: `log.runs` is `meta` or `off`), and while you have no agent files of your own the Grimoire says "Add your own: drop agent files in ~/.claude/agents, or /grimling-setup"

Feedback (`/grimling-feedback [bug:|idea:|praise:] [text]`):
- asks the kind (Bug, Idea, Praise; skipped when the text starts with `bug:`, `idea:` or `praise:`), then opens a preview in the pane: kind chips, the message box (`e` edits), and exactly what is sent: the title, your message and the diagnostics (Grimling and Claude Code versions, OS family, pane width, card counts, the settings keys with problems; never paths, prompts, answers or the run log; keys, tokens and your home folder are scrubbed from the message too)
- `Enter` on Send opens GitHub in your browser with the form filled in (bugs: the issue form; ideas and praise: Discussions); you press Submit there. The mod itself sends nothing. If the browser cannot be opened the link is copied; if the text is too long for a link it is copied and the empty form opens. `x` cancels. Grim says thanks.
- when an agent fails, Grim's bubble offers `[f] report it`: the report starts with the card, its type, how long it ran and the first line of its last output (scrubbed). While that button is up, `f` reports instead of switching to Flow (Tab and Enter still reach Flow)
- from the 5th start on, a one-time hint shows on the deck (`x` hides it for good; `feedback.nudge: false` turns it off); `feedback.repo` picks the GitHub repository

Troubleshooting:
- a toast "Grimling is loaded under the old name ..." (or "could not save its state") means this session loaded the mod under a name it had before a rename, so Claude Code refuses its state writes and the Grimoire shows only built-ins. Start a new Claude Code session.
