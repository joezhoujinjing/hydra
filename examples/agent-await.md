# Example: Reliable Subagent Lifecycle (Agent Await)

This example documents how a Copilot can reliably spawn Workers, monitor their progress, and wait for completion before proceeding — effectively "awaiting" subagent results.

## The Problem

When a Copilot spawns Workers via `hydra worker create`, the Workers run asynchronously. The Copilot needs a reliable way to:

1. Know when a Worker has **finished** its task
2. Know whether the Worker **succeeded or failed**
3. **Read the Worker's output** to decide what to do next

## The Solution: Poll-and-Inspect

Since Workers run in tmux sessions, the Copilot can inspect their scrollback buffer and git status to determine completion.

### Spawn

```bash
hydra worker create --repo . --branch feat/auth \
  --agent claude \
  --task "Implement OAuth2 login flow. When finished, commit all changes and push the branch."
```

### Monitor

The Copilot polls the Worker's state using two signals:

**Signal 1: Terminal activity** — Is the agent still producing output?

```bash
# Capture the last 30 lines of the Worker's terminal
tmux capture-pane -t myapp-a1b2c3d4_feat-auth -p -S -30
```

Look for completion indicators:
- Agent prompt reappeared (waiting for input)
- "Task completed" or similar message
- The agent exited

**Signal 2: Git status** — Did the Worker commit and push?

```bash
# Check if the Worker has commits ahead of base
git -C .hydra/worktrees/feat-auth log --oneline main..feat/auth

# Check if the branch was pushed
git -C .hydra/worktrees/feat-auth branch -vv | grep feat/auth
```

### Await Pattern

A Copilot can implement a structured await loop:

```
1. Spawn Worker with --task "... When done, commit and push."
2. Wait 60 seconds (initial work time)
3. Loop:
   a. Capture scrollback → check for completion signals
   b. Check git log → any new commits?
   c. Check remote → branch pushed?
   d. If completed: break
   e. If stuck/error: send follow-up instruction
   f. Wait 30 seconds → repeat
4. Read Worker's diff: git diff main...feat/auth
5. Proceed with next step (review, merge, spawn next Worker)
```

## Example: Sequential Pipeline

Some workflows require Workers to run in sequence — Worker B depends on Worker A's output.

```
Copilot workflow:
  1. Spawn Worker A (feat/models) — "Create the database models"
  2. Await Worker A completion
  3. Spawn Worker B (feat/api) — "Build REST API using the models from feat/models"
     (Worker B's worktree is rebased onto feat/models)
  4. Await Worker B completion
  5. Spawn Worker C (feat/tests) — "Write E2E tests for the API"
  6. Await Worker C completion
  7. Create PRs: models → api → tests
```

The Copilot orchestrates this by checking each Worker's status before spawning the next:

```bash
# After spawning Worker A, the Copilot monitors it
git -C .hydra/worktrees/feat-models log --oneline main..feat/models
# Output: 3 commits → Worker A is done

# Spawn Worker B, based on Worker A's branch
hydra worker create --repo . --branch feat/api \
  --base feat/models \
  --agent claude \
  --task "Build a REST API for the models in src/models/. Follow RESTful conventions."
```

## Example: Fan-Out / Fan-In

Spawn N Workers in parallel, await all of them, then merge results:

```
Copilot workflow:
  1. Spawn Workers A, B, C (parallel tasks)
  2. Await ALL Workers
  3. Review each Worker's diff
  4. Resolve any cross-branch conflicts
  5. Merge all branches
```

```bash
# Spawn all Workers
hydra worker create --repo . --branch refactor/auth    --agent claude --task "Refactor auth module..."
hydra worker create --repo . --branch refactor/billing --agent claude --task "Refactor billing module..."
hydra worker create --repo . --branch refactor/search  --agent codex  --task "Refactor search module..."

# Await all — check each Worker's status
for branch in refactor/auth refactor/billing refactor/search; do
  slug=$(echo "$branch" | tr '/' '-')
  echo "=== $branch ==="
  git -C ".hydra/worktrees/$slug" log --oneline main.."$branch" 2>/dev/null
  echo "---"
done

# Once all are done, create PRs
for branch in refactor/auth refactor/billing refactor/search; do
  git -C ".hydra/worktrees/$(echo $branch | tr '/' '-')" push -u origin "$branch"
  gh pr create --base main --head "$branch" --title "Refactor: ${branch#refactor/}" --body "Part of the refactoring initiative."
done
```

## Completion Signals

The most reliable signals that a Worker has finished:

| Signal | How to check | Reliability |
|--------|-------------|-------------|
| Branch pushed | `git ls-remote origin feat/auth` | High — Workers push when done |
| Commits exist | `git log main..feat/auth` | Medium — commits appear incrementally |
| Agent idle | `tmux capture-pane` shows prompt | Medium — agent might be thinking |
| Session ended | `tmux has-session -t $name` returns 1 | High — but only if agent exits |

## Tips

- **Always include "commit and push when done" in the task prompt.** This gives the Copilot a clear completion signal.
- **Use `--task-file`** for complex tasks to avoid quoting issues in the prompt.
- **Check scrollback for errors.** If a Worker's scrollback contains compilation errors or test failures, the Copilot should send a follow-up instruction rather than waiting indefinitely.
- **Set a timeout.** If a Worker hasn't produced new commits in 10 minutes, check its scrollback and intervene.
- **The Copilot itself is an AI agent.** It can reason about Worker output and make decisions — e.g., "Worker A's auth module uses JWT but Worker B expects sessions; I need to align them."
