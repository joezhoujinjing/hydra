# TMUX Worktree

**VS Code で tmux セッションと git worktree を一緒に管理。**

🌏 **他の言語で読む:** [English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文 (台灣)](README.zh-TW.md) | [繁體中文 (香港)](README.zh-HK.md) | **日本語**

## 仕上がりの良さを感じるポイント

- **画像対応ターミナル貼り付け**: `Cmd+V` / `Ctrl+Shift+V` で、テキストは通常貼り付け、画像はファイルパス入力へ自動切替。
- **Remote-SSH クリップボードブリッジ**: ローカルのクリップボード画像を、手動アップロードなしでリモート端末に渡せます。
- **衝突しにくいセッション識別**: `repo-name + path hash` ネームスペースとスラッグ衝突解決で同名リポジトリを安全に区別。
- **レガシー互換の移行**: `@workdir` がリポジトリ配下なら旧セッション接頭辞も継続認識。
- **no-git フォールバック表示**: Git でないフォルダも `current project (no git)` としてツリーに表示。

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

### 📋 スマート貼り付け（画像対応ターミナル貼り付け）
- ターミナルで `Cmd+V`（macOS）/ `Ctrl+Shift+V`（Linux）を押すと、まずクリップボード内容を判定
- テキストがある場合は通常の貼り付け動作をそのまま使用
- 画像がある場合は一時 `.png` に保存し、そのファイルパスをターミナルへ入力
- ローカル環境と Remote-SSH の両方で動作（webview ブリッジでローカル画像をリモートへ転送）
- コマンドパレットから画像貼り付けを強制実行: `TMUX: Paste Image from Clipboard`

### 🧭 セッションマッピングの堅牢性
- `repo-name + path hash` のネームスペースで、同名リポジトリの衝突を回避
- `@workdir` が現在のリポジトリ配下を指す場合はレガシーセッション名も互換検出
- worktree スラッグが衝突した場合は、親フォルダ名、その後パスハッシュで自動的に識別
- Git でないフォルダもツリーに `current project (no git)` として表示

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
| `TMUX: Smart Paste (Image Support)` | スマート貼り付け: テキストは通常貼り付け、画像は一時ファイルパスを入力 |
| `TMUX: Paste Image from Clipboard` | クリップボード画像を強制保存し、アクティブなターミナルへパスを入力 |

## 最近の更新（v1.1.2 - v1.1.6）

- **v1.1.6**: AI CLI 向けに画像対応ターミナル貼り付け（`Cmd+V` / `Ctrl+Shift+V`）と強制画像貼り付けコマンドを追加。起動時 auto-attach の端末サイズ安定性も改善。
- **v1.1.4 - v1.1.5**: attach 時にクリップボード機能と passthrough を有効化し、tmux クリップボード連携を改善。
- **v1.1.3**: レガシーセッション接頭辞の互換ロジックを整理し、移行時の安全性を改善。
- **v1.1.2**: スラッグ衝突処理と no-git ワークスペース表示（`current project (no git)`）を追加。

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
├── main              → tmux セッション: "project-a1b2c3d4_main"
├── feature/login     → tmux セッション: "project-a1b2c3d4_feature-login"
└── fix/bug-123       → tmux セッション: "project-a1b2c3d4_fix-bug-123"
```

各 worktree に専用の tmux セッションが割り当てられます。セッション名は `repo-name + path hash` のネームスペースとスラッグで構成されるため、別ディレクトリにある同名リポジトリ同士でも衝突しません。

## 詳細情報

- [GitHub リポジトリ](https://github.com/joezhoujinjing/hydra)
- [問題報告](https://github.com/joezhoujinjing/hydra/issues)

## ライセンス

[MIT](../LICENSE.md)
