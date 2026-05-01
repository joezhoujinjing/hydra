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
├── cli/                    # CLI tool (Go, legacy TUI)
├── out/                    # Compiled output
├── skills/                 # Hydra skill definition
└── resources/              # Icons and assets
```

## Key Patterns

- **Worktree Location**: Extension-managed worktrees go under `<repo>/.hydra/worktrees/`
- **Session Namespace**: `{repoName}-{pathHash}_{branchSlug}` for collision safety
- **Root Detection**: Compare worktree path to primary via `git rev-parse --git-common-dir`
- **Terminal Creation**: Use `/bin/sh -c 'exec tmux attach ...'` with env vars nulled to avoid shell integration interference
- **Slug Collision**: basename → parent dir disambiguation → short path hash
- **Language**: English for all comments, docs, and UI strings

## Coding Standards

- TypeScript: `async/await` for all I/O, `try-catch` for error handling
- Match existing code style and conventions
- Run `npm run compile` and `npm run lint` before committing
- Descriptive, conventional commit messages
