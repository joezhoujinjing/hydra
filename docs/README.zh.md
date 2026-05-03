# Hydra

**指挥一支 AI 编程代理军团 — 每个代理在自己的分支、自己的终端中运行，全部通过 VS Code 可视化管控。**

🌏 **其他语言:** [English](../README.md) | **中文**

## 为什么选择 Hydra？

现代 AI 编程代理很强大 — 但一次只跑一个就是瓶颈。
Hydra 把 VS Code 变成一个**指挥中心**，让你并行编排多个代理，每个代理隔离在自己的 git 分支上，全部在一个侧边栏中可见。

**你是指挥官。你的代理是军团。**

```
项目
├── main            → Copilot (Claude) — 编排工作、审查 PR
├── feat/auth       → Worker (Claude) — 从零构建 OAuth
├── feat/dashboard  → Worker (Codex) — 创建管理后台
├── fix/perf        → Worker (Gemini) — 性能分析与瓶颈修复
└── feat/api-tests  → Worker (Claude) — 编写集成测试
```

所有会话都在 tmux 中持久运行。关掉 VS Code、从手机 SSH 连入、明天再回来 — 代理依然在工作。

## 标杆用例：功能平移

假设你需要将 40 个功能从一个代码库迁移到另一个。顺序执行需要几周。用 Hydra：

1. **Copilot**（在 `main` 上）分析主任务，拆解为 8 个独立子任务
2. **Copilot** 启动 8 个 Worker — 每个负责一组功能 — 各自在独立分支上
3. 8 个 Worker **同时**实现各自的功能
4. **Copilot** 监控进度、审查 diff、发送后续指令
5. 你逐个合并 PR — 原本需要数周的工作，现在只需数小时

```
codebase/
├── main               → Copilot: 拆解主任务、审查 PR
├── port/auth          → Worker: 迁移认证功能（3 个特性）
├── port/billing       → Worker: 迁移账单流程（5 个特性）
├── port/notifications → Worker: 迁移通知系统（4 个特性）
├── port/search        → Worker: 迁移搜索与筛选（6 个特性）
├── port/settings      → Worker: 迁移用户设置（3 个特性）
├── port/analytics     → Worker: 迁移数据分析面板（5 个特性）
├── port/export        → Worker: 迁移数据导出（4 个特性）
└── port/onboarding    → Worker: 迁移新手引导（3 个特性）
```

> 完整演练请参阅 [examples/parity-port.md](../examples/parity-port.md)。

## 核心概念

### 指挥官：Copilot

在当前工作区中运行的常驻 AI 代理会话。Copilot 充当你的**技术负责人** — 规划工作、启动 Worker、监控进度、审查产出、协调合并。

- 每个工作区一个 — 在当前分支上运行
- 无需 worktree — 在现有目录中工作
- 通过 tmux 在 VS Code 重启后依然存活
- 可通过 [Hydra CLI](#cli-工具hydra) 启动和管理 Worker

### 军团：Workers

拥有独立 git 分支、worktree 和终端会话的一次性 AI 代理。给 Worker 一个任务，它就独立工作 — 不会与你的代码或其他 Worker 产生冲突。

- 每个任务一个 — 每个分支一个隔离的 git worktree
- 一步完成：创建分支 + worktree + 会话 + 启动代理
- Worker 创建在 `<repo>/.hydra/worktrees/` 下，保持仓库根目录整洁
- 以自动批准权限运行，实现自主操作

### 心智模型

```
┌─────────────────────────────────────────────────┐
│                   VS Code                        │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │  Hydra       │  │  编辑器 / 终端标签页      │  │
│  │  侧边栏     │  │                          │  │
│  │             │  │  ┌────────────────────┐  │  │
│  │  Copilots   │  │  │ Worker: feat/auth  │  │  │
│  │   ● Claude  │  │  │ (Claude 运行中)    │  │  │
│  │             │  │  └────────────────────┘  │  │
│  │  Workers    │  │  ┌────────────────────┐  │  │
│  │   ● auth   │  │  │ Worker: feat/api   │  │  │
│  │   ● api    │  │  │ (Codex 运行中)     │  │  │
│  │   ● perf   │  │  └────────────────────┘  │  │
│  │   ○ docs   │  │                          │  │
│  └─────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │                      │
         ▼                      ▼
   实时状态：              tmux 会话
   面板数、CPU、           独立于 VS Code
   git diff               持久运行
```

## 支持的代理

| 代理 | 命令 | 说明 |
|------|------|------|
| Claude | `claude` | Anthropic 的 Claude Code CLI |
| Codex | `codex --full-auto` | OpenAI 的 Codex CLI |
| Gemini | `gemini` | Google 的 Gemini CLI |
| Custom | 可配置 | 任意 CLI 代理 |

在设置中配置默认代理和命令：

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

## 快速开始

1. 从 [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=zhoujinjing.hydra-code) 安装扩展
2. 确保 `tmux` 和 `git` 在 PATH 中
3. 打开活动栏中的 **Hydra** 面板

**启动 Copilot：** 点击 Copilot 按钮（机器人图标）→ 选择代理 → 在工作区中启动。

**创建 Worker：** 点击 Worker 按钮（服务器图标）→ 输入分支名如 `feat/auth` → 选择代理 → 自动创建分支、worktree、会话并启动代理。

## 功能

### 代理可视化：侧边栏树形视图

Hydra 面板是你的指挥中心 — 一目了然地查看每个代理的状态：

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
- **提示符稳定连接** — 剥离 VS Code shell integration 环境变量，防止 tmux 内部渲染异常

### 智能粘贴（图片感知）

在终端中按 `Cmd+V`（macOS）/ `Ctrl+Shift+V`（Linux）会自动判断：
- 剪贴板中是文本 → 正常粘贴
- 剪贴板中是图片 → 保存为临时 `.png` 文件并插入路径

在 Remote-SSH 下同样有效 — 本地剪贴板中的图片会桥接到远程。

### 会话管理

- 从右键菜单分割面板和创建新窗口
- 复制 worktree 路径到剪贴板
- 在新的 VS Code 窗口中打开 worktree
- 按名称筛选会话
- 从现有分支创建 worktree

### 孤儿会话清理

检测并移除没有对应 worktree 的会话。一键保持环境整洁。

### CLI 工具（`hydra`）

无需 VS Code，直接在终端中创建 Worker — 也可以让 Copilot 代理程序化地调用：

```bash
hydra worker create --repo ~/myapp --branch feat/auth --agent claude --task "实现 OAuth2 登录"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--repo` | 是 | git 仓库路径 |
| `--branch` | 是 | 要创建的分支名 |
| `--agent` | 否 | 代理类型：`claude`、`codex`、`gemini`（默认：`claude`） |
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

### 功能平移 — 并行化大规模迁移

将 40 个功能的迁移拆解为 8 个并行 Worker。Copilot 编排工作，Worker 独立实现。[完整示例 →](../examples/parity-port.md)

### 跨语言代码生成

从 Rust gRPC 服务生成 TypeScript 客户端。一个 Worker 生成 protobuf 绑定，另一个构建 TS 客户端，第三个编写集成测试。[完整示例 →](../examples/grpc-generation.md)

### 可靠的子代理生命周期

从 Copilot 启动 Worker，监控其滚动缓冲区的完成信号，`await` 结果后再继续。[完整示例 →](../examples/agent-await.md)

### 远程服务器 + 移动端访问

SSH 连接开发服务器，用 Hydra 管理 Worker，断开连接后会话依然保留。从家里、咖啡馆、手机重新连接：

```bash
ssh dev-server
tmux attach -t myapp-a1b2c3d4_feat-oauth
```

## 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `hydra.defaultAgent` | `claude` | 新建 Copilot/Worker 的默认代理 |
| `hydra.agentCommands` | `{...}` | 代理类型 → 启动命令映射 |
| `hydra.baseBranch` | 自动检测 | Worker 创建时的基准分支 |
| `tmuxWorktree.multiplexer` | `tmux` | 后端：`tmux` |
| `tmuxWorktree.baseBranch` | 自动检测 | 基准分支（旧版） |

## 系统要求

- **tmux** — 已安装且在 PATH 中
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

## 安全提示

Worker 代理以**自动批准权限**运行（例如 Claude 的 `--dangerously-skip-permissions`）。这意味着 Worker 可以执行 shell 命令、读写文件和发起网络请求，无需确认。这是为自主操作而设计的，但你应该：

- 仅在受信任的仓库中运行 Worker
- 合并前审查 Worker 的 diff（在 worktree 中运行 `git diff`）
- 对不受信任的工作负载使用隔离环境（容器、虚拟机）

## 许可证

[MIT](../LICENSE.md)
