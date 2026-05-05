# Hydra Quickstart Demo

One command. No repo risk. Hydra spins up a temporary sandbox, scaffolds a local demo project, and launches 3 parallel workers so you can see the full workflow in your first few minutes.

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
2. Scaffolds a local TypeScript calculator repo plus a local bare `origin` inside that sandbox.
3. Installs demo dependencies and pushes `main` to the local remote.
4. Spawns 3 parallel Hydra workers:
   - `feat/core` implements the calculator core
   - `feat/cli` builds a Commander-based CLI
   - `feat/tests` writes Vitest coverage
5. Polls until each worker has pushed its branch inside the sandbox.
6. Prints the exact paths and follow-up commands to inspect the result.

## What Gets Created

The run is isolated from your real Hydra home and your current repository.

- `.../home` is the temporary HOME for the sandbox.
- `.../hydra-home` holds the isolated Hydra state, tmux socket, and worktrees.
- `.../playground/hydra-demo` is the demo repo you can inspect.
- `.../playground/hydra-demo-origin.git` is the local bare remote used by the demo.

The sandbox root path is printed when the run starts and again in the final summary.

## Follow-Up Commands

After the demo finishes, source the generated activation script so `hydra` points at the sandbox:

```bash
source /tmp/hydra-.../activate.sh
hydra list --json
git -C /tmp/hydra-.../playground/hydra-demo log --oneline --graph --all
```

To open the demo repo in VS Code with the isolated user-data directory:

```bash
source /tmp/hydra-.../activate.sh
code --extensionDevelopmentPath=. /tmp/hydra-.../playground/hydra-demo
```

## Requirements

- `git`
- `tmux`
- `node` and `npm`
- At least one supported agent CLI on `PATH`: `codex`, `claude`, or `gemini`

If the Hydra CLI build output is missing, the script runs `npm run compile` automatically before entering the sandbox.

## Cleanup

The quickstart preserves the sandbox by default so you can inspect the worktrees and logs.

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
| A worker stalls | `source <sandbox>/activate.sh` then run `hydra worker logs <session> --lines 80` |
| You want a clean rerun in the same sandbox | Re-run with the same `--root`; the script resets the isolated Hydra state first |
| The CLI build is missing | Run `npm install && npm run compile`, then re-run the quickstart |
