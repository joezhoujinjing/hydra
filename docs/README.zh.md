# Hydra

**指挥一支 AI 编程代理军团 — 每个代理在自己的分支、自己的终端中运行，全部通过 VS Code 管控。**

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/kargnas.vscode-tmux-worktree?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)

🌏 **其他语言:** [English](../README.md) | **中文**

**[从 VS Marketplace 安装](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)**

## 什么是 Hydra？

Hydra 把 VS Code 变成并行 AI 开发的控制台。不再只跑一个代理，而是同时启动多个代理 — 每个在独立的 git 分支上、拥有自己的终端会话。

```
项目
├── main            → Copilot (Claude) — 在工作区中结对编程
├── feat/auth       → Worker (Claude) — 从零开始构建 OAuth
├── feat/dashboard  → Worker (Codex) — 创建管理后台
└── fix/perf        → Worker (Gemini) — 性能分析与瓶颈修复
```

所有会话都在 tmux（或 Zellij）中持久运行。关掉 VS Code、从手机 SSH 连入、明天再回来 — 代理依然在工作。

## 核心概念

### Copilot

在当前工作区中运行的一个常驻 AI 代理会话。就像你的结对编程搭档 — 它看到你看到的代码，在当前分支上和你一起工作。

- 每个工作区一个
- 在当前目录运行（无需 worktree）
- VS Code 重启后依然存活

### Worker

拥有独立 git 分支、worktree 和终端会话的一次性 AI 代理。给它一个任务，让它独立工作，你专注做别的事。

- 每个任务/分支一个
- 隔离的 git worktree（不会和你的工作冲突）
- 一步完成：创建分支 + worktree + 会话 + 启动代理
- Worker 创建在 `<repo>/.hydra/worktrees/` 下，保持仓库根目录整洁

## 支持的代理

| 代理 | 命令 | 说明 |
|------|------|------|
| Claude | `claude` | Anthropic 的 Claude Code CLI |
| Codex | `codex` | OpenAI 的 Codex CLI |
| Gemini | `gemini` | Google 的 Gemini CLI |
| Aider | `aider` | 开源 AI 结对编程工具 |
| Custom | 可配置 | 任意 CLI 代理 |

在设置中配置默认代理和命令：

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

## 快速开始

1. 从 VS Marketplace 安装扩展
2. 确保 `tmux` 和 `git` 在 PATH 中
3. 打开活动栏中的 **Hydra** 面板

**启动 Copilot：** 点击 Copilot 按钮（机器人图标）→ 选择代理 → 在工作区中启动。

**创建 Worker：** 点击 Worker 按钮（服务器图标）→ 输入分支名如 `feat/auth` → 选择代理 → 自动创建分支、worktree、会话并启动代理。

## 功能

### 侧边栏树形视图

Hydra 面板让你一目了然地查看所有运行中的内容：

- **Copilot 分组** — 工作区 AI 会话
- **Worker 分组** — 按分支组织的所有 Worker
- **状态指示** — 绿色圆点（活跃）、空心圆（已停止）、警告（缺少 git）
- **会话详情** — 面板数、最近活动时间、CPU 使用率
- **Git 状态** — 未推送的提交数、修改/未跟踪/已删除的文件数

### 智能连接

- **在终端中连接** — 在 VS Code 集成终端中打开会话
- **在编辑器中连接** — 将会话嵌入为编辑器标签页
- **自动连接** — 打开 worktree 文件夹时自动重连
- **尺寸稳定连接** — 连接前同步 PTY 尺寸，避免 80x24 初始渲染问题
- **提示符稳定连接** — 剥离 VS Code shell integration 环境变量，防止 tmux/Zellij 内部渲染异常

### 智能粘贴（图片感知）

在终端中按 `Cmd+V`（macOS）/ `Ctrl+Shift+V`（Linux）会自动判断：
- 剪贴板中是文本 → 正常粘贴
- 剪贴板中是图片 → 保存为临时 `.png` 文件并插入路径

在 Remote-SSH 下同样有效 — 本地剪贴板中的图片会桥接到远程。

### 双后端：tmux + Zellij

在面板标题栏切换 tmux 和 Zellij。两个后端支持相同的功能：会话创建、元数据存储、面板管理、代理生命周期。

### 会话管理

- 从右键菜单分割面板和创建新窗口
- 复制 worktree 路径到剪贴板
- 在新的 VS Code 窗口中打开 worktree
- 按名称筛选会话
- 从现有分支创建 worktree

### 孤儿会话清理

检测并移除没有对应 worktree 的会话。一键保持环境整洁。

### CLI 工具（`hydra-worker`）

无需 VS Code，直接在终端中创建 Worker：

```bash
hydra-worker --repo ~/myapp --branch feat/auth --agent claude --task "实现 OAuth2 登录"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--repo` | 是 | git 仓库路径 |
| `--branch` | 是 | 要创建的分支名 |
| `--agent` | 否 | 代理类型：`claude`、`codex`、`gemini`、`aider`（默认：`claude`） |
| `--base` | 否 | 基准分支覆盖（默认：自动检测） |
| `--task` | 否 | 给代理的初始提示 |

该脚本完整复现了 `Hydra: Create Worker` 的流程 — 分支校验、slug 冲突解决、在 `.hydra/` 下创建 worktree、tmux 会话配置、代理启动。

## 命令

| 命令 | 说明 |
|------|------|
| `Hydra: Create Copilot` | 在当前工作区启动 AI Copilot |
| `Hydra: Create Worker` | 创建新分支 + worktree + 代理会话 |
| `Hydra: Attach/Create Session` | 连接或创建当前 worktree 的会话 |
| `Hydra: Remove Task` | 删除 worktree 及其会话 |
| `Hydra: Cleanup Orphans` | 清理孤儿会话 |
| `Hydra: Smart Paste (Image Support)` | 智能粘贴：文本或图片 |
| `Hydra: Paste Image from Clipboard` | 强制图片粘贴 |

## 实际应用场景

### 并行 AI 开发

```
myapp/
├── main              → Copilot: Claude 帮你 Review PR
├── feat/oauth        → Worker: Claude 构建 OAuth 流程
├── feat/dashboard    → Worker: Codex 生成 UI 组件
└── fix/memory-leak   → Worker: Gemini 性能分析与修复
```

为独立任务启动 Worker，在 VS Code 中查看结果。会话在后台持续运行。

### 远程服务器 + 移动端访问

SSH 连接开发服务器，用 Hydra 管理 Worker，断开连接后会话依然保留。从家里、咖啡馆、手机重新连接：

```bash
ssh dev-server
tmux attach -t myapp-a1b2c3d4_feat-oauth
```

通过 Termux 在通勤路上 Review AI 写的代码。

## 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `hydra.defaultAgent` | `claude` | 新建 Copilot/Worker 的默认代理 |
| `hydra.agentCommands` | `{...}` | 代理类型 → 启动命令映射 |
| `hydra.baseBranch` | 自动检测 | Worker 创建时的基准分支 |
| `tmuxWorktree.multiplexer` | `tmux` | 后端：`tmux` 或 `zellij` |
| `tmuxWorktree.baseBranch` | 自动检测 | 基准分支（旧版） |

## 系统要求

- **tmux**（或 **Zellij**）— 已安装且在 PATH 中
- **git** — 已安装且在 PATH 中
- **VS Code** 1.85.0+

## 工作原理

```
仓库
├── main                → 会话: "project-a1b2c3d4_main"
├── feat/auth           → 会话: "project-a1b2c3d4_feat-auth"    [Worker: Claude]
└── fix/bug-123         → 会话: "project-a1b2c3d4_fix-bug-123"  [Worker: Codex]
                        → 会话: "hydra-copilot"                  [Copilot: Claude]
```

**Worker** 各自拥有专属的 git worktree + 终端会话。会话名称使用 `repo-name + path-hash` 命名空间，防止同名仓库之间的冲突。Worktree 默认创建在 `<repo>/.hydra/worktrees/` 下。

**Copilot** 是绑定到工作区目录的单个全局会话（`hydra-copilot`）— 不需要 worktree。

Copilot 和 Worker 都将角色和代理类型存储为会话元数据，以便 Hydra 在树形视图中显示正确的状态。

## 许可证

[MIT](../LICENSE.md)
