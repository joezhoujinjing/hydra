# Hydra Development Guidelines

Guidelines for AI agents and developers working on this project.

## Build & Test

```bash
npm install           # Install dependencies
npm run compile       # Build extension
npm run lint          # Run ESLint
```

After changes, always run `npm run compile` to verify the build succeeds before committing.

## Project Structure

```
.
├── src/                    # VS Code Extension (TypeScript)
│   ├── extension.ts        # Entry point
│   ├── commands/           # Command implementations
│   ├── providers/          # Tree data providers (sidebar)
│   ├── core/               # Agent config, worker lifecycle
│   ├── resources/          # Agent instruction templates
│   └── utils/              # tmux, git, session utilities
├── out/                    # Compiled output
├── skills/                 # Hydra skill definition
└── resources/              # Icons and assets
```

## Key Patterns

- **Worktree Location**: Extension-managed worktrees go under `<repo>/.hydra/worktrees/` (auto-added to `.gitignore`). Legacy worktrees under `~/.tmux-worktrees/<hash>/` are still recognized.
- **Session Namespace**: `{repoName}-{pathHash}_{branchSlug}` for collision safety across same-name repos in different directories.
- **Root Detection**: Compare worktree path to primary via `git rev-parse --git-common-dir` — never infer from branch name or folder basename.
- **Slug Collision**: basename → parent dir disambiguation → short path hash. Reserve `main` for the primary worktree.
- **Canonical Path Matching**: Normalize to absolute paths with `~` expansion for equality checks. Do not collapse symlinks via `realpath`.
- **Unpublished Task Branches**: Don't set `branch.<name>.remote`/`.merge` before first push — VS Code SCM would try to sync against a non-existent remote. Set only `branch.<name>.vscode-merge-base`.
- **Tree Context Menu**: Use a single `contextValue` (`tmuxItem`) for levels 2/3/4.
- **No-Git Workspace**: Show one primary item labeled `current project (no git)` mapped to workspace path.
- **Polymorphism**: Commands must handle `TmuxItem` base class and variants (`TmuxSessionItem`, `InactiveWorktreeItem`, etc.). Use `getWorktreePath(item)` helper.
- **Legacy Compatibility**: Centralized in `src/utils/sessionCompatibility.ts`.
- **Language**: English for all comments, docs, and UI strings.

## Terminal & tmux Integration

Critical lessons learned — do not change without understanding the full implications:

- **Terminal Creation**: Use `/bin/sh -c 'exec tmux attach ...'` — NOT `shellPath: 'tmux'` (breaks mouse drag/pane resize) or `terminal.sendText` (race condition with other extensions).
- **Shell Integration**: Set `TERM_PROGRAM`, `VSCODE_SHELL_INTEGRATION`, `VSCODE_INJECTION` to `null` to prevent OSC 633 interference inside tmux.
- **Environment Pollution**: Scrub `VSCODE_*` and `ELECTRON_RUN_AS_NODE` from tmux server environment before `new-session` and before `attach` — long-lived tmux servers re-poison new panes otherwise.
- **Clipboard**: Set `set-clipboard on`, `terminal-features ...:clipboard`, `terminal-overrides ...:clipboard` before attach for OSC52 in Remote-SSH. Enable `allow-passthrough on` for agent TUI clipboard support.
- **Startup Size Race**: Delay initial attach briefly, sync `default-size` from `stty size`, then `resize-window` to avoid 80x24 first-paint. Restore `window-size latest` after forced resize.
- **Shell Script Assembly**: Join `/bin/sh -c` fragments with newlines, not `; `, to avoid `do;` syntax errors.

## UI/UX

- **Session Presentation**: Two-line layout (Group/Status + Detail).
- **Terminal Interaction**: Open in Editor Area (Tabs) by default.
- **Tree Levels**: Level 2 = branch/HEAD with green circle status. Level 3 = tmux usage. Level 4 = git summary (only when non-empty).
- **Current Workspace**: Sort to top with `👆` marker, match against workspace folder path.
- **Deduplication**: Active Session > Inactive Worktree.

## Coding Standards

- TypeScript: `async/await` for all I/O, `try-catch` for error handling
- Match existing code style and conventions
- Run `npm run compile` and `npm run lint` before committing
- Descriptive, conventional commit messages
