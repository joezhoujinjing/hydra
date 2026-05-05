---
name: test-hydra
description: Use when you need to test the Hydra extension. Compiles and launches a VS Code Extension Development Host so the user can manually test the extension.
---

# Skill: test-hydra

Test the Hydra extension — either manually via the VS Code Extension Development Host, or automatically via the E2E CLI test suite.

## Prerequisites

- Must be run from the repo root or a worktree of the hydra repo.
- Requires **Node.js 18+**, **VS Code** (`code` CLI on PATH), and dependencies installed (`npm install`).
- E2E tests additionally require **tmux** and **git**.

## Option A: E2E Integration Tests (automated)

Run the full E2E test suite against real tmux sessions, git worktrees, and the SessionManager:

```bash
cd <absolute-path-to-repo-or-worktree>
npm run compile
node out/cli/index.js test
```

### Options

- `--filter <pattern>` — Run only tests matching the substring (e.g., `--filter worker`)
- `--json` — Output results as machine-readable JSON

### What it tests

- **Worker lifecycle:** create, delete, stop/start, rename
- **Copilot lifecycle:** create, delete, stop/resume
- **Archive:** list, restore, dedup handling
- **Session model invariants:** 1:1 tmux-agent mapping, 1:1 worker-worktree mapping, no orphan sessions
- **CLI:** whoami identity detection, doctor prerequisites

### Environment isolation

Tests run with `HYDRA_HOME` set to a temporary directory, so they never touch `~/.hydra` or the user's real sessions. All test sessions use the `test-e2e-` prefix and are cleaned up automatically.

### Exit codes

- `0` — All tests passed
- `1` — One or more tests failed

## Option B: Extension Development Host (manual)

1. **Compile the extension**

   ```bash
   cd <absolute-path-to-repo-or-worktree>
   npm run compile
   ```

   If compilation fails, report the errors and stop.

2. **Create a unique test workspace**

   ```bash
   mkdir -p /tmp/hydra-test-$(date +%s)
   ```

3. **Launch the Extension Development Host**

   ```bash
   code --extensionDevelopmentPath="<absolute-path-to-repo-or-worktree>" /tmp/hydra-test-<timestamp>
   ```

   This opens a new VS Code window with the locally-compiled Hydra extension loaded.

4. **Inform the user**

   Tell the user the Extension Development Host is running and they can test the extension in the new VS Code window.

## Notes

- E2E tests run sequentially (tmux operations are not safe to parallelize).
- Each invocation creates a fresh test workspace under `/tmp/hydra-test-<timestamp>` to avoid conflicts.
- Only run this skill from the repo root or a worktree of the hydra repo.
