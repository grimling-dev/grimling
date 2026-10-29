# Contributing to Grimling

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and sharing ideas

- The easiest way is `/grimling-feedback` inside Claude Code. It shows you
  exactly what it will send, then opens a pre-filled GitHub issue (bugs) or
  discussion (ideas and praise) in your browser.
- Or open an issue with the bug form, or a post in GitHub Discussions.
- Security problems: do not open a public issue; see [SECURITY.md](SECURITY.md).

## How pull requests are handled

Development happens in a separate working repository; this public repository
receives each release as one snapshot. Your pull request still counts the same
way:

1. Open a pull request here against `main`.
2. A maintainer reviews it here, in public, and may ask for changes.
3. Once approved, the change is applied as a patch in the working repository,
   keeping you as the author, and ships in the next release.
4. The pull request is then closed with a link to the release that carries it.
   It is not merged with the merge button, so do not worry when it shows as
   closed instead of merged.

By opening a pull request you agree that your contribution is licensed under
the same terms as the files you change: MIT for code, CC BY 4.0 for art (see
[NOTICE](NOTICE)).

## Running Grimling from a checkout

1. Clone the repository.
2. Start Claude Code with the mod loaded from your clone:
   `claude --plugin-dir <path to your clone>`
   or set the environment variable `CLAUDE_CODE_PLUGIN_DIRS` to that path so
   every new session loads it.
3. After an edit, run `/reload-plugins` in the session.

## Before you open a pull request

- `claude plugin validate .` passes.
- `claude plugin test .` passes, and new behaviour has a test in `tests/`.
- `npx -p typescript@5.6.3 tsc -p .` type-checks cleanly. The engine types are
  written to `.claude-plugin/types/` once a session has loaded the mod.
- The pane still fits a 44-column terminal.
- No personal data in code, tests or screenshots: no home-folder paths, names,
  email addresses, keys or tokens. Tests use neutral fixtures.
- Commit messages use `type(scope): description`, for example
  `fix(grimling): keep the draft when a launch is refused`.

## Agent pack rules

Agent files in `agents/` are prompts plus tool grants that run on other
people's machines, so they are held to a stricter bar:

- Give every agent an explicit `tools:` line with only what it needs.
- No tools that send messages, spend money or delete things.
- Prefer read-only agents; say in the description when an agent writes files.
- Add a dex entry (name, short name, category, purpose, 8x8 art) in
  `agents/dex.json`.

## Code of conduct

Be kind and assume good faith. Maintainers may close or lock threads that are
abusive or off topic.
