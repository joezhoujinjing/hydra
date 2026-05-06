# Hydra Quickstart Demo

One command. No repo risk. Hydra spins up a temporary sandbox, starts a copilot, and lets that copilot scaffold a local demo project plus 3 parallel workers.

## Run It

```bash
./quickstart/run.sh
```

Optional: force a specific agent or reuse a sandbox root.

```bash
./quickstart/run.sh --agent codex
./quickstart/run.sh --root /tmp/hydra-quickstart-demo
```

## What It Does

The script:

1. Boots `scripts/e2e-isolated-runner.js` and creates an isolated Hydra home under your OS temp directory.
2. Starts one copilot inside the sandbox.
3. Hands that copilot a local-only quickstart task.
4. The copilot creates a local TypeScript calculator repo plus a local bare `origin`.
5. The copilot spawns 3 parallel Hydra workers:
   - `feat/core` implements the calculator core
   - `feat/cli` builds a Commander-based CLI
   - `feat/tests` writes Vitest coverage
6. Prints the exact commands to inspect the copilot and worker sessions.

## What Gets Created

The run is isolated from your real Hydra home and your current repository.

- `.../home` is the temporary HOME for the sandbox.
- `.../hydra-home` holds the isolated Hydra state, tmux socket, and worktrees.
- `.../playground` is the copilot work area.
- `.../playground/hydra-demo` is the demo repo the copilot creates.
- `.../playground/hydra-demo-origin.git` is the local bare remote the copilot creates.

The sandbox root path is printed when the run starts and again in the final summary.

## Follow-Up Commands

After launch, source the generated activation script so `hydra` points at the sandbox:

```bash
source /tmp/hydra-.../activate.sh
hydra list --json
hydra copilot logs hydra-quickstart --lines 80
```

Once the copilot finishes scaffolding the demo repo, inspect it with:

```bash
source /tmp/hydra-.../activate.sh
git -C /tmp/hydra-.../playground/hydra-demo log --oneline --graph --all
code --extensionDevelopmentPath=. /tmp/hydra-.../playground
```

## Requirements

- `git`
- `tmux`
- `node` and `npm`
- At least one supported agent CLI on `PATH`: `codex`, `claude`, or `gemini`

If the Hydra CLI build output is missing, the script runs `npm run compile` automatically before entering the sandbox.

## Cleanup

The quickstart preserves the sandbox by default so you can inspect the copilot, worktrees, and logs.

When you are done:

```bash
source /tmp/hydra-.../activate.sh
hydra list --json
hydra worker delete <session>
rm -rf /tmp/hydra-...
```

Delete workers one at a time if you want the sidebar state to stay responsive.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No agent is detected | Re-run with `--agent <name>` or install one of `codex`, `claude`, `gemini` |
| The copilot seems idle | `source <sandbox>/activate.sh` then run `hydra copilot logs hydra-quickstart --lines 80` |
| A worker stalls | `source <sandbox>/activate.sh` then run `hydra worker logs <session> --lines 80` |
| You want a clean rerun in the same sandbox | Re-run with the same `--root`; the script resets the isolated Hydra state first |
| The CLI build is missing | Run `npm install && npm run compile`, then re-run the quickstart |
