# TMUX Worktree

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/kargnas.vscode-tmux-worktree?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree) [![Blog](https://img.shields.io/badge/Blog-kargn.as-green)](https://kargn.as)
**在 VS Code 裡同時管理 tmux 工作階段和 git worktree。**

🌏 **其他語言:** [English](../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | **繁體中文 (台灣)** | [繁體中文 (香港)](README.zh-HK.md) | [日本語](README.ja.md)

![TMUX Worktree 截圖](https://raw.githubusercontent.com/kargnas/vscode-ext-tmux-worktree/main/docs/screenshot.png)

## 為什麼要開發這個擴充功能?

如果你用 `git worktree` 做多分支平行開發,又用 `tmux` 保持終端工作階段,那你一定知道手動管理這兩個有多麻煩。這個擴充功能幫你把它們無縫整合:

- **一鍵建立** worktree + tmux 工作階段
- **樹狀檢視**即時顯示所有 worktree 和 tmux 狀態
- 開啟 worktree 資料夾時**自動連線**對應的 tmux 工作階段
- **永不遺失工作脈絡** — 關閉 VS Code 後工作階段依然存在

### 特別適合 AI 程式助手

在 tmux 工作階段裡執行 AI 程式助手(Claude Code、Codex、OpenCode、Gemini CLI)。助手在背景持續工作,隨時隨地重新連線,甚至可以用手機透過 Termux 存取。

## 主要功能

### 🌳 檔案總管檢視
側邊欄專門顯示所有 git worktree 及其關聯的 tmux 工作階段。一眼看到工作階段狀態、窗格數量、最近活動時間。

### ⚡ 一鍵建立任務
一步到位建立新的 git 分支 + worktree + tmux 工作階段。立即開始新功能開發。

### 🔗 智慧連線
- **在終端機中連線** — 在 VS Code 整合終端機裡開啟 tmux 工作階段
- **在編輯器中連線** — 把 tmux 工作階段作為編輯器分頁開啟
- **自動連線** — 開啟 worktree 資料夾時自動連線工作階段

### 🧹 清理孤立工作階段
偵測並清理沒有對應 worktree 的 tmux 工作階段。保持環境整潔。

### 🖥️ 工作階段管理
- 右鍵選單快速分割窗格和建立新視窗
- 複製 worktree 路徑到剪貼簿
- 在新 VS Code 視窗中開啟 worktree
- 按名稱篩選工作階段

## 實際應用場景

### 🤖 用 AI 助手同時開發多個分支
```
專案/
├── main              → tmux: "myapp/main" (Claude Code 重構中)
├── feature/oauth     → tmux: "myapp/feature-oauth" (手動編碼)
└── fix/memory-leak   → tmux: "myapp/fix-memory-leak" (Codex 分析中)
```

每個分支獨立執行 AI 助手,用 VS Code 查看結果。工作階段在背景持續工作。

### 🌐 遠端伺服器開發
透過 SSH 連線到開發伺服器:
- 用 VS Code Remote-SSH 連線伺服器
- 用 TMUX Worktree 管理各個分支的工作階段
- SSH 中斷後 tmux 工作階段依然保留
- 在家、在咖啡廳、用手機都能重新連線

### 📱 手機查看程式碼
用 Termux + SSH 從手機存取:
```bash
ssh dev-server
tmux attach -t myapp/feature-oauth
```
通勤途中也能查看 AI 助手寫的程式碼。

## 指令列表

| 指令 | 說明 |
|------|------|
| `TMUX: Attach/Create Session` | 連線或建立目前 worktree 的 tmux 工作階段 |
| `TMUX: New Task` | 一鍵建立新分支 + worktree + tmux 工作階段 |
| `TMUX: Remove Task` | 刪除 worktree 及其 tmux 工作階段 |
| `TMUX: Cleanup Orphans` | 清理孤立的 tmux 工作階段 |

## 環境需求

- **tmux** — 必須已安裝且在 PATH 中
- **git** — 必須已安裝且在 PATH 中
- **VS Code** 1.85.0 及以上

## 快速開始

1. 安裝擴充功能
2. 在 VS Code 中開啟 git 儲存庫
3. 點選活動列(側邊欄)的 **TMUX** 圖示
4. 現有的 worktree 和 tmux 工作階段會自動顯示

建立新任務:點選 TMUX 面板標題列的 **+** 按鈕,輸入分支名稱即可。

## 運作原理

```
儲存庫 (根目錄)
├── main              → tmux 工作階段: "project/main"
├── feature/login     → tmux 工作階段: "project/feature-login"
└── fix/bug-123       → tmux 工作階段: "project/fix-bug-123"
```

每個 worktree 對應一個專屬 tmux 工作階段。工作階段名稱基於儲存庫和分支自動產生,在 VS Code 外也能輕鬆找到。

## 了解更多

- [市集首頁](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)
- [GitHub 儲存庫](https://github.com/kargnas/vscode-ext-tmux-worktree)
- [問題回報](https://github.com/kargnas/vscode-ext-tmux-worktree/issues)

## 開源授權

[MIT](../LICENSE.md)
