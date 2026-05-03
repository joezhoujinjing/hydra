# Example: Parity Port — Parallelizing a Large Migration

This walkthrough shows how to use Hydra's Copilot + Workers model to parallelize a large feature-parity migration. Instead of porting features one by one, you break the work into independent chunks and let multiple AI agents implement them simultaneously.

## Scenario

You're migrating a product from Framework A to Framework B. The master issue lists 40 features that need to be ported. Many are independent — auth doesn't depend on search, billing doesn't depend on notifications.

## Step 1: Copilot Analyzes the Master Issue

Launch a Copilot on `main`. Give it the master issue and ask it to decompose the work:

```
You: "Read issue #200 (parity port tracker). Group the 40 features into
     independent batches that can be implemented in parallel. Output a
     table: batch name, branch name, feature list, estimated complexity."
```

The Copilot analyzes dependencies and produces something like:

| Batch | Branch | Features | Complexity |
|-------|--------|----------|------------|
| Auth | `port/auth` | Login, SSO, password reset | Medium |
| Billing | `port/billing` | Plans, invoices, payment methods, trials, upgrades | High |
| Notifications | `port/notifications` | Email, push, in-app, preferences | Medium |
| Search | `port/search` | Full-text, filters, facets, saved searches, autocomplete, recent | High |
| Settings | `port/settings` | Profile, preferences, API keys | Low |
| Analytics | `port/analytics` | Dashboard, events, funnels, exports, segments | High |
| Export | `port/export` | CSV, PDF, scheduled exports, templates | Medium |
| Onboarding | `port/onboarding` | Wizard, tooltips, checklists | Low |

## Step 2: Copilot Spawns Workers

The Copilot uses the Hydra CLI to spawn one Worker per batch:

```bash
hydra worker create --repo . --branch port/auth \
  --agent claude \
  --task "Port the authentication features (login, SSO, password reset) from src/legacy/auth/ to src/auth/. Follow the patterns in src/billing/ which was already ported. Run tests after each feature."

hydra worker create --repo . --branch port/billing \
  --agent claude \
  --task "Port the billing features (plans, invoices, payment methods, trials, upgrades) from src/legacy/billing/ to src/billing/. Ensure Stripe webhook handlers are updated. Run tests."

hydra worker create --repo . --branch port/search \
  --agent codex \
  --task "Port the search features (full-text, filters, facets, saved searches, autocomplete, recent) from src/legacy/search/ to src/search/. Use the new Elasticsearch client. Run tests."

# ... repeat for each batch
```

## Step 3: Monitor Progress

Your Hydra sidebar now shows all Workers with live status:

```
Hydra
├── Copilots
│   └── ● Claude — main
├── Workers
│   ├── ● port/auth        — Claude — 2 panes, 3 commits ahead
│   ├── ● port/billing     — Claude — 1 pane, 1 commit ahead
│   ├── ● port/search      — Codex  — 1 pane, active
│   ├── ● port/notifications — Claude — 1 pane, 5 commits ahead
│   ├── ● port/settings    — Claude — 1 pane, 2 commits ahead
│   ├── ○ port/analytics   — Claude — idle
│   ├── ● port/export      — Claude — 1 pane, active
│   └── ● port/onboarding  — Claude — 1 pane, 4 commits ahead
```

The Copilot can also monitor Workers programmatically:

```bash
# Check Worker output
tmux capture-pane -t myapp-a1b2c3d4_port-auth -p -S -50

# Check git status in a Worker's worktree
git -C .hydra/worktrees/port-auth log --oneline -5
git -C .hydra/worktrees/port-auth diff --stat
```

## Step 4: Review and Course-Correct

When a Worker finishes (or gets stuck), the Copilot reviews its work:

```bash
# Review the auth Worker's changes
git -C .hydra/worktrees/port-auth diff main...port/auth --stat

# Send follow-up instructions if needed
tmux send-keys -t myapp-a1b2c3d4_port-auth \
  "The SSO integration is using the old OAuth flow. Please update it to use PKCE. See src/auth/oauth.ts for reference." Enter
```

## Step 5: Ship

As Workers complete their batches:

1. Worker pushes its branch
2. Copilot (or you) creates a PR: `gh pr create --base main --head port/auth`
3. Review the diff, run CI, merge
4. Repeat for each batch

## Results

| Approach | Time | Context switches |
|----------|------|-----------------|
| Sequential (1 agent) | ~5 days | 40 |
| Parallel (8 Workers) | ~8 hours | 8 reviews |

## Tips

- **Group by independence**, not by size. Two small coupled features should be in the same batch.
- **Provide reference examples.** If one module is already ported, point Workers to it as a pattern.
- **Use `--task-file`** for complex batches. Write a detailed markdown spec and pass it with `--task-file spec.md`.
- **Stagger launches** if your machine has limited CPU. Start with 3-4 Workers, then add more as they finish.
- **Review early.** Don't wait for all Workers to finish — review and merge completed batches to reduce conflict risk.
