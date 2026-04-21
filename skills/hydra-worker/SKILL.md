---
name: hydra-worker
description: "Create a new Hydra worker (git worktree + tmux session + AI agent) from natural language. Use when the user asks to spawn, create, or spin up a worker on a repo/branch. Parses repo name, branch, agent type, and optional task prompt, then runs hydra-worker CLI."
---

# Hydra Worker

Parse natural language to spawn a Hydra worker via `hydra-worker` CLI.

## Workflow

1. **Parse the request** to extract:
   - **repo**: Path or short name (e.g., `myapp`, `~/code/foo`)
   - **branch**: Git branch to create (e.g., `feat/auth`, `fix/bug-123`)
   - **agent** (optional): `claude` (default), `codex`, `gemini`, `aider`
   - **task** (optional): Initial prompt for the agent

2. **Resolve repo name** if not an absolute path:
   - Try `~/code/<name>` first
   - Fall back to current working directory if it matches
   - Ask the user if ambiguous

3. **Run the command**:
   ```bash
   hydra-worker --repo <resolved_path> --branch <branch> --agent <agent> --task "<task>"
   ```
   Omit `--task` if not provided. Omit `--agent` to use the default.

4. **Report** session name and worktree path on success, or the error on failure.

## Examples

User: "create a worker for feat/auth on sudowork"
```bash
hydra-worker --repo ~/code/sudowork --branch feat/auth --agent claude
```

User: "spin up a codex worker on hydra for fix/scroll-bug"
```bash
hydra-worker --repo ~/code/hydra --branch fix/scroll-bug --agent codex
```

User: "new worker branch task/refactor-api"
```bash
hydra-worker --repo $(pwd) --branch task/refactor-api --agent claude
```

User: "worker on myapp feat/dashboard: build an admin dashboard with user CRUD"
```bash
hydra-worker --repo ~/code/myapp --branch feat/dashboard --agent claude --task "build an admin dashboard with user CRUD"
```
