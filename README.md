# TMUX Worktree

**Seamlessly manage tmux sessions alongside git worktrees — right from VS Code.**

![TMUX Worktree Screenshot](https://raw.githubusercontent.com/kargnas/vscode-ext-tmux-worktree/main/docs/screenshot.png)

## Why?

If you use `git worktree` for parallel development and `tmux` for persistent terminal sessions, you know the pain of manually juggling both. This extension bridges the gap:

- **One click** to create a worktree + tmux session together
- **Tree view** showing all worktrees with their tmux status
- **Auto-attach** to the right tmux session when you open a worktree
- **Never lose context** — sessions persist even if VS Code closes

### Perfect for AI Coding Agents

Run AI coding agents (Claude Code, Codex, OpenCode, Gemini CLI) inside tmux sessions. Your agent keeps running in the background — reconnect from anywhere, even from a phone via Termux.

## Features

### 🌳 Explorer View
A dedicated sidebar showing all your git worktrees and their associated tmux sessions at a glance. See session status, pane count, and last activity time.

### ⚡ One-Click Task Creation
Create a new git branch + worktree + tmux session in one step. Start working on a new feature instantly.

### 🔗 Smart Attach
- **Attach in Terminal** — open tmux session in VS Code's integrated terminal
- **Attach in Editor** — embed tmux session as an editor tab
- **Auto-attach** — automatically connect when opening a worktree folder

### 🧹 Orphan Cleanup
Detect and clean up tmux sessions that no longer have matching worktrees. Keep your environment tidy.

### 🖥️ Session Management
- Split panes and create new windows from the context menu
- Copy worktree paths to clipboard
- Open worktrees in new VS Code windows
- Filter sessions by name

## Commands

| Command | Description |
|---------|-------------|
| `TMUX: Attach/Create Session` | Attach to or create a tmux session for the current worktree |
| `TMUX: New Task` | Create a new branch + worktree + tmux session |
| `TMUX: Remove Task` | Remove a worktree and its tmux session |
| `TMUX: Cleanup Orphans` | Remove orphaned tmux sessions |

## Requirements

- **tmux** — must be installed and available in PATH
- **git** — must be installed and available in PATH
- **VS Code** 1.85.0+

## Getting Started

1. Install the extension
2. Open a git repository in VS Code
3. Click the **TMUX** icon in the Activity Bar (sidebar)
4. Your existing worktrees and tmux sessions will appear automatically

To create a new task: click the **+** button in the TMUX panel header, enter a branch name, and you're ready to go.

## How It Works

```
Repository (root)
├── main              → tmux session: "project/main"
├── feature/login     → tmux session: "project/feature-login"
└── fix/bug-123       → tmux session: "project/fix-bug-123"
```

Each worktree gets a dedicated tmux session. Sessions are named based on the repository and branch, so they're easy to find even outside VS Code.

## License

[MIT](LICENSE.md)
