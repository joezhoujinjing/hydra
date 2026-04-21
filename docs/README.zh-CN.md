# TMUX Worktree

**在 VS Code 里同时管理 tmux 会话和 git worktree。**

🌏 **其他语言:** [English](../README.md) | **简体中文** | [繁體中文 (台灣)](README.zh-TW.md) | [繁體中文 (香港)](README.zh-HK.md) | [日本語](README.ja.md)

## 为什么它更“讲究”

- **图片感知终端粘贴**: `Cmd+V` / `Ctrl+Shift+V` 会自动判断剪贴板，文本走普通粘贴，图片走文件路径插入。
- **Remote-SSH 剪贴板桥接**: 本地剪贴板图片可直接粘贴到远程终端，无需手动上传。
- **防冲突会话标识**: 使用 `repo-name + path hash` 命名空间和 slug 去重，避免同名仓库互相冲突。
- **兼容旧会话迁移**: 当 `@workdir` 属于当前仓库时，旧前缀会话仍可识别。
- **No-git 兜底可见性**: 非 git 文件夹也会显示为 `current project (no git)`，树视图不会“空白”。

## 为什么开发这个扩展?

如果你用 `git worktree` 做多分支并行开发,又用 `tmux` 保持终端会话,那你肯定知道手动管理这两个有多麻烦。这个扩展帮你把它们无缝连接起来:

- **一键创建** worktree + tmux 会话
- **树形视图**实时显示所有 worktree 和 tmux 状态
- 打开 worktree 文件夹时**自动连接**对应的 tmux 会话
- **永不丢失上下文** — 关闭 VS Code 后会话依然存在

### 特别适合 AI 编程助手

在 tmux 会话里跑 AI 编程助手(Claude Code、Codex、OpenCode、Gemini CLI)。助手在后台持续工作,随时随地重新连接,甚至可以用手机通过 Termux 接入。

## 主要功能

### 🌳 资源管理器视图
侧边栏专门显示所有 git worktree 及其关联的 tmux 会话。一眼看到会话状态、窗格数量、最近活动时间。

### ⚡ 一键创建任务
一步到位创建新的 git 分支 + worktree + tmux 会话。立即开始新功能开发。

### 🔗 智能连接
- **在终端中连接** — 在 VS Code 集成终端里打开 tmux 会话
- **在编辑器中连接** — 把 tmux 会话作为编辑器标签页打开
- **自动连接** — 打开 worktree 文件夹时自动连接会话

### 🧹 清理孤立会话
检测并清理没有对应 worktree 的 tmux 会话。保持环境整洁。

### 🖥️ 会话管理
- 右键菜单快速分割窗格和创建新窗口
- 复制 worktree 路径到剪贴板
- 在新 VS Code 窗口中打开 worktree
- 按名称筛选会话

### 📋 智能粘贴（图片感知终端粘贴）
- 在终端按 `Cmd+V`（macOS）/ `Ctrl+Shift+V`（Linux）时会先判断剪贴板内容
- 若剪贴板有文本，保持默认粘贴行为
- 若剪贴板有图片，先保存为临时 `.png`，再把文件路径输入到终端
- 支持本地与 Remote-SSH（通过 webview 桥接把本地图片上传到远程主机）
- 命令面板可强制图片粘贴: `TMUX: Paste Image from Clipboard`

### 🧭 会话映射更稳健
- 使用 `repo-name + path hash` 命名空间，避免不同路径下同名仓库冲突
- 当 `@workdir` 指向当前仓库内路径时，旧会话命名仍可兼容识别
- worktree slug 冲突时会自动消歧（父目录名，其后再用路径哈希）
- 非 git 文件夹仍会在树中显示为 `current project (no git)`

## 实际应用场景

### 🤖 用 AI 助手同时开发多个分支
```
项目/
├── main              → tmux: "myapp/main" (Claude Code 重构中)
├── feature/oauth     → tmux: "myapp/feature-oauth" (手动编码)
└── fix/memory-leak   → tmux: "myapp/fix-memory-leak" (Codex 分析中)
```

每个分支独立运行 AI 助手,用 VS Code 查看结果。会话在后台持续工作。

### 🌐 远程服务器开发
通过 SSH 连接到开发服务器:
- 用 VS Code Remote-SSH 连接服务器
- 用 TMUX Worktree 管理各个分支的会话
- SSH 断开后 tmux 会话依然保留
- 在家、在咖啡厅、用手机都能重新连接

### 📱 手机查看代码
用 Termux + SSH 从手机接入:
```bash
ssh dev-server
tmux attach -t myapp/feature-oauth
```
通勤路上也能查看 AI 助手写的代码。

## 命令列表

| 命令 | 说明 |
|------|------|
| `TMUX: Attach/Create Session` | 连接或创建当前 worktree 的 tmux 会话 |
| `TMUX: New Task` | 一键创建新分支 + worktree + tmux 会话 |
| `TMUX: Remove Task` | 删除 worktree 及其 tmux 会话 |
| `TMUX: Cleanup Orphans` | 清理孤立的 tmux 会话 |
| `TMUX: Smart Paste (Image Support)` | 智能终端粘贴: 文本走普通粘贴，图片插入临时文件路径 |
| `TMUX: Paste Image from Clipboard` | 强制读取剪贴板图片并把保存路径输入到当前终端 |

## 最近更新（v1.1.2 - v1.1.6）

- **v1.1.6**: 新增面向 AI CLI 的图片感知终端粘贴（`Cmd+V` / `Ctrl+Shift+V`）和强制图片粘贴命令；同时改进启动时 auto-attach 的终端尺寸稳定性。
- **v1.1.4 - v1.1.5**: attach 时自动启用 clipboard 与 passthrough 相关选项，提升 tmux 剪贴板可靠性。
- **v1.1.3**: 重构旧会话前缀兼容逻辑，迁移更安全。
- **v1.1.2**: 增加 slug 冲突处理与 no-git 工作区标签（`current project (no git)`）。

## 环境要求

- **tmux** — 必须已安装且在 PATH 中
- **git** — 必须已安装且在 PATH 中
- **VS Code** 1.85.0 及以上

## 快速开始

1. 安装扩展
2. 在 VS Code 中打开 git 仓库
3. 点击活动栏(侧边栏)的 **TMUX** 图标
4. 现有的 worktree 和 tmux 会话会自动显示

创建新任务:点击 TMUX 面板标题栏的 **+** 按钮,输入分支名称即可。

## 工作原理

```
仓库 (根目录)
├── main              → tmux 会话: "project-a1b2c3d4_main"
├── feature/login     → tmux 会话: "project-a1b2c3d4_feature-login"
└── fix/bug-123       → tmux 会话: "project-a1b2c3d4_fix-bug-123"
```

每个 worktree 都有专属 tmux 会话。会话名由 `repo-name + path hash` 命名空间和 slug 组成，可避免不同目录下同名仓库互相冲突。

## 了解更多

- [GitHub 仓库](https://github.com/joezhoujinjing/hydra)
- [问题反馈](https://github.com/joezhoujinjing/hydra/issues)

## 开源协议

[MIT](../LICENSE.md)
