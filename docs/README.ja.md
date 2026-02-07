# TMUX Worktree

**VS Code で tmux セッションと git worktree を一緒に管理。**

🌏 **他の言語で読む:** [English](../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [繁體中文 (台灣)](README.zh-TW.md) | [繁體中文 (香港)](README.zh-HK.md) | **日本語**

![TMUX Worktree スクリーンショット](https://raw.githubusercontent.com/kargnas/vscode-ext-tmux-worktree/main/docs/screenshot.png)

## なぜ作ったのか?

複数ブランチを並行開発するために `git worktree` を使い、ターミナルセッションを維持するために `tmux` を使っているなら、両方を手動で管理するのがどれだけ面倒かご存知でしょう。この拡張機能がそのギャップを埋めます:

- **ワンクリック**で worktree + tmux セッションを一緒に作成
- **ツリービュー**ですべての worktree と tmux の状態を一目で確認
- worktree フォルダを開くと**自動的に**対応する tmux セッションに接続
- **コンテキストを失わない** — VS Code を閉じてもセッションは存続

### AI コーディングエージェントに最適

Claude Code、Codex、OpenCode、Gemini CLI などの AI コーディングエージェントを tmux セッション内で実行。エージェントはバックグラウンドで動き続け、いつでもどこからでも再接続できます。スマホから Termux 経由でも可能です。

## 主な機能

### 🌳 エクスプローラービュー
サイドバーにすべての git worktree と関連する tmux セッションが一覧表示されます。セッションのステータス、ペイン数、最終アクティビティ時刻まで表示。

### ⚡ ワンクリックタスク作成
新しい git ブランチ + worktree + tmux セッションを一度に作成できます。新機能の開発をすぐに始められます。

### 🔗 スマート接続
- **ターミナルで接続** — VS Code 統合ターミナルで tmux セッションを開く
- **エディタで接続** — tmux セッションをエディタタブとして開く
- **自動接続** — worktree フォルダを開くと自動的にセッションに接続

### 🧹 孤立セッションのクリーンアップ
worktree が削除された後に残っている tmux セッションを検出して整理します。環境を清潔に保ちます。

### 🖥️ セッション管理
- コンテキストメニューからペイン分割と新しいウィンドウ作成
- worktree のパスをクリップボードにコピー
- 新しい VS Code ウィンドウで worktree を開く
- 名前でセッションをフィルタリング

## 実際の活用例

### 🤖 AI エージェントで複数ブランチを同時開発
```
プロジェクト/
├── main              → tmux: "myapp/main" (Claude Code がリファクタリング中)
├── feature/oauth     → tmux: "myapp/feature-oauth" (手動でコーディング)
└── fix/memory-leak   → tmux: "myapp/fix-memory-leak" (Codex が分析中)
```

各ブランチで AI エージェントを独立して実行し、VS Code で結果を確認。セッションはバックグラウンドで動き続けます。

### 🌐 リモートサーバーでの作業
SSH で開発サーバーに接続した状態で:
- VS Code Remote-SSH でサーバーに接続
- TMUX Worktree で各ブランチのセッションを管理
- SSH 接続が切れても tmux セッションは生き続ける
- 自宅からも、カフェからも、スマホからも再接続可能

### 📱 モバイルでコード確認
Termux + SSH でスマホから接続:
```bash
ssh dev-server
tmux attach -t myapp/feature-oauth
```
通勤中に AI エージェントが書いたコードをレビューすることも可能です。

## コマンド一覧

| コマンド | 説明 |
|----------|------|
| `TMUX: Attach/Create Session` | 現在の worktree の tmux セッションに接続、または新規作成 |
| `TMUX: New Task` | 新しいブランチ + worktree + tmux セッションを一度に作成 |
| `TMUX: Remove Task` | worktree と tmux セッションを削除 |
| `TMUX: Cleanup Orphans` | 孤立した tmux セッションを整理 |

## 動作要件

- **tmux** — インストール済みで PATH に含まれている必要があります
- **git** — インストール済みで PATH に含まれている必要があります
- **VS Code** 1.85.0 以上

## はじめ方

1. 拡張機能をインストール
2. VS Code で git リポジトリを開く
3. アクティビティバー(サイドバー)の **TMUX** アイコンをクリック
4. 既存の worktree と tmux セッションが自動的に表示されます

新しいタスクの作成:TMUX パネルヘッダーの **+** ボタンをクリックし、ブランチ名を入力するだけ。

## 仕組み

```
リポジトリ(ルート)
├── main              → tmux セッション: "project/main"
├── feature/login     → tmux セッション: "project/feature-login"
└── fix/bug-123       → tmux セッション: "project/fix-bug-123"
```

各 worktree に専用の tmux セッションが割り当てられます。セッション名はリポジトリとブランチに基づいて自動生成されるため、VS Code の外からでも簡単に見つけられます。

## 詳細情報

- [マーケットプレイス](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)
- [GitHub リポジトリ](https://github.com/kargnas/vscode-ext-tmux-worktree)
- [問題報告](https://github.com/kargnas/vscode-ext-tmux-worktree/issues)

## ライセンス

[MIT](../LICENSE.md)
