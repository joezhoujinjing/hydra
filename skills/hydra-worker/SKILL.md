# Skill: hydra-worker

Create a new Hydra worker (git worktree + tmux session + AI agent) from natural language.

## Invocation

The user says something like:
- "create a worker for feat/auth on sudowork"
- "spin up a worker on hydra for fix/bug-123 with codex"
- "new hydra worker branch feat/new-ui repo ~/code/myproject"
- "worker on myapp: implement OAuth2 login on branch feat/oauth"

## Instructions

1. **Parse the user's request** to extract:
   - **repo**: A path or short name (e.g., "sudowork", "hydra", "~/code/foo")
   - **branch**: The git branch to create (e.g., "feat/auth", "fix/bug-123")
   - **agent** (optional): Agent type — `claude` (default), `codex`, `gemini`, `aider`
   - **task** (optional): Initial prompt/instructions for the agent

2. **Resolve repo name to path** if not an absolute path:
   - Search in `~/code/<name>` first
   - Then try the current working directory if it matches
   - If ambiguous, ask the user

3. **Run the command**:
   ```bash
   hydra-worker --repo <resolved_path> --branch <branch> --agent <agent> --task "<task>"
   ```

   Omit `--task` if the user didn't provide one. Omit `--agent` to use the default (`claude`).

4. **Report the result** — show session name and worktree path on success, or the error on failure.

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
→ (use current working directory as repo)
```bash
hydra-worker --repo $(pwd) --branch task/refactor-api --agent claude
```

User: "worker on myapp feat/dashboard: build an admin dashboard with user CRUD"
```bash
hydra-worker --repo ~/code/myapp --branch feat/dashboard --agent claude --task "build an admin dashboard with user CRUD"
```
