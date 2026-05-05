<p align="center">
  <img src="resources/logo.jpg" alt="Hydra" width="600" />
</p>

<h1 align="center">Hydra</h1>

<p align="center">
  <strong>Grow heads. Ship faster.</strong><br>
  Orchestrate an army of parallel AI agents directly from VS Code.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=zhoujinjing.hydra-code">
    <img src="https://vsmarketplacebadges.dev/version/zhoujinjing.hydra-code.svg" alt="Marketplace" />
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=zhoujinjing.hydra-code">
    <img src="https://vsmarketplacebadges.dev/installs/zhoujinjing.hydra-code.svg" alt="Installs" />
  </a>
  <a href="LICENSE.md">
    <img src="https://img.shields.io/github/license/joezhoujinjing/hydra" alt="License" />
  </a>
</p>

🌏 **Read this in other languages:** **English** | [中文](docs/README.zh.md)

---

## The Vision

In Greek mythology, the Hydra was a beast that grew two heads for every one cut off. In software engineering, we face a similar "beast": a mountain of tasks that grows faster than we can code.

**Hydra** turns this metaphor on its head. Instead of struggling against the growth, you embrace it. You become the central nervous system, spawning and orchestrating as many AI agent "heads" as you need. One head builds the auth, another optimizes the database, a third writes the tests — all working simultaneously, all visible from your sidebar.

**Stop working sequentially. Start working in parallel.**

---

## A Story of Parallel Power

Imagine you're porting 40 features from an old codebase. Doing it alone is a weeks-long slog. With Hydra, it looks like this:

1. **Spawn a Copilot** on your `main` branch. You tell it: "Analyze these 40 features and break them into 8 logical groups."
2. **Delegate to Workers.** With a single command, your Copilot spawns 8 Workers. Each gets its own git branch, its own isolated worktree, and its own AI agent (Claude, Gemini, or Codex).
3. **Orchestrate.** You watch your sidebar. 8 terminals are alive. 8 agents are coding. You see their CPU usage, their git diffs, and their progress in real-time.
4. **Review & Ship.** As Workers finish, you review their diffs, merge their branches, and move on.

**What took weeks now takes hours.**

```text
[ YOU: THE ARCHITECT ]
         │
         ▼
 [ COPILOT (main) ] ──────────────────┐
 (Plans, Monitors, Reviews)           │
         │                            │
         ├─> [ WORKER 1 (feat/auth) ] ─┼─> "Building OAuth2 flow..."
         ├─> [ WORKER 2 (feat/ui)   ] ─┼─> "Styling the dashboard..."
         ├─> [ WORKER 3 (fix/perf)  ] ─┼─> "Optimizing DB queries..."
         └─> [ WORKER 4 (docs/api)  ] ─┼─> "Generating OpenAPI docs..."
                                      │
                                [ THE ARMY ]
```

---

## Why Hydra?

- **The Serial Bottleneck:** Switching between tasks is expensive. Waiting for one AI agent to finish before starting the next is a waste of your most precious resource: time.
- **Context is King:** Hydra isolates agents in their own git worktrees. No more "agent halluncinations" because they saw unrelated code. No more git conflicts because two agents touched the same file in the same directory.
- **Persistent Souls:** Every agent lives in a `tmux` session. Close VS Code, restart your computer, or SSH in from your phone — your agents are still there, working for you.

---

## First Five Minutes

Want a safe, self-contained tour before pointing Hydra at a real repository?

```bash
./quickstart/run.sh
```

The quickstart boots a temporary isolated Hydra home, scaffolds a local demo repository inside that sandbox, and launches 3 parallel workers against it. No GitHub repo setup required. See [quickstart/README.md](quickstart/README.md) for the full flow.

---

## Quick Start (60 Seconds)

1. **Install:** Search for **"Hydra Code"** in the VS Code Marketplace.
2. **Prerequisites:** Ensure `tmux` and `git` are installed on your system.
3. **Launch Copilot:** Open the Hydra sidebar (robot icon) and click **"Create Copilot"**.
4. **Spawn your first Worker:** 
   - Click **"Create Worker"**.
   - Name your branch (e.g., `feat/my-new-idea`).
   - Choose an agent (e.g., `claude`).
   - **Watch the magic happen.**

---

## Capabilities

### 🏛️ The Command Center (Sidebar)
Your sidebar is no longer just a file explorer. It's a high-fidelity dashboard for your AI army.
- **Live Vitals:** See CPU usage, terminal activity, and pane counts for every agent.
- **Git Intelligence:** Track how many commits every worker is ahead of main, and see exactly how many files they've touched.
- **One-Click Attach:** Jump into any agent's terminal or embed it directly as an editor tab.

### 💂 The Army (Workers & Worktrees)
Hydra automates the heavy lifting of git management.
- **Isolated Worktrees:** Every worker gets a dedicated directory under `~/.hydra/worktrees/` (outside the repo). They won't mess with your primary workspace.
- **Autonomous Mode:** Workers can be launched with auto-approved permissions, letting them work while you sleep.

### 🧠 The Brain (Copilots)
A Copilot is your tech lead. It doesn't need a worktree; it lives in your current folder and uses the `hydra` CLI to manage your workers.

### 🖇️ Smart Tools
- **CLI-First:** The `hydra` command lets you (and your agents) control everything from the terminal.
- **Smart Paste:** Copy an image? `Cmd+V` in the terminal saves it and inserts the path. Perfect for showing UI bugs to your agents.

---

## Reference & Documentation

- [**AGENTS.md**](AGENTS.md) — The full "Agent Operating Manual" (CLI reference, internal architecture, and advanced config).
- [**Examples**](examples/) — Real-world scenarios like [Parity Ports](examples/parity-port.md) and [gRPC Generation](examples/grpc-generation.md).
- [**Changelog**](CHANGELOG.md) — See what's new in the latest version.

## Requirements
- **tmux** — The engine of persistence.
- **git** — The foundation of isolation.
- **VS Code 1.85.0+**

## License
[MIT](LICENSE.md) — Built with ❤️ for the future of AI-native development.
