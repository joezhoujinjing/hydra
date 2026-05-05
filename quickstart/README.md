# Hydra Quickstart Demo

One command. Zero interaction. Watch Hydra spawn 3 parallel AI workers that build a TypeScript project from scratch.

## Run It

```bash
./quickstart/run.sh
```

That's it. Walk away and come back to find 3 PRs on your GitHub.

## What It Does

The script autonomously:

1. **Checks prerequisites** via `hydra doctor`
2. **Creates a private repo** (`hydra-demo`) on your GitHub
3. **Scaffolds a TypeScript project** (package.json, tsconfig, src/)
4. **Spawns 3 parallel Hydra workers:**
   - `feat/core` — Calculator functions (add, subtract, multiply, divide)
   - `feat/cli` — CLI interface with Commander.js
   - `feat/tests` — Vitest test suite with edge cases
5. **Polls until all 3 PRs are created** (or 10-min timeout)
6. **Reports results** — lists PRs and worker status

## What You'll See

```
🐉 Hydra Quickstart Demo
▶ Running hydra doctor...
✔ All prerequisites passed
▶ Creating private repo: hydra-demo
✔ Repo created
▶ Spawning 3 parallel workers...
  ● Worker 1: feat/core  → hydra-ab12_feat-core
  ● Worker 2: feat/cli   → hydra-ab12_feat-cli
  ● Worker 3: feat/tests → hydra-ab12_feat-tests
✔ All workers spawned
▶ Monitoring workers (polling every 30s)...
  [30s]  PRs: 0/3 | Active workers: 3
  [60s]  PRs: 1/3 | Active workers: 3
  [120s] PRs: 2/3 | Active workers: 2
  [180s] PRs: 3/3 | Active workers: 0

═══════════════════════════════════════════════
  🎉 Hydra Demo Complete — All PRs Created!
═══════════════════════════════════════════════
```

**Optional:** Open VS Code alongside to watch workers appear in the Hydra sidebar in real time.

## Estimated Time

| Phase | Duration |
|-------|----------|
| Repo + scaffold | ~15 sec |
| Workers coding in parallel | ~3–7 min |
| **Total** | **~5–10 min** |

## Prerequisites

Run `hydra doctor` to verify. Requires:
- git, tmux, Hydra CLI (`~/.hydra/bin/hydra`)
- gh CLI (authenticated)
- At least one AI agent: claude, codex, or gemini

## Cleanup

```bash
gh repo delete hydra-demo --yes
```

Workers are auto-cleaned when the repo is deleted, or manually:
```bash
hydra list --json | jq -r '.workers[].session' | while read s; do hydra worker delete "$s"; done
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `hydra doctor` fails | Install missing tools, run `hydra doctor` for details |
| Workers fail immediately | Check agent auth (`claude --version`) and API keys |
| Timeout with 0 PRs | Run `hydra worker logs <session> --lines 50` to diagnose |
| Repo already exists | Script auto-deletes and recreates it |
