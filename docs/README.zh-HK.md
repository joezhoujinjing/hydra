# TMUX Worktree

**喺 VS Code 入面同時管理 tmux 工作階段同埋 git worktree。**

🌏 **其他語言:** [English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文 (台灣)](README.zh-TW.md) | **繁體中文 (香港)** | [日本語](README.ja.md)

## 點解佢更有細節

- **圖片感知終端貼上**: `Cmd+V` / `Ctrl+Shift+V` 會先判斷剪貼簿內容，文字行普通貼上、圖片行檔案路徑插入。
- **Remote-SSH 剪貼簿橋接**: 本機剪貼簿圖片可以直接貼去遠端終端，唔使手動上傳。
- **防撞工作階段識別**: 用 `repo-name + path hash` 命名空間加 slug 去重，避免同名儲存庫互相撞名。
- **兼容舊工作階段遷移**: 當 `@workdir` 屬於目前儲存庫時，舊前綴工作階段都仲會識別到。
- **No-git 後備可見性**: 非 git 資料夾都會顯示成 `current project (no git)`，樹狀檢視唔會突然冇內容。

## 點解要整呢個擴充功能?

如果你用 `git worktree` 做多個分支平行開發,又用 `tmux` 保持終端機工作階段,咁你一定知手動管理呢兩樣嘢有幾煩。呢個擴充功能幫你將佢哋無縫整合:

- **一撳掣就整好** worktree + tmux 工作階段
- **樹狀檢視**即時顯示所有 worktree 同埋 tmux 狀態
- 打開 worktree 資料夾就**自動連線**對應嘅 tmux 工作階段
- **唔會遺失工作內容** — 就算閂咗 VS Code,工作階段都仍然存在

### 特別啱 AI 編程助手使用

喺 tmux 工作階段入面行 AI 編程助手(Claude Code、Codex、OpenCode、Gemini CLI)。助手喺背景持續工作,隨時隨地重新連線,甚至可以用手機透過 Termux 接入。

## 主要功能

### 🌳 檔案總管檢視
側邊欄專門顯示所有 git worktree 同埋佢哋關聯嘅 tmux 工作階段。一眼睇晒工作階段狀態、窗格數量、最近活動時間。

### ⚡ 一撳掣建立任務
一步到位建立新嘅 git 分支 + worktree + tmux 工作階段。即刻開始新功能開發。

### 🔗 智能連線
- **喺終端機中連線** — 喺 VS Code 整合終端機入面打開 tmux 工作階段
- **喺編輯器中連線** — 將 tmux 工作階段當成編輯器分頁打開
- **自動連線** — 打開 worktree 資料夾就自動連線工作階段

### 🧹 清理孤立工作階段
偵測同埋清理冇對應 worktree 嘅 tmux 工作階段。保持環境整潔。

### 🖥️ 工作階段管理
- 右鍵選單快速分割窗格同埋建立新視窗
- 複製 worktree 路徑到剪貼簿
- 喺新 VS Code 視窗入面打開 worktree
- 按名稱篩選工作階段

### 📋 智能貼上（圖片感知終端貼上）
- 喺終端撳 `Cmd+V`（macOS）/ `Ctrl+Shift+V`（Linux）時會先判斷剪貼簿內容
- 如果剪貼簿有文字，就保持預設貼上行為
- 如果剪貼簿有圖片，會先存成暫存 `.png`，再將路徑輸入去終端
- 支援本機同 Remote-SSH（透過 webview 橋接，將本機圖片上傳去遠端主機）
- 命令面板可強制圖片貼上: `TMUX: Paste Image from Clipboard`

### 🧭 工作階段映射更穩陣
- 使用 `repo-name + path hash` 命名空間，避免唔同路徑下同名儲存庫撞名
- 當 `@workdir` 指向目前儲存庫內路徑時，舊工作階段命名仍可兼容識別
- worktree slug 撞名時會自動消歧（先用父資料夾名，再用路徑雜湊）
- 非 git 資料夾都會喺樹入面顯示為 `current project (no git)`

## 實際應用場景

### 🤖 用 AI 助手同時開發多個分支
```
專案/
├── main              → tmux: "myapp/main" (Claude Code 重構緊)
├── feature/oauth     → tmux: "myapp/feature-oauth" (手動寫緊code)
└── fix/memory-leak   → tmux: "myapp/fix-memory-leak" (Codex 分析緊)
```

每個分支獨立行 AI 助手,用 VS Code 睇返結果。工作階段喺背景持續工作。

### 🌐 遠端伺服器開發
透過 SSH 連線去開發伺服器:
- 用 VS Code Remote-SSH 連線伺服器
- 用 TMUX Worktree 管理各個分支嘅工作階段
- SSH 中斷之後 tmux 工作階段都仍然保留
- 喺屋企、喺咖啡店、用手機都可以重新連線

### 📱 手機睇程式碼
用 Termux + SSH 從手機接入:
```bash
ssh dev-server
tmux attach -t myapp/feature-oauth
```
返工放工途中都可以睇返 AI 助手寫嘅程式碼。

## 指令列表

| 指令 | 說明 |
|------|------|
| `TMUX: Attach/Create Session` | 連線或者建立目前 worktree 嘅 tmux 工作階段 |
| `TMUX: New Task` | 一撳掣建立新分支 + worktree + tmux 工作階段 |
| `TMUX: Remove Task` | 刪除 worktree 同埋佢嘅 tmux 工作階段 |
| `TMUX: Cleanup Orphans` | 清理孤立嘅 tmux 工作階段 |
| `TMUX: Smart Paste (Image Support)` | 智能終端貼上: 文字行普通貼上，圖片插入暫存檔案路徑 |
| `TMUX: Paste Image from Clipboard` | 強制讀取剪貼簿圖片並將儲存路徑輸入到目前終端 |

## 最近更新（v1.1.2 - v1.1.6）

- **v1.1.6**: 新增面向 AI CLI 嘅圖片感知終端貼上（`Cmd+V` / `Ctrl+Shift+V`）同強制圖片貼上指令；同時改善啟動時 auto-attach 嘅終端尺寸穩定性。
- **v1.1.4 - v1.1.5**: attach 時自動設定 clipboard / passthrough 選項，提升 tmux 剪貼簿可靠性。
- **v1.1.3**: 重構舊工作階段前綴兼容邏輯，令遷移更安全。
- **v1.1.2**: 加入 slug 撞名處理同 no-git 工作區標籤（`current project (no git)`）。

## 環境需求

- **tmux** — 必須已安裝而且喺 PATH 入面
- **git** — 必須已安裝而且喺 PATH 入面
- **VS Code** 1.85.0 或以上

## 快速開始

1. 安裝擴充功能
2. 喺 VS Code 入面打開 git 儲存庫
3. 撳側邊欄(活動列)嘅 **TMUX** 圖示
4. 現有嘅 worktree 同埋 tmux 工作階段會自動顯示

建立新任務:撳 TMUX 面板標題列嘅 **+** 按鈕,輸入分支名稱就得。

## 運作原理

```
儲存庫 (根目錄)
├── main              → tmux 工作階段: "project-a1b2c3d4_main"
├── feature/login     → tmux 工作階段: "project-a1b2c3d4_feature-login"
└── fix/bug-123       → tmux 工作階段: "project-a1b2c3d4_fix-bug-123"
```

每個 worktree 都有專屬 tmux 工作階段。名稱由 `repo-name + path hash` 命名空間同 slug 組成，可以避免唔同目錄下同名儲存庫互相撞名。

## 了解更多

- [GitHub 儲存庫](https://github.com/joezhoujinjing/hydra)
- [問題回報](https://github.com/joezhoujinjing/hydra/issues)

## 開源授權

[MIT](../LICENSE.md)
