<p align="center">
  <img src="resources/logo.jpg" alt="Hydra" width="600" />
</p>

<h1 align="center">Hydra</h1>

<p align="center"><strong>Command an army of AI coding agents — each on its own branch, in its own terminal, all visible from VS Code.</strong></p>

🌏 **Read this in other languages:** **English** | [中文](docs/README.zh.md)

## Why Hydra?

Modern AI coding agents are powerful — but one agent at a time is a bottleneck.
Hydra turns VS Code into a **command center** where you orchestrate many agents in parallel, each isolated on its own git branch, each visible in a single sidebar.

**You are the orchestrator. Your agents are the army.**

```
Your Project
├── main            → Copilot (Claude) — orchestrating the work, reviewing PRs
├── feat/auth       → Worker (Claude) — building OAuth from scratch
├── feat/dashboard  → Worker (Codex) — creating the admin dashboard
├── fix/perf        → Worker (Gemini) — profiling and fixing bottlenecks
└── feat/api-tests  → Worker (Claude) — writing integration tests
```

Every session persists in tmux (or Zellij). Close VS Code, SSH from your phone, come back tomorrow — your agents are still running.

## Hero Use Case: The Parity Port

Imagine you need to port 40 features from one codebase to another. Doing it sequentially takes weeks. With Hydra:

1. **Copilot** (on `main`) analyzes the master issue, breaks it into 8 independent tasks
2. **Copilot** spawns 8 Workers — one per feature group — each on its own branch
3. All 8 Workers implement their features **simultaneously**
4. **Copilot** monitors progress, reviews diffs, sends follow-up instructions
5. You merge PRs as they complete — what took weeks now takes hours

```
codebase/
├── main               → Copilot: breaking down the master issue, reviewing PRs
├── port/auth          → Worker: porting authentication (3 features)
├── port/billing       → Worker: porting billing flow (5 features)
├── port/notifications → Worker: porting notification system (4 features)
├── port/search        → Worker: porting search & filters (6 features)
├── port/settings      → Worker: porting user settings (3 features)
├── port/analytics     → Worker: porting analytics dashboard (5 features)
├── port/export        → Worker: porting data export (4 features)
└── port/onboarding    → Worker: porting onboarding flow (3 features)
```

> See the full walkthrough in [examples/parity-port.md](examples/parity-port.md).

## Core Concepts

### The Orchestrator: Copilot

A persistent AI agent session in your current workspace. The Copilot acts as your **tech lead** — it plans work, spawns Workers, monitors their progress, reviews their output, and coordinates merges.

- One per workspace — runs on your current branch
- No worktree needed — it works in your existing directory
- Survives VS Code restarts via tmux/Zellij
- Can spawn and manage Workers via the [Hydra CLI](#cli-tool-hydra)

### The Army: Workers

Disposable AI agents that each get their own git branch, worktree, and terminal session. Give a Worker a task and it works independently — no conflicts with your code or other Workers.

- One per task — isolated git worktree per branch
- Auto-creates branch + worktree + session + launches agent in one step
- Workers live under `<repo>/.hydra/worktrees/` to keep your repo root clean
- Run with auto-approved permissions for autonomous operation

### The Mental Model

```
┌─────────────────────────────────────────────────┐
│                   VS Code                        │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │  Hydra       │  │  Editor / Terminal Tabs   │  │
│  │  Sidebar     │  │                          │  │
│  │             │  │  ┌────────────────────┐  │  │
│  │  Copilots   │  │  │ Worker: feat/auth  │  │  │
│  │   ● Claude  │  │  │ (Claude running)   │  │  │
│  │             │  │  └────────────────────┘  │  │
│  │  Workers    │  │  ┌────────────────────┐  │  │
│  │   ● auth   │  │  │ Worker: feat/api   │  │  │
│  │   ● api    │  │  │ (Codex running)    │  │  │
│  │   ● perf   │  │  └────────────────────┘  │  │
│  │   ○ docs   │  │                          │  │
│  └─────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │                      │
         ▼                      ▼
   Live status:           tmux/Zellij sessions
   pane count,            persist independently
   CPU, git diff          of VS Code
```

## Supported Agents

| Agent | Command | Description |
|-------|---------|-------------|
| Claude | `claude` | Anthropic's Claude Code CLI |
| Codex | `codex --full-auto` | OpenAI's Codex CLI |
| Gemini | `gemini` | Google's Gemini CLI |
| Custom | configurable | Any CLI agent you want |

Configure default agent and commands in settings:

```json
{
  "hydra.defaultAgent": "claude",
  "hydra.agentCommands": {
    "claude": "claude",
    "codex": "codex --full-auto",
    "gemini": "gemini"
  }
}
```

## Getting Started

1. Install the extension from [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=zhoujinjing.hydra-code)
2. Make sure `tmux` and `git` are available in PATH
3. Open the **Hydra** panel in the Activity Bar

**Launch a Copilot:** Click the Copilot button (robot icon) → pick an agent → it starts in your workspace.

**Spawn a Worker:** Click the Worker button (server icon) → enter a branch name like `feat/auth` → pick an agent → it creates the branch, worktree, session, and launches the agent automatically.

## Features

### Agent Visibility: Sidebar Tree View

The Hydra panel is your command center — see every agent's status at a glance:

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

### CLI Tool (`hydra`)

Create workers directly from your terminal — or let your Copilot agent spawn them programmatically:

```bash
hydra worker create --repo ~/myapp --branch feat/auth --agent claude --task "implement OAuth2 login"
```

| Flag | Required | Description |
|------|----------|-------------|
| `--repo` | yes | Path to the git repository |
| `--branch` | yes | Branch name to create |
| `--agent` | no | Agent type: `claude`, `codex`, `gemini` (default: `claude`) |
| `--base` | no | Base branch override (default: auto-detect) |
| `--task` | no | Initial prompt to give the agent |

The CLI mirrors the full `Hydra: Create Worker` flow — branch validation, slug collision resolution, worktree creation under `.hydra/`, tmux session setup, and agent launch.

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

### Parity Port — Parallelize a Large Migration

Break a 40-feature migration into 8 parallel Workers. Your Copilot orchestrates the work while Workers implement independently. [Full example →](examples/parity-port.md)

### Cross-Language Code Generation

Generate TypeScript clients from Rust gRPC services. One Worker generates protobuf bindings, another builds the TS client, a third writes integration tests. [Full example →](examples/grpc-generation.md)

### Reliable Subagent Lifecycle

Spawn Workers from a Copilot, monitor their scrollback for completion signals, and `await` their results before proceeding. [Full example →](examples/agent-await.md)

### Remote Server + Mobile Access

SSH into a dev server, manage workers with Hydra, disconnect — sessions persist. Reconnect from home, a cafe, or your phone:

```bash
ssh dev-server
tmux attach -t myapp-a1b2c3d4_feat-oauth
```

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

## Security Note

Worker agents run with **auto-approved permissions** (e.g., `--dangerously-skip-permissions` for Claude). This means workers can execute shell commands, read/write files, and make network requests without prompting. This is by design for autonomous operation, but you should:

- Only run workers in trusted repositories
- Review worker diffs before merging (`git diff` in the worktree)
- Use isolated environments (containers, VMs) for untrusted workloads

## License

[MIT](LICENSE.md)
