# GPU swarms with Runpod

How to set up Grimling's GPU swarm card so Claude Code can run a batch of jobs (for example a hyperparameter sweep or a set of evaluations) on Runpod GPU pods, and how to keep that safe and cheap.

## What the card does, and what it does not

- The GPU swarm card is a [template card](PACKS.md#templates). Pressing it only writes a request into your prompt. You read it and press Enter yourself.
- Grimling makes no network calls for this, holds no cloud keys and never creates, changes or stops a pod.
- All pod work is done by Claude Code tools that you install and approve: the Runpod MCP server, the official Runpod plugin for Claude Code, or the `runpodctl` CLI. They act under your own Runpod account, and Runpod bills you.
- You stay in charge of every paid step. The card asks Claude for a price quote and waits for your typed go, but that is a request in a prompt, not a lock. Your Claude Code permission prompts and the rules below are the real guard.

## Setup

1. **Make a Runpod account** at [runpod.io](https://www.runpod.io) and add credit. On a prepaid account, the balance is a hard ceiling: at $0, Runpod stops all running pods, and pods without a network volume are terminated with their data ([billing](https://docs.runpod.io/accounts-billing/billing)). Turn on the low-balance email alert on the Billing page. Leave auto-pay off while you learn.

2. **Pick how Claude Code signs in.** The safest choice needs no key on disk:
   - **Official plugin (recommended).** In Claude Code run `/plugin marketplace add runpod/runpod-plugins-official`, then `/plugin install runpod@runpod`, then `/reload-plugins`. It adds Runpod's skills and the hosted MCP server. Run `/mcp`, pick **runpod** and choose **Sign in with Runpod** ([agent skills](https://docs.runpod.io/get-started/agent-skills), [agent setup](https://docs.runpod.io/agent-setup)).
   - **Hosted MCP server only.** `claude mcp add --transport http runpod -s user https://mcp.runpod.io/`, then sign in from `/mcp`. The sign-in gets a session-scoped key and stores nothing on disk ([MCP servers](https://docs.runpod.io/get-started/mcp-servers)). Register only one hosted address; the older `mcp.getrunpod.io` works too but signs in separately.
   - **Optional docs server** (no account needed): `claude mcp add runpod-docs --scope user --transport http https://docs.runpod.io/mcp`. Lets Claude look things up in Runpod's docs.

3. **If you need an API key** (for `runpodctl`, scripts, or a client where sign-in fails):
   - Create it in the console under Credentials, API Keys. Name it for this use, give it the least permission that works (Read Only for a session that only watches; Restricted or All only when it must create pods), and copy it once: Runpod does not show it again ([API keys](https://docs.runpod.io/get-started/api-keys)).
   - Keep it in an environment variable named `RUNPOD_API_KEY`, set in your shell profile (Git Bash: `~/.bashrc`) or your system's user environment variables, never in a repo. `runpodctl doctor` can also store it in its own config file ([runpodctl](https://docs.runpod.io/runpodctl/overview)).
   - Never paste a key into a chat, a prompt, a template, a project file or Grimling's `settings.json`. The API-key forms of `claude mcp add` write the key into Claude Code's own config, so prefer sign-in when you can.
   - Disable or revoke a key you no longer use, and any key that may have leaked.

4. **Install `runpodctl` if you want a terminal path** (file transfer, SSH, scripts). Follow the install steps for your system in the [runpodctl docs](https://docs.runpod.io/runpodctl/overview), then run `runpodctl doctor`. Useful commands: `runpodctl pod list`, `runpodctl pod stop <id>`, `runpodctl pod delete <id>` ([manage pods](https://docs.runpod.io/pods/manage-pods)).

5. **Keep paid tools on ask.** In Claude Code, do not add allow rules for the Runpod tools that create, update or delete anything. Leave them asking, so every billable call shows you a permission prompt. Check with `/permissions`.

6. **Turn on the GPU swarm card.** Copy `examples/templates/gpu-swarm.md` from the Grimling folder to `~/.claude/grimling/templates/`, then add its id to your settings ([SETTINGS.md](SETTINGS.md#templates)):

   ```json
   { "templates": { "enabled": ["swarm", "gpu-swarm"] } }
   ```

   Press `k` in the pane: the Keys tab should show no `no template "gpu-swarm"` problem. A project can ship its own copy in `.claude/grimling/templates/`; it shows as `proj`, so read it before you send it.

7. **Use it.** Open the launch box, type the task (for example `hyperparameter sweep of my training script over 4 learning rates`), and press the GPU card. Grimling fills in the template with `{task}` replaced by what you typed. The example asks Claude to plan the jobs, the GPU type, count and hours, a spend cap and a terminate-by time; do a local dry run; quote the hourly price and worst-case total and wait for your typed go; save outputs off the machine; terminate every machine it starts and read back that it is gone; and report what ran and what it cost. Edit your copy to match how you work.

## Safety rules to adopt

These are habits for you and for Claude. Put the ones you want in your copy of the template or your project's `CLAUDE.md`.

1. **Quote, then a typed go.** Before any pod: the GPU type and count, the hourly price, the planned hours and the worst-case total. Nothing billable starts until you type an explicit go that names the price.
2. **A budget.** Set a spend cap for the run and keep your prepaid balance near it. Runpod also has a default account-wide hourly spend limit ([billing](https://docs.runpod.io/accounts-billing/billing)); do not rely on it as your budget.
3. **A terminate-by deadline and a watcher.** Write down a clock time by which every pod is gone. Set an alarm you will see. Have a watcher (a short local script polling `runpodctl pod list`, or a Claude Code loop) check progress and flag the deadline. Make the job end itself: pods come with `runpodctl` and a pod-scoped key preinstalled ([runpodctl](https://docs.runpod.io/runpodctl/overview)), and `RUNPOD_POD_ID` names the pod ([environment variables](https://docs.runpod.io/pods/templates/environment-variables)), so the last line of a job script can stop or remove its own pod.
4. **Preflight and a dry run, locally.** Run the job script on a tiny input on your own machine first (CPU is fine). Check paths, arguments, output locations and the stop command. A typo found on a paid GPU costs money every minute.
5. **Outputs off the pod.** Copy results to your own machine or storage as each job ends. Terminating a pod deletes everything not on a network volume, and stopping clears the container disk ([manage pods](https://docs.runpod.io/pods/manage-pods)).
6. **Terminate, then read back.** Prefer terminate over stop when the run is over: a stopped pod still bills for its volume disk. Then list your pods again (or check the console) and confirm none of yours is left.
7. **A cost ledger.** One line per run: date, GPU type and count, hours, hourly price, total, and what it was for. Compare it with the console's billing page.
8. **Keys stay out of chats.** Never paste an API key into Claude, a prompt, a ticket or a file in a repo. If one is pasted, revoke it.
9. **Touch only what you started.** Ask Claude to change or remove only pods it created in this session, or the one you name by id. Anything else on the account is reported to you, not removed.

## Troubleshooting

| Problem | What to try |
|---|---|
| Keys tab shows `no template "gpu-swarm"` | The file is not in `~/.claude/grimling/templates/` or its name is not `gpu-swarm.md`. |
| Pressing the card does nothing visible | The text is added after your prompt draft. Press Esc, then read it and press Enter ([COMMANDS.md](../COMMANDS.md)). |
| Claude says no Runpod tools are connected | Run `/mcp` and check that `runpod` is listed and signed in. After installing the plugin, run `/reload-plugins`. |
| Sign-in fails with `redirect_uri is not allowed` | Some clients cannot do the browser sign-in. Use an API key header or the local server ([MCP servers](https://docs.runpod.io/get-started/mcp-servers)). |
| `runpodctl` says it has no key | Run `runpodctl doctor`, or check that `RUNPOD_API_KEY` is set in the shell you started it from. |
| A pod cannot be created | No stock for that GPU in that region, or not enough balance: a new pod needs about an hour of credit for its configuration ([billing](https://docs.runpod.io/accounts-billing/billing)). Try another GPU type or region. |
| Charges continue after a run | A pod was stopped, not terminated, or a network volume still exists. List pods and volumes in the console. |

## Links

- Runpod docs: <https://docs.runpod.io>
- MCP servers: <https://docs.runpod.io/get-started/mcp-servers>
- Agent skills and the Claude Code plugin: <https://docs.runpod.io/get-started/agent-skills>
- API keys: <https://docs.runpod.io/get-started/api-keys>
- runpodctl: <https://docs.runpod.io/runpodctl/overview>
- Manage pods: <https://docs.runpod.io/pods/manage-pods>
- Billing: <https://docs.runpod.io/accounts-billing/billing>
- Templates and settings in Grimling: [PACKS.md](PACKS.md), [SETTINGS.md](SETTINGS.md)
