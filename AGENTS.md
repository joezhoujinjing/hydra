# Hydra — Agent Operating Manual

Hydra lets an AI agent orchestrate parallel workers. Each worker is a git worktree + tmux session + AI agent. You manage them through the `hydra` CLI.

## Install

**Prerequisites:** Node.js 18+, git, tmux (macOS/Linux only).

**Option A — VS Code extension (recommended):**
1. Install the **Hydra Code** extension from the VS Code Marketplace
2. The CLI is auto-installed at `~/.hydra/bin/hydra` on first activation
3. Add to your shell profile (`~/.zshrc`, `~/.bashrc`):
   ```bash
   export PATH="$HOME/.hydra/bin:$PATH"
   ```
4. Verify: `hydra --version`

**Option B — Manual setup:** Run `Hydra: Setup CLI` from the VS Code command palette.

The CLI is a thin wrapper that delegates to the extension's bundled Node.js code — it always stays in sync with the extension version. When VS Code updates the extension, the CLI picks up the new code automatically.

## Quick start

```bash
hydra list --json                                    # What's running?
hydra worker create --repo . --branch feat/foo       # Spawn a worker
hydra worker logs <session> --lines 30               # Read its output
hydra worker send <session> "fix the failing test"   # Send instructions
hydra worker delete <session>                        # Clean up
```

All commands support `--json` (auto-enabled when piped), `--quiet`, and `--no-interactive`.

## CLI reference

### `hydra list`

List all copilots and workers.

```bash
hydra list --json
```

```json
{
  "copilots": [
    { "session": "hydra-copilot-claude", "agent": "claude", "status": "running", "attached": false, "workdir": "/path" }
  ],
  "workers": [
    { "session": "hydra-ab12_feat-auth", "repo": "myapp", "branch": "feat/auth", "agent": "claude", "status": "running", "attached": false, "workdir": "/path/.hydra/worktrees/feat-auth" }
  ],
  "count": 2
}
```

### `hydra worker create`

Create a new worker (or resume if branch exists).

```bash
hydra worker create --repo <path> --branch <name> [--agent claude|codex|gemini] [--base <branch>] [--task "<prompt>"] [--task-file <path>]
```

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--repo` | yes | | Path to the repository |
| `--branch` | yes | | Branch name to create |
| `--agent` | no | `claude` | Agent type |
| `--base` | no | main/master | Base branch to fork from |
| `--task` | no | | Task prompt sent to agent |
| `--task-file` | no | | Path to markdown file with task details |

```json
{ "status": "created", "session": "hydra-ab12_feat-auth", "branch": "feat/auth", "agent": "claude", "workdir": "/repo/.hydra/worktrees/feat-auth" }
```

If the branch already exists, returns `"status": "exists"` and resumes.

### `hydra worker logs <session>`

Read terminal output from a worker.

```bash
hydra worker logs <session> --lines 50
```

```json
{ "session": "hydra-ab12_feat-auth", "lines": 50, "output": "..." }
```

Default: 50 lines. Use `--lines 200` for deeper scrollback.

### `hydra worker send <session> <message>`

Send a message to a worker. Uses double-Enter for reliable delivery.

```bash
hydra worker send <session> "fix the type error in auth.ts"
hydra worker send --all "run the test suite and report status"
```

```json
{ "status": "sent", "session": "hydra-ab12_feat-auth", "message": "..." }
{ "status": "sent", "sessions": ["session1", "session2"], "message": "..." }
```

### `hydra worker stop <session>`

Kill the tmux session but keep the worktree (can restart later).

```json
{ "status": "stopped", "session": "hydra-ab12_feat-auth" }
```

### `hydra worker start <session>`

Restart a stopped worker.

```bash
hydra worker start <session> [--agent <type>]
```

```json
{ "status": "started", "session": "hydra-ab12_feat-auth", "agent": "claude", "workdir": "/path" }
```

### `hydra worker delete <session>`

Kill session + remove worktree + delete branch. Irreversible.

```json
{ "status": "deleted", "session": "hydra-ab12_feat-auth" }
```

## Exit codes

| Code | Meaning | Retryable |
|------|---------|-----------|
| 0 | Success | — |
| 1 | Internal error | yes |
| 2 | Validation error (bad input) | no |
| 4 | Not found (session/worker) | no |
| 5 | Conflict (already exists) | no |

Error JSON (stderr):
```json
{ "error": { "code": 4, "message": "Worker not found", "retryable": false, "hint": "Use \"hydra list --json\" to see available sessions." } }
```

## Copilot workflow

When orchestrating multiple workers, follow this loop:

1. **Plan** — Break the task into independent units of work
2. **Delegate** — `hydra worker create` one worker per unit
3. **Monitor** — `hydra worker logs <session>` to check progress
4. **Review** — `git -C <workdir> diff --stat` to inspect changes
5. **Iterate** — `hydra worker send <session> "<correction>"` if needed
6. **Ship** — Push branches and create PRs for approved work

### Reviewing worker output

```bash
# Check what the worker is doing
hydra worker logs <session> --lines 30

# Inspect the code changes
git -C <workdir> diff --stat
git -C <workdir> diff
git -C <workdir> log --oneline main..HEAD
```

The `workdir` is returned in every create/start/list response.

### Creating PRs from worker branches

```bash
git -C <workdir> push -u origin <branch>
gh pr create -R <owner>/<repo> --head <branch> --title "<title>" --body "<body>"
```

### Cleaning up

1. `hydra list --json` to get all workers
2. Cross-reference with `gh pr list --state all --json headRefName,state` to find merged/closed branches
3. `hydra worker delete <session>` for each (one at a time, not in a loop)

## Rules

- **One branch per worker** — don't reuse sessions for unrelated tasks
- **Be specific in tasks** — include file paths, function names, and acceptance criteria
- **Parallelize independent work** — two non-conflicting tasks = two workers
- **Review before shipping** — always read the full diff before creating a PR
- **Delete one at a time** — bulk deletion can hang the VS Code sidebar
- **Use `--json` for programmatic access** — parse structured output, don't scrape text
