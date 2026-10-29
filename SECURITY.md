# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue or
discussion.

- Use GitHub's private reporting: on the repository page open the **Security**
  tab and choose **Report a vulnerability**
  (https://github.com/grimling-dev/grimling/security/advisories/new).
- If you cannot use that form, email the maintainer,
  alexz@lightauto.tech (Light House Automations LLC), with
  `[grimling security]` in the subject.
- Say what you found, how to reproduce it, and which Grimling and Claude Code
  versions you used. Please leave out real keys, prompts or private files.

We aim to reply within a week and will keep you posted until it is fixed. We
are happy to credit you in the release notes unless you prefer not to be named.

## Supported versions

Only the latest release gets security fixes. Update with
`claude plugin update grimling`.

## What Grimling does and does not do

- **No network calls.** The mod makes no network calls of its own.
  `/grimling-feedback` only opens a link in your browser, after showing you
  exactly what it contains; you press Submit yourself.
- **Agents run in your session.** Agents it launches run inside your Claude
  Code session, under your permission settings, and use your plan. Arena runs
  two small-model agents per fight.
- **Agents are stopped only when you confirm.** The stop button goes through
  Claude Code's permission prompt and stops nothing without your yes.
- **Local files only.** It writes only under `~/.claude/grimling/` (settings,
  run log, Arena records, debug log). The run log is redacted by default and
  can be set to `meta` or `off`.
- **Projects are trusted with little.** A project's `.claude/grimling.json` may
  set only cards (including extra pack folders) and templates. It cannot set
  the Arena puzzles file, the run log or anything else.

## Things to be careful with

- **Agent files are code you run.** An agent file is a prompt plus tool grants.
  Agent files in a cloned project's `.claude/agents` show up as cards. Read an
  agent file, and its `tools:` line, before you launch it or copy it into your
  own folder. Grimling never launches an agent by itself.
- **Answers are agent output.** When you add an agent's answer to your prompt,
  it is text written by a subagent. Review it before you send it on, as you
  would any tool output.
