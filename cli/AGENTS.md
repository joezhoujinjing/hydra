# Hydra CLI (Go)

**Command**: `hydra`

Legacy Go TUI for managing tmux sessions and git worktrees. The primary CLI is now the Node.js version in the root package (`out/cli/index.js`).

## Build

```bash
cd cli && go build -o hydra-tui ./main.go
```

## Naming Conventions

Session and worktree naming must match the VS Code extension exactly:

- **Session Name**: `{repoName}-{pathHash}_{slug}`
- **Slug**: `basename(worktreePath)`, sanitized (`/` → `-`)
- **Primary worktree**: slug = `main`
- **Root detection**: Compare against primary worktree path from `git rev-parse --git-common-dir`

## Tech Stack

- **Language**: Go
- **TUI**: [Bubble Tea](https://github.com/charmbracelet/bubbletea)
- **Git**: `os/exec` with `git worktree list --porcelain`
