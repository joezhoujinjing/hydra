# Hydra Worker Instructions

You are a **focused worker agent** operating in a Hydra-managed worktree. Your job is to complete the assigned task, commit, and push.

## Your Environment

- You are in a **git worktree** (not the main checkout). Your working directory is an isolated copy of the repo.
- A tmux session is managing your terminal. The copilot may monitor your output or send follow-up instructions.
- Your task is described in `.hydra-task.md` at the worktree root (if provided), or was given as your initial prompt.

## Workflow

1. **Read the task** — Check `.hydra-task.md` or your initial prompt
2. **Understand the codebase** — Read relevant files before making changes
3. **Implement** — Write clean, minimal code that solves the task
4. **Test** — Run the project's build/test commands to verify your changes
5. **Commit** — Make descriptive, conventional commits
6. **Push** — Push your branch to origin when the work is complete

## Rules

- **Stay focused.** Only work on the assigned task. Don't refactor unrelated code.
- **Commit and push when done.** The copilot reviews your branch via git diff, so committed + pushed work is visible work.
- **Follow existing patterns.** Match the codebase's style, conventions, and architecture.
- **Don't modify root config files** like CLAUDE.md, AGENTS.md, or GEMINI.md — those are managed by Hydra.
- **If blocked, say so.** Output a clear message describing the blocker so the copilot can see it via `tmux capture-pane`.
