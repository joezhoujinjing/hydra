# Audit: 1:1 Session Model Consistency

**Date:** 2026-05-05
**Branch:** `audit/session-model-consistency`
**Scope:** All source files governing session, agent, tmux, and worktree lifecycle

## Invariants Under Test

```
1 worker  = 1 tmux session = 1 coding agent session = 1 git worktree
1 copilot = 1 tmux session = 1 coding agent session = no worktree
```

`agentSessionId` in `sessions.json` is the coding agent's session ID (e.g. Claude's `--session-id`), always 1:1 with the tmux session.

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 3     |
| MEDIUM   | 4     |
| LOW      | 3     |

The `SessionManager` (CLI path) enforces the 1:1 model well. The VS Code extension commands (`newTask`, `createWorktreeFromBranch`, `attachCreate`, `removeTask`) bypass `SessionManager` and create/destroy tmux sessions without corresponding agent sessions or `sessions.json` entries.

---

## HIGH Findings

### H-1: `newTask` creates tmux session + worktree without agent or sessions.json entry

**File:** `src/commands/newTask.ts:72-78`

```typescript
const sessionName = backend.buildSessionName(repoSessionNamespace, finalSlug);
await backend.createSession(sessionName, worktreePath);
await backend.setSessionWorkdir(sessionName, worktreePath);
await backend.setSessionRole(sessionName, 'worker');
// NO agent launched
// NO @hydra-agent set
// NO sessions.json entry created
backend.attachSession(sessionName, worktreePath, undefined, 'worker');
```

**Violation:** Tmux session exists without a coding agent session. No `sessionId` is ever assigned. No entry in `sessions.json`. When `sync()` later discovers this session via `@hydra-role`, it creates an entry with `sessionId: null`, `branch: ''`, `agent: 'unknown'`.

---

### H-2: `createWorktreeFromBranch` creates tmux session + worktree without agent or sessions.json entry

**File:** `src/commands/createWorktreeFromBranch.ts:148-152`

```typescript
const sessionName = backend.buildSessionName(repoSessionNamespace, finalSlug);
await backend.createSession(sessionName, worktreePath);
await backend.setSessionWorkdir(sessionName, worktreePath);
await backend.setSessionRole(sessionName, 'worker');
// NO agent launched
// NO @hydra-agent set
// NO sessions.json entry created
backend.attachSession(sessionName, worktreePath, undefined, 'worker');
```

**Violation:** Identical to H-1. Tmux session has no agent and no `sessions.json` entry.

---

### H-3: `removeTask` bypasses SessionManager — agent session ID lost, no archive

**File:** `src/commands/removeTask.ts`

All deletion paths call `backend.killSession()` directly and never call `SessionManager.deleteWorker()` or `SessionManager.deleteCopilot()`.

- **Copilot deletion (lines 80-91):** `backend.killSession()` only. No archive, no `sessions.json` update.
- **Worker deletion (lines 210-238):** `backend.killSession()` + `git worktree remove` + optional `git branch -d`. No archive, no `sessions.json` update.
- **Main worktree (lines 155-161):** `backend.killSession()` only. No `sessions.json` update.
- **Orphan (lines 176-178):** `backend.killSession()` only. No `sessions.json` update.

**Violations:**
1. Agent session ID is never archived → cannot resume deleted sessions via `hydra archive restore`.
2. `sessions.json` remains stale until the next `sync()` call.
3. For workers: `SessionManager.deleteWorker()` atomically kills tmux + removes worktree + deletes branch + archives + updates `sessions.json`. `removeTask` does these steps piecemeal with error handling gaps (e.g. worktree removed but branch kept, no archive).

---

## MEDIUM Findings

### M-1: `attachCreate` creates bare tmux sessions for inactive worktrees without agent

**File:** `src/commands/attachCreate.ts:45-56, 59-70`

When clicking an `InactiveWorktreeItem` or `InactiveDetailItem` in the tree view:

```typescript
await backend.createSession(sessionName, worktreePath);
await backend.setSessionWorkdir(sessionName, worktreePath);
await backend.setSessionRole(sessionName, 'worker');
// NO agent launched
// NO @hydra-agent set
backend.attachSession(sessionName, worktreePath, undefined, 'worker');
```

**Violation:** Creates a tmux session with `@hydra-role=worker` but no coding agent running inside it. The `sessions.json` entry (if it exists as 'stopped') retains its old `sessionId`, but the tmux session is now a bare shell — not a 1:1 agent session. The user gets a raw shell instead of a resumed agent.

---

### M-2: Sync discovery creates entries with null sessionId and incomplete metadata

**File:** `src/core/sessionManager.ts:179-217`

When `sync()` discovers live tmux sessions with `@hydra-role` that are not in `sessions.json`:

```typescript
state.workers[session.name] = {
  ...
  branch: '',           // unknown
  slug,                 // extracted from session name
  agent,                // from @hydra-agent or 'unknown'
  sessionId: null,      // agent's session ID is unknown
  copilotSessionName: null,
};
```

**Issue:** The agent running in the tmux session has a session ID, but `sync()` cannot recover it. This means:
- Resume is impossible for discovered sessions (no `sessionId` to pass to `--resume`).
- Sessions created by H-1 / H-2 (which don't set `@hydra-agent`) are discovered with `agent: 'unknown'`.

---

### M-3: VS Code copilot creation uses parallel code path to SessionManager.createCopilot

**Files:**
- `src/commands/createCopilot.ts:54-104` (`createCopilotWithAgent`)
- `src/commands/createCopilot.ts:106-179` (`createCopilot`)
- `src/core/sessionManager.ts:500-566` (`SessionManager.createCopilot`)

The VS Code extension creates copilots via direct `backend` calls + `sm.persistCopilotSessionId()`, while the CLI uses `SessionManager.createCopilot()`. These are two parallel implementations of the same workflow:

| Step | VS Code path | CLI path (SessionManager) |
|------|-------------|---------------------------|
| Create tmux | `backend.createSession()` | `this.backend.createSession()` |
| Set metadata | `backend.setSessionWorkdir/Role/Agent()` | `this.backend.setSessionWorkdir/Role/Agent()` |
| Launch agent | `backend.sendKeys(launchCmd)` | `this.backend.sendKeys(launchCmd)` |
| Write sessions.json | `sm.persistCopilotSessionId()` | Direct `this.writeSessionState()` |
| Capture non-Claude ID | `sendCopilotOnboarding()` (fire-and-forget) | `this.waitForReadyAndCaptureSessionId()` |

**Risk:** These paths can diverge. If `SessionManager.createCopilot` adds a new step (e.g., new metadata, validation), the VS Code path won't get it automatically.

---

### M-4: Non-Claude copilot session ID capture is fire-and-forget in VS Code path

**File:** `src/commands/createCopilot.ts:38-51`

```typescript
async () => {
  try {
    if (!preAssignedSessionId && agentType && sm) {
      await sm.captureAndPersistSessionId(sessionName, agentType);
    } else {
      await new Promise(resolve => setTimeout(resolve, 8000));
    }
    await backend.sendMessage(sessionName, ONBOARDING_PROMPT);
  } catch {
    // Best-effort — agent may not be ready yet
  }
}
```

The `captureAndPersistSessionId` call is inside a fire-and-forget async IIFE with a catch-all. If session ID capture fails (timeout, agent not ready), the copilot's `sessionId` stays `null` in `sessions.json` permanently — no retry, no notification.

Compare with the CLI path (`SessionManager.createCopilot:561-562`):
```typescript
if (!isResume && !sessionId) {
  this.waitForReadyAndCaptureSessionId(sessionName, agentType, null).catch(() => {});
}
```
Same issue in the CLI path — `.catch(() => {})` swallows failures silently.

---

## LOW Findings

### L-1: `ensureSessionExists` in contextMenu.ts creates bare tmux sessions

**File:** `src/commands/contextMenu.ts:33-45`

```typescript
async function ensureSessionExists(sessionName: string, worktreePath?: string): Promise<void> {
  const backend = getActiveBackend();
  if (await backend.hasSession(sessionName)) return;
  if (!worktreePath) throw new Error('...');
  await backend.createSession(sessionName, worktreePath);
  await backend.setSessionWorkdir(sessionName, worktreePath);
  // NO @hydra-role set
  // NO @hydra-agent set
  // NO sessions.json update
}
```

**Issue:** If a session was killed externally (e.g. `tmux kill-session`), this recreates it as a bare tmux session with no role, no agent, and no `sessions.json` update. Used by `attach`, `newPane`, `newWindow` — so the recreated session won't be discovered by `sync()` (no `@hydra-role` set).

---

### L-2: Redundant `tmuxSession` field always equals `sessionName`

**Files:**
- `src/core/sessionManager.ts:47` (`WorkerInfo.tmuxSession`)
- `src/core/sessionManager.ts:63` (`CopilotInfo.tmuxSession`)

Both `tmuxSession` and `sessionName` always hold the same value. Every assignment site confirms this:
- `sessionManager.ts:198, 368, 548, 658, 699, 741, 1131, 1210`: `tmuxSession: sessionName`

The redundancy creates ambiguity about which field is canonical. External consumers (CLI `list` output, `tmuxSessionProvider.ts`) reference both inconsistently.

---

### L-3: Inconsistent naming: `sessionId` vs `agentSessionId`

**Files:**
- `src/core/sessionManager.ts:50` — `WorkerInfo.sessionId`
- `src/core/sessionManager.ts:66` — `CopilotInfo.sessionId`
- `src/core/sessionManager.ts:79` — `ArchivedSessionInfo.agentSessionId`

The same concept (the coding agent's session ID) uses `sessionId` in active entries and `agentSessionId` in archive entries. This creates ambiguity — readers may wonder if these are the same thing or different identifiers.

---

## What Works Well

The following invariants hold correctly in the `SessionManager` (CLI) path:

1. **Worker create** (`createWorker`): worktree → tmux session → agent launch → `sessions.json` write → Phase 1 (capture sessionId) → Phase 2 (send task). All five resources are created atomically. ✓

2. **Worker delete** (`deleteWorker`): kills tmux → archives to `archive.json` → removes worktree → deletes branch → removes from `sessions.json`. Full teardown with archive. ✓

3. **Worker stop/start** (`stopWorker`/`startWorker`): Stop kills tmux, marks 'stopped', preserves `sessionId`. Start creates new tmux, resumes agent with stored `sessionId`. The 1:1 mapping is preserved across stop/start cycles. ✓

4. **Copilot create** (`SessionManager.createCopilot`): tmux session → agent launch → `sessions.json` write → Phase 1 (capture sessionId). ✓

5. **Copilot delete** (`deleteCopilot`): kills tmux → archives → removes from `sessions.json`. ✓

6. **Resume/restore** (`restoreWorker`/`restoreCopilot`): Uses archived `agentSessionId` to resume the agent's conversation context. The 1:1 mapping is maintained across delete/restore cycles. ✓

7. **Rename** (`renameWorker`/`renameCopilot`): Renames git branch + moves worktree + renames tmux session + updates `sessions.json`. All resources renamed together. ✓

8. **Sync reconciliation** (`sync`): Correctly detects orphans (tmux dead + no worktree), marks running/stopped status, discovers unknown sessions via `@hydra-role`. ✓

---

## Recommendations

1. **H-1, H-2:** `newTask` and `createWorktreeFromBranch` should either (a) launch an agent and write to `sessions.json` via `SessionManager.createWorker`, or (b) be explicitly documented as "bare worktree" commands that don't create agent sessions.

2. **H-3:** `removeTask` should delegate to `SessionManager.deleteWorker()` / `SessionManager.deleteCopilot()` to ensure archiving and atomic cleanup.

3. **M-1:** `attachCreate` for inactive items should either resume the agent (using the stored `sessionId`) or clearly indicate to the user that they're getting a bare shell.

4. **M-3:** Consider having the VS Code copilot creation path call `SessionManager.createCopilot()` instead of reimplementing the same steps.

5. **L-2:** Remove the `tmuxSession` field from `WorkerInfo` and `CopilotInfo`, or alias it explicitly.

6. **L-3:** Standardize on one name (`agentSessionId` is clearer) across all types.
