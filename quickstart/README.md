# Hydra Quickstart Demo

A zero-setup, fully autonomous demo that showcases Hydra's parallel agent orchestration. In under 10 minutes, you'll watch a Copilot spawn three Workers that build a TypeScript project from scratch — simultaneously.

## Prerequisites

| Tool | Purpose |
|------|---------|
| **git** | Version control |
| **tmux** | Persistent agent sessions |
| **VS Code** + `code` CLI | IDE + Hydra extension host |
| **Hydra extension** | Orchestration engine (installs `~/.hydra/bin/hydra`) |
| **gh CLI** (authenticated) | Repo creation + PR management |
| **AI agent CLI** (claude, codex, or gemini) | At least one agent runtime |

## Step 1: Run Doctor Check

```bash
hydra doctor
```

This verifies every prerequisite is installed and authenticated. Fix any issues before continuing.

## Step 2: Open VS Code

```bash
code .
```

Ensure the Hydra sidebar is visible (robot icon in the Activity Bar). If you just installed the extension, restart VS Code.

## Step 3: Create a Copilot

1. Open the Hydra sidebar and click **"Create Copilot"**
2. Choose your preferred agent (e.g., `claude`)
3. When the Copilot terminal opens, **paste the demo prompt** from [`demo-prompt.md`](./demo-prompt.md)

> **Tip:** Copy the entire contents of `demo-prompt.md` and paste it directly into the Copilot terminal.

## What to Expect

Once the Copilot receives the prompt, it will:

1. **Create a demo repository** — `hydra-demo` (private, on your GitHub account)
2. **Scaffold the project** — TypeScript + package.json + tsconfig + initial commit
3. **Spawn 3 Workers in parallel:**
   - `feat/core` — Implements calculator functions (add, subtract, multiply, divide)
   - `feat/cli` — Builds the CLI interface with Commander.js
   - `feat/tests` — Writes comprehensive Vitest tests
4. **Monitor progress** — The Copilot checks worker logs periodically
5. **Report completion** — Lists all created PRs when workers finish

### What You'll See

- **Sidebar:** Three workers appear with live status indicators
- **Terminals:** Three parallel tmux sessions, each with an AI agent coding
- **Git:** Three feature branches pushed with PRs created
- **Timeline:** ~5–10 minutes for all workers to complete

## Estimated Time

| Phase | Duration |
|-------|----------|
| Copilot planning & repo setup | ~1 min |
| Workers coding in parallel | ~3–7 min |
| PR creation & summary | ~1 min |
| **Total** | **~5–10 min** |

## Troubleshooting

### Copilot doesn't spawn workers

- Ensure the `hydra` CLI is in your PATH: `which hydra` or `~/.hydra/bin/hydra --version`
- Restart your terminal after installing the Hydra extension

### Workers fail immediately

- Check agent authentication: `claude --version`, `codex --version`, or `gemini --version`
- Ensure your API keys are configured (e.g., `ANTHROPIC_API_KEY` in environment)

### `gh repo create` fails

- Verify: `gh auth status`
- Ensure you don't already have a repo named `hydra-demo`: `gh repo view hydra-demo 2>/dev/null`

### Workers stuck or not progressing

- Check logs: `hydra worker logs <session> --lines 50`
- Send a nudge: `hydra worker send <session> "continue working"`

### Cleanup after the demo

```bash
# Delete the demo repo
gh repo delete hydra-demo --yes

# Remove local workers
hydra list --json | jq -r '.workers[].session' | while read s; do hydra worker delete "$s"; done
```
