# Hydra

**Command an army of AI coding agents — each on its own branch, in its own terminal, all from VS Code.**

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/kargnas.vscode-tmux-worktree?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)

🌏 **Read this in other languages:** **English** | [한국어](docs/README.ko.md)

**[Install from VS Marketplace](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)**

## What is Hydra?

Hydra turns VS Code into a control panel for parallel AI development. Instead of running one agent at a time, spin up multiple agents — each working on a separate git branch in its own terminal session.

```
Your Project
├── main            → Copilot (Claude) — pair-programming in your workspace
├── feat/auth       → Worker (Claude) — building OAuth from scratch
├── feat/dashboard  → Worker (Codex) — creating the admin dashboard
└── fix/perf        → Worker (Gemini) — profiling and fixing bottlenecks
```

Every session persists in tmux (or Zellij). Close VS Code, SSH from your phone, come back tomorrow — your agents are still running.

## Core Concepts

### Copilot

A single persistent AI agent session in your current workspace. Think of it as your pair-programming partner — it sees the same code you do and works alongside you on the current branch.

- One per workspace
- Runs in your current directory (no worktree needed)
- Stays alive across VS Code restarts

### Worker

A disposable AI agent that gets its own git branch, its own worktree, and its own terminal session. Give it a task and let it work independently while you focus on something else.

- One per task/branch
- Isolated git worktree (no conflicts with your work)
- Auto-creates branch + worktree + session + launches agent in one step
- Workers live under `<repo>/.hydra/worktrees/` to keep your repo root clean

## Supported Agents

| Agent | Command | Description |
|-------|---------|-------------|
| Claude | `claude` | Anthropic's Claude Code CLI |
| Codex | `codex` | OpenAI's Codex CLI |
| Gemini | `gemini` | Google's Gemini CLI |
| Aider | `aider` | Open-source AI pair programming |
| Custom | configurable | Any CLI agent you want |

Configure default agent and commands in settings:

```json
{
  "hydra.defaultAgent": "claude",
  "hydra.agentCommands": {
    "claude": "claude",
    "codex": "codex",
    "gemini": "gemini",
    "aider": "aider"
  }
}
```

## Getting Started

1. Install the extension from VS Marketplace
2. Make sure `tmux` and `git` are available in PATH
3. Open the **Hydra** panel in the Activity Bar

**Launch a Copilot:** Click the Copilot button (robot icon) → pick an agent → it starts in your workspace.

**Spawn a Worker:** Click the Worker button (server icon) → enter a branch name like `feat/auth` → pick an agent → it creates the branch, worktree, session, and launches the agent automatically.

## Features

### Sidebar Tree View

The Hydra panel gives you a live overview of everything running:

- **Copilot group** — your workspace AI session
- **Worker group** — all active workers organized by branch
- **Status indicators** — green circle (active), outline (stopped), warning (git missing)
- **Session details** — pane count, last activity, CPU usage
- **Git status** — commits ahead, modified/untracked/deleted file counts

### Smart Attach

- **Attach in Terminal** — open a session in VS Code's integrated terminal
- **Attach in Editor** — embed a session as an editor tab
- **Auto-attach** — automatically reconnect when opening a worktree folder
- **Size-stable attach** — syncs PTY size before attaching to avoid 80x24 first-paint issues
- **Prompt-stable attach** — strips VS Code shell-integration env vars to prevent rendering corruption inside tmux/Zellij

### Smart Paste (Image-Aware)

`Cmd+V` (macOS) / `Ctrl+Shift+V` (Linux) in the terminal does the right thing:
- Text in clipboard → normal paste
- Image in clipboard → saves as temp `.png` and inserts the file path

Works over Remote-SSH too — clipboard images are bridged from local to remote.

### Dual Backend: tmux + Zellij

Switch between tmux and Zellij from the panel header. Both backends support the same features: session creation, metadata storage, pane management, and agent lifecycle.

### Session Management

- Split panes and create windows from context menu
- Copy worktree paths to clipboard
- Open worktrees in new VS Code windows
- Filter sessions by name
- Create worktree from an existing branch

### Orphan Cleanup

Detect and remove tmux sessions that no longer have matching worktrees. One click to keep your environment tidy.

### CLI Tool (`hydra-worker`)

Create workers directly from your terminal without VS Code:

```bash
hydra-worker --repo ~/myapp --branch feat/auth --agent claude --task "implement OAuth2 login"
```

| Flag | Required | Description |
|------|----------|-------------|
| `--repo` | yes | Path to the git repository |
| `--branch` | yes | Branch name to create |
| `--agent` | no | Agent type: `claude`, `codex`, `gemini`, `aider` (default: `claude`) |
| `--base` | no | Base branch override (default: auto-detect) |
| `--task` | no | Initial prompt to give the agent |

The script mirrors the full `Hydra: Create Worker` flow — branch validation, slug collision resolution, worktree creation under `.hydra/`, tmux session setup, and agent launch.

## Commands

| Command | Description |
|---------|-------------|
| `Hydra: Create Copilot` | Launch an AI copilot in your current workspace |
| `Hydra: Create Worker` | Create a new branch + worktree + agent session |
| `Hydra: Attach/Create Session` | Attach to or create a session for the current worktree |
| `Hydra: Remove Task` | Remove a worktree and its session |
| `Hydra: Cleanup Orphans` | Remove orphaned sessions |
| `Hydra: Smart Paste (Image Support)` | Smart paste: text or image |
| `Hydra: Paste Image from Clipboard` | Force image paste into terminal |

## Real-World Workflows

### Parallel AI Development

```
myapp/
├── main              → Copilot: Claude helping you review PRs
├── feat/oauth        → Worker: Claude building the OAuth flow
├── feat/dashboard    → Worker: Codex generating UI components
└── fix/memory-leak   → Worker: Gemini profiling and patching
```

Fire off workers for independent tasks. Check results in VS Code. Sessions keep running in the background.

### Remote Server + Mobile Access

SSH into a dev server, manage workers with Hydra, disconnect — sessions persist. Reconnect from home, a cafe, or your phone:

```bash
ssh dev-server
tmux attach -t myapp-a1b2c3d4_feat-oauth
```

Review AI-written code during your commute via Termux.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `hydra.defaultAgent` | `claude` | Default agent for new copilot/worker sessions |
| `hydra.agentCommands` | `{...}` | Map of agent type → shell command |
| `hydra.baseBranch` | auto-detect | Override base branch for new workers |
| `tmuxWorktree.multiplexer` | `tmux` | Backend: `tmux` or `zellij` |
| `tmuxWorktree.baseBranch` | auto-detect | Override base branch (legacy) |

## Requirements

- **tmux** (or **Zellij**) — installed and in PATH
- **git** — installed and in PATH
- **VS Code** 1.85.0+

## How It Works

```
Repository
├── main                → session: "project-a1b2c3d4_main"
├── feat/auth           → session: "project-a1b2c3d4_feat-auth"    [Worker: Claude]
└── fix/bug-123         → session: "project-a1b2c3d4_fix-bug-123"  [Worker: Codex]
                        → session: "hydra-copilot"                  [Copilot: Claude]
```

**Workers** each get a dedicated git worktree + terminal session. Session names use a `repo-name + path-hash` namespace for collision safety across same-name repos. Worktrees are stored under `<repo>/.hydra/worktrees/` by default.

**Copilot** gets a single global session (`hydra-copilot`) tied to your workspace directory — no worktree needed.

Both Copilot and Worker sessions store their role and agent type as session metadata, so Hydra can display the right status in the tree view.

## License

[MIT](LICENSE.md)
