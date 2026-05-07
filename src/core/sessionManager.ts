import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { MultiplexerBackendCore } from './types';
import * as coreGit from './git';
import { ensureHydraGlobalConfig } from './hydraGlobalConfig';
import { buildAgentLaunchCommand, buildAgentResumeCommand, DEFAULT_AGENT_COMMANDS, AGENT_SESSION_CAPTURE, CLAUDE_READY_DELAY_MS, AGENT_READY_PATTERNS, AGENT_READY_TIMEOUT_MS, AGENT_READY_POLL_INTERVAL_MS, CLAUDE_TRUST_PROMPT_PATTERN } from './agentConfig';
import { exec, resolveCommandPath } from './exec';
import { getHydraArchiveFile, getHydraHome, getHydraSessionsFile } from './path';
import { shellQuote } from './shell';

const POST_CREATE_TIMEOUT_MS = AGENT_READY_TIMEOUT_MS + 15000;
const SESSION_STATE_LOCK_TIMEOUT_MS = 10000;
const SESSION_STATE_LOCK_RETRY_MS = 50;
const SESSION_STATE_LOCK_STALE_MS = 120000;

/**
 * Look up a worker's numeric ID from sessions.json.
 * Lightweight standalone function — no SessionManager instance needed.
 */
export function lookupWorkerId(sessionName: string): number | undefined {
  try {
    const sessionsFile = getHydraSessionsFile();
    if (fs.existsSync(sessionsFile)) {
      const parsed = JSON.parse(fs.readFileSync(sessionsFile, 'utf-8'));
      return parsed.workers?.[sessionName]?.workerId;
    }
  } catch {
    // Best-effort
  }
  return undefined;
}

// ── Types ──

export interface WorkerInfo {
  sessionName: string;
  /** Human-friendly name for display (the branch slug without the hash prefix). */
  displayName: string;
  workerId: number;
  repo: string;
  repoRoot: string;
  branch: string;
  slug: string;
  status: 'running' | 'stopped';
  attached: boolean;
  agent: string;
  workdir: string;
  tmuxSession: string;
  createdAt: string;
  lastSeenAt: string;
  sessionId: string | null;
  /** Session name of the copilot that spawned this worker, if any. */
  copilotSessionName: string | null;
}

export interface CopilotInfo {
  sessionName: string;
  /** Human-friendly name for display (the user-given copilot name). */
  displayName: string;
  status: 'running' | 'stopped';
  attached: boolean;
  agent: string;
  workdir: string;
  tmuxSession: string;
  createdAt: string;
  lastSeenAt: string;
  sessionId: string | null;
}

export interface SessionState {
  copilots: Record<string, CopilotInfo>;
  workers: Record<string, WorkerInfo>;
  nextWorkerId: number;
  updatedAt: string;
}

export interface ArchivedSessionInfo {
  type: 'worker' | 'copilot';
  sessionName: string;
  agentSessionId: string | null;
  archivedAt: string;
  data: WorkerInfo | CopilotInfo;
}

export interface ArchiveState {
  entries: ArchivedSessionInfo[];
}

export interface CreateWorkerOpts {
  repoRoot: string;
  branchName: string;
  agentType?: string;
  baseBranchOverride?: string;
  task?: string;
  taskFile?: string;
  agentCommand?: string;
  /** When set, launch the agent with --resume instead of a fresh session. */
  resumeSessionId?: string;
  /** Session name of the copilot that spawned this worker. */
  copilotSessionName?: string;
  /** Whether to notify the parent copilot when the worker completes (default: true). */
  notifyCopilot?: boolean;
}

export interface CreateCopilotOpts {
  workdir: string;
  agentType?: string;
  /** User-given name for the copilot (used as displayName). */
  name?: string;
  sessionName?: string;
  agentCommand?: string;
  /** When set, launch the agent with --resume instead of a fresh session. */
  resumeSessionId?: string;
}

export interface CreateWorkerResult {
  workerInfo: WorkerInfo;
  /** Resolves after the delayed Enter is sent (for Claude trust prompt). CLI should await this. */
  postCreatePromise: Promise<void>;
}

export interface CreateCopilotResult {
  copilotInfo: CopilotInfo;
  /** Resolves after the agent is ready and any deferred session ID capture has completed. */
  postCreatePromise: Promise<void>;
}

// ── SessionManager Class ──

export class SessionManager {
  constructor(private backend: MultiplexerBackendCore) {}

  // ── Sync: reconcile sessions.json <-> live multiplexer ──

  async sync(): Promise<SessionState> {
    const liveSessions = await this.backend.listSessions();
    const liveSessionMap = new Map(liveSessions.map(s => [s.name, s]));
    const discoveredSessions = new Map<string, {
      role: 'worker' | 'copilot';
      agent: string;
      workdir: string;
    }>();

    await Promise.all(liveSessions.map(async (session) => {
      const role = await this.backend.getSessionRole(session.name);
      if (role !== 'worker' && role !== 'copilot') return;

      const [agent, workdir] = await Promise.all([
        this.backend.getSessionAgent(session.name),
        this.backend.getSessionWorkdir(session.name),
      ]);

      discoveredSessions.set(session.name, {
        role,
        agent: agent || 'unknown',
        workdir: workdir || '',
      });
    }));

    return this.updateSessionState((state) => {
      const now = new Date().toISOString();

      // Reconcile workers
      for (const [key, worker] of Object.entries(state.workers)) {
        // Backfill workerId for workers created before this feature
        if (worker.workerId == null) {
          worker.workerId = state.nextWorkerId++;
        }
        const live = liveSessionMap.get(worker.sessionName);
        if (live) {
          worker.status = 'running';
          worker.attached = live.attached;
          worker.lastSeenAt = now;
        } else if (worker.workdir && fs.existsSync(worker.workdir)) {
          worker.status = 'stopped';
          worker.attached = false;
        } else {
          // Orphan: tmux dead + no worktree
          delete state.workers[key];
        }
      }

      // Reconcile copilots
      for (const [key, copilot] of Object.entries(state.copilots)) {
        const live = liveSessionMap.get(copilot.sessionName);
        if (live) {
          copilot.status = 'running';
          copilot.attached = live.attached;
          copilot.lastSeenAt = now;
        } else {
          delete state.copilots[key];
        }
      }

      // Discover live sessions with @hydra-role not yet in JSON
      const knownSessionNames = new Set([
        ...Object.values(state.workers).map(w => w.sessionName),
        ...Object.values(state.copilots).map(c => c.sessionName),
      ]);

      for (const session of liveSessions) {
        if (knownSessionNames.has(session.name)) continue;

        const discovered = discoveredSessions.get(session.name);
        if (!discovered) continue;

        if (discovered.role === 'worker') {
          // Derive repoRoot from workdir path via .repo-root marker or legacy path pattern
          let repoRoot = '';
          if (discovered.workdir) {
            repoRoot = coreGit.resolveRepoRootFromWorktreePath(discovered.workdir) || '';
          }
          const slug = this.extractSlugFromSessionName(session.name);
          state.workers[session.name] = {
            sessionName: session.name,
            displayName: slug,
            workerId: state.nextWorkerId++,
            repo: repoRoot ? path.basename(repoRoot) : 'unknown',
            repoRoot,
            branch: '',
            slug,
            status: 'running',
            attached: session.attached,
            agent: discovered.agent,
            workdir: discovered.workdir,
            tmuxSession: session.name,
            createdAt: now,
            lastSeenAt: now,
            sessionId: null,
            copilotSessionName: null,
          };
        } else {
          state.copilots[session.name] = {
            sessionName: session.name,
            displayName: session.name,
            status: 'running',
            attached: session.attached,
            agent: discovered.agent,
            workdir: discovered.workdir,
            tmuxSession: session.name,
            createdAt: now,
            lastSeenAt: now,
            sessionId: null,
          };
        }
      }

      state.updatedAt = now;
      return state;
    });
  }

  async listWorkers(repoRoot?: string): Promise<WorkerInfo[]> {
    const state = await this.sync();
    const workers = Object.values(state.workers);
    if (!repoRoot) return workers;
    const canonical = path.resolve(repoRoot);
    return workers.filter(w => path.resolve(w.repoRoot) === canonical);
  }

  async listCopilots(repoRoot?: string): Promise<CopilotInfo[]> {
    const state = await this.sync();
    const copilots = Object.values(state.copilots);
    if (!repoRoot) return copilots;
    const canonical = path.resolve(repoRoot);
    return copilots.filter(c => c.workdir && path.resolve(c.workdir).startsWith(canonical));
  }

  async getWorker(sessionName: string): Promise<WorkerInfo | undefined> {
    const state = await this.sync();
    return state.workers[sessionName];
  }

  // ── Worker Lifecycle ──

  async createWorker(opts: CreateWorkerOpts): Promise<CreateWorkerResult> {
    ensureHydraGlobalConfig();

    const { repoRoot, branchName } = opts;
    let { task, taskFile } = opts;
    const agentType = opts.agentType || 'claude';
    const agentCommand = await this.resolveAgentCommand(opts.agentCommand || DEFAULT_AGENT_COMMANDS[agentType] || agentType);

    const validationError = coreGit.validateBranchName(branchName);
    if (validationError) {
      throw new Error(validationError);
    }

    const repoSessionNamespace = coreGit.getRepoSessionNamespace(repoRoot, this.backend);

    // Check if branch already exists (resume logic)
    const branchExists = await coreGit.localBranchExists(repoRoot, branchName);
    if (branchExists) {
      return this.resumeWorker(repoRoot, branchName, repoSessionNamespace, agentType, agentCommand, task);
    }

    // Fetch latest from remote before creating worktree
    await coreGit.fetchOrigin(repoRoot);

    // Detect base branch
    const baseBranch = await coreGit.getBaseBranchFromRepo(repoRoot, opts.baseBranchOverride);

    // Warn if local base branch has commits ahead of remote
    const aheadCount = await coreGit.getLocalAheadCount(repoRoot, baseBranch);
    if (aheadCount > 0) {
      const localRef = baseBranch.startsWith('origin/') ? baseBranch.replace(/^origin\//, '') : baseBranch;
      console.warn(
        `[hydra] Warning: local "${localRef}" is ${aheadCount} commit(s) ahead of remote. ` +
        `Worktree will be based on the remote ref to ensure up-to-date code.`,
      );
    }

    // Slug collision resolution
    const slug = coreGit.branchNameToSlug(branchName, this.backend);
    let finalSlug = slug;
    let suffix = 1;
    while (await coreGit.isSlugTaken(finalSlug, repoSessionNamespace, repoRoot, this.backend)) {
      suffix++;
      finalSlug = `${slug}-${suffix}`;
    }

    // Create worktree
    const worktreePath = await coreGit.addWorktree(repoRoot, branchName, finalSlug, baseBranch);

    let taskFilename: string | undefined;
    if (taskFile) {
      const absTaskFile = path.isAbsolute(taskFile) ? taskFile : path.resolve(taskFile);
      if (fs.existsSync(absTaskFile)) {
        taskFilename = path.basename(absTaskFile);
        const targetTaskFile = path.join(worktreePath, taskFilename);
        fs.copyFileSync(absTaskFile, targetTaskFile);

        // If no task prompt given, instruct agent to read the file
        if (!task) {
          task = `Read the task in \`${taskFilename}\` and implement it.`;
        }
      }
    }

    // Resolve @imports in instruction files
    this.resolveImports(path.join(worktreePath, 'CLAUDE.md'), repoRoot);
    this.resolveImports(path.join(worktreePath, 'AGENTS.md'), repoRoot);
    this.resolveImports(path.join(worktreePath, 'GEMINI.md'), repoRoot);

    // Inject agent completion hook (must be before agent launch so it reads the config)
    const sessionName = this.backend.buildSessionName(repoSessionNamespace, finalSlug);
    if (opts.notifyCopilot !== false && opts.copilotSessionName && (task || taskFile)) {
      const peekState = this.readSessionState();
      const workerId = peekState.workers[sessionName]?.workerId ?? peekState.nextWorkerId;
      this.injectCompletionHook(worktreePath, agentType, {
        copilotSessionName: opts.copilotSessionName,
        sessionName,
        workerId,
        displayName: finalSlug,
        branch: branchName,
      });
    }

    // Create tmux session + set metadata
    await this.backend.createSession(sessionName, worktreePath);
    await this.backend.setSessionWorkdir(sessionName, worktreePath);
    await this.backend.setSessionRole(sessionName, 'worker');
    await this.backend.setSessionAgent(sessionName, agentType);

    // ── Launch agent ──
    //
    // Two distinct paths — resume (from archive) vs fresh create:
    //
    // Resume: session ID already known, launch with --resume, skip Phase 1.
    // Fresh:  all 3 agents converge to sessionId stored in sessions.json:
    //   - Claude: pre-assigned via --session-id flag (known immediately)
    //   - Codex:  launch → wait for ready → send /status → parse session ID
    //   - Gemini: launch → wait for ready → send /stats → parse session ID
    const isResume = !!opts.resumeSessionId;
    let sessionId: string | null;

    if (isResume) {
      sessionId = opts.resumeSessionId!;
      const resumeCmd = buildAgentResumeCommand(agentType, agentCommand, sessionId);
      if (!resumeCmd) {
        throw new Error(`Agent "${agentType}" does not support session resume`);
      }
      await this.backend.sendKeys(sessionName, resumeCmd);
    } else {
      sessionId = agentType === 'claude' ? randomUUID() : null;
      const launchCmd = buildAgentLaunchCommand(agentType, agentCommand, undefined, sessionId ?? undefined);
      await this.backend.sendKeys(sessionName, launchCmd);
    }

    // Write initial state to sessions.json
    // (sessionId may be null for Codex/Gemini until Phase 1 capture completes)
    const workerInfo = await this.updateSessionState((state) => {
      const now = new Date().toISOString();
      const existingWorker = state.workers[sessionName];
      const workerId = existingWorker?.workerId ?? state.nextWorkerId++;

      const nextWorker: WorkerInfo = {
        sessionName,
        displayName: finalSlug,
        workerId,
        repo: coreGit.getRepoName(repoRoot),
        repoRoot,
        branch: branchName,
        slug: finalSlug,
        status: 'running',
        attached: false,
        agent: agentType,
        workdir: worktreePath,
        tmuxSession: sessionName,
        createdAt: existingWorker?.createdAt ?? now,
        lastSeenAt: now,
        sessionId: sessionId ?? existingWorker?.sessionId ?? null,
        copilotSessionName: opts.copilotSessionName ?? existingWorker?.copilotSessionName ?? null,
      };

      state.workers[sessionName] = nextWorker;
      state.updatedAt = now;
      return nextWorker;
    });

    // Async post-create
    const postCreatePromise = this.withPostCreateTimeout((async () => {
      if (isResume) {
        // Resume: skip Phase 1 (sessionId already known), just wait for readiness
        await this.waitForAgentReady(sessionName, agentType);
      } else {
        // Phase 1: Wait for readiness & capture session ID into sessions.json
        await this.waitForReadyAndCaptureSessionId(sessionName, agentType, sessionId);
      }
      // Phase 2: Send task prompt (only after sessions.json is up to date)
      await this.sendInitialPrompt(sessionName, task);
    })(), sessionName, 'worker startup');

    return { workerInfo, postCreatePromise };
  }

  async deleteWorker(sessionName: string): Promise<void> {
    await this.killSessionOrConfirmAbsent(sessionName);

    const worker = this.readSessionState().workers[sessionName];

    // Archive before removing
    if (worker) {
      this.archiveEntry('worker', worker.sessionName, worker.sessionId, worker);
    }

    if (worker && worker.workdir && worker.repoRoot && fs.existsSync(worker.workdir)) {
      try {
        await coreGit.removeWorktree(worker.repoRoot, worker.workdir);
      } catch { /* Force removal fallback */ }

      if (worker.branch) {
        try {
          await exec(`git branch -D ${shellQuote(worker.branch)}`, { cwd: worker.repoRoot });
        } catch { /* Branch may not exist */ }
      }
    }

    await this.updateSessionState((state) => {
      if (state.workers[sessionName]) {
        delete state.workers[sessionName];
        state.updatedAt = new Date().toISOString();
      }
    });
  }

  async stopWorker(sessionName: string): Promise<void> {
    try {
      await this.backend.killSession(sessionName);
    } catch { /* Already dead */ }

    await this.updateSessionState((state) => {
      if (state.workers[sessionName]) {
        state.workers[sessionName].status = 'stopped';
        state.workers[sessionName].attached = false;
        state.updatedAt = new Date().toISOString();
      }
    });
  }

  async startWorker(sessionName: string, agentType?: string, agentCommand?: string): Promise<CreateWorkerResult> {
    const existingWorker = this.readSessionState().workers[sessionName];
    if (!existingWorker) {
      throw new Error(`Worker "${sessionName}" not found in sessions.json`);
    }

    if (!existingWorker.workdir || !fs.existsSync(existingWorker.workdir)) {
      throw new Error(`Worktree "${existingWorker.workdir}" does not exist`);
    }

    const agent = agentType || existingWorker.agent || 'claude';
    const command = await this.resolveAgentCommand(agentCommand || DEFAULT_AGENT_COMMANDS[agent] || agent);

    await this.backend.createSession(sessionName, existingWorker.workdir);
    await this.backend.setSessionWorkdir(sessionName, existingWorker.workdir);
    await this.backend.setSessionRole(sessionName, 'worker');
    await this.backend.setSessionAgent(sessionName, agent);

    // Resume from stored session ID if available; otherwise fresh start
    const storedSessionId = existingWorker.sessionId;
    const resumeCmd = storedSessionId
      ? buildAgentResumeCommand(agent, command, storedSessionId)
      : null;

    let workerInfo: WorkerInfo;
    let postCreatePromise: Promise<void>;

    if (resumeCmd) {
      // ── Resume flow: launch with --resume, no session ID capture needed ──
      // The agent already has its conversation context; just restart it.
      await this.backend.sendKeys(sessionName, resumeCmd);
      workerInfo = await this.updateSessionState((currentState) => {
        const currentWorker = currentState.workers[sessionName];
        if (!currentWorker) {
          throw new Error(`Worker "${sessionName}" not found in sessions.json`);
        }

        currentWorker.status = 'running';
        currentWorker.attached = false;
        currentWorker.agent = agent;
        currentWorker.lastSeenAt = new Date().toISOString();
        currentState.updatedAt = currentWorker.lastSeenAt;
        return { ...currentWorker };
      });
      // Wait for the resumed TUI to reach its idle prompt so follow-up CLI
      // commands can run immediately without racing the agent startup.
      postCreatePromise = this.waitForAgentReady(sessionName, agent);
    } else {
      // ── Fresh start: Phase 1 (capture sessionId) ──
      // No stored session ID — launch fresh agent and capture new session ID.
      const preAssignedSessionId = agent === 'claude' ? randomUUID() : null;
      const launchCmd = buildAgentLaunchCommand(agent, command, undefined, preAssignedSessionId ?? undefined);
      await this.backend.sendKeys(sessionName, launchCmd);

      workerInfo = await this.updateSessionState((currentState) => {
        const currentWorker = currentState.workers[sessionName];
        if (!currentWorker) {
          throw new Error(`Worker "${sessionName}" not found in sessions.json`);
        }

        currentWorker.status = 'running';
        currentWorker.attached = false;
        currentWorker.agent = agent;
        currentWorker.sessionId = preAssignedSessionId;
        currentWorker.lastSeenAt = new Date().toISOString();
        currentState.updatedAt = currentWorker.lastSeenAt;
        return { ...currentWorker };
      });

      // Phase 1 only — startWorker is a restart, no task to send (Phase 2 skipped)
      postCreatePromise = this.waitForReadyAndCaptureSessionId(sessionName, agent, preAssignedSessionId);
    }

    return {
      workerInfo,
      postCreatePromise: this.withPostCreateTimeout(postCreatePromise, sessionName, 'worker startup'),
    };
  }

  // ── Copilot Lifecycle ──

  async createCopilot(opts: CreateCopilotOpts): Promise<CreateCopilotResult> {
    ensureHydraGlobalConfig();

    const agentType = opts.agentType || 'claude';
    const agentCommand = await this.resolveAgentCommand(opts.agentCommand || DEFAULT_AGENT_COMMANDS[agentType] || agentType);
    const displayName = opts.name || opts.sessionName || `hydra-copilot-${agentType}`;
    const sessionName = opts.sessionName || this.backend.sanitizeSessionName(`hydra-copilot-${agentType}`);

    const exists = await this.backend.hasSession(sessionName);
    if (exists) {
      throw new Error(`Session "${sessionName}" already exists`);
    }

    await this.backend.createSession(sessionName, opts.workdir);
    await this.backend.setSessionWorkdir(sessionName, opts.workdir);
    await this.backend.setSessionRole(sessionName, 'copilot');
    await this.backend.setSessionAgent(sessionName, agentType);

    // ── Launch agent ──
    // Same two paths as createWorker: resume vs fresh.
    const isResume = !!opts.resumeSessionId;
    let sessionId: string | null;

    let postCreatePromise = Promise.resolve();

    if (isResume) {
      sessionId = opts.resumeSessionId!;
      const resumeCmd = buildAgentResumeCommand(agentType, agentCommand, sessionId);
      if (!resumeCmd) {
        throw new Error(`Agent "${agentType}" does not support session resume`);
      }
      await this.backend.sendKeys(sessionName, resumeCmd);
    } else {
      sessionId = agentType === 'claude' ? randomUUID() : null;
      const launchCmd = buildAgentLaunchCommand(agentType, agentCommand, undefined, sessionId ?? undefined);
      await this.backend.sendKeys(sessionName, launchCmd);
    }

    // Write initial state to sessions.json
    const now = new Date().toISOString();
    const copilotInfo: CopilotInfo = {
      sessionName,
      displayName,
      status: 'running',
      attached: false,
      agent: agentType,
      workdir: opts.workdir,
      tmuxSession: sessionName,
      createdAt: now,
      lastSeenAt: now,
      sessionId,
    };

    const persistedCopilotInfo = await this.updateSessionState((state) => {
      const existingCopilot = state.copilots[sessionName];
      const nextCopilot: CopilotInfo = {
        ...copilotInfo,
        createdAt: existingCopilot?.createdAt ?? now,
        sessionId: sessionId ?? existingCopilot?.sessionId ?? null,
      };

      state.copilots[sessionName] = nextCopilot;
      state.updatedAt = now;
      return nextCopilot;
    });

    // Match worker lifecycle semantics: wait for readiness and persist any deferred
    // session ID capture before the CLI treats creation as complete.
    postCreatePromise = this.withPostCreateTimeout(
      this.waitForReadyAndCaptureSessionId(sessionName, agentType, sessionId),
      sessionName,
      'copilot startup',
    );

    return { copilotInfo: persistedCopilotInfo, postCreatePromise };
  }

  async createCopilotAndFinalize(opts: CreateCopilotOpts): Promise<CopilotInfo> {
    return this.finalizeCopilotResult(await this.createCopilot(opts));
  }

  async restoreCopilotAndFinalize(sessionName: string): Promise<CopilotInfo> {
    return this.finalizeCopilotResult(await this.restoreCopilot(sessionName));
  }

  async renameWorker(oldSessionName: string, newBranchName: string): Promise<WorkerInfo> {
    const state = this.readSessionState();
    const worker = state.workers[oldSessionName];
    if (!worker) {
      throw new Error(`Worker "${oldSessionName}" not found`);
    }

    if (!worker.repoRoot) {
      throw new Error(`Worker "${oldSessionName}" has no associated repository`);
    }

    // Validate new branch name
    const validationError = coreGit.validateBranchName(newBranchName);
    if (validationError) {
      throw new Error(validationError);
    }

    // Derive new slug, session name, worktree path
    const repoSessionNamespace = coreGit.getRepoSessionNamespace(worker.repoRoot, this.backend);
    const newSlug = coreGit.branchNameToSlug(newBranchName, this.backend);
    const newSessionName = this.backend.buildSessionName(repoSessionNamespace, newSlug);
    const worktreesDir = coreGit.getManagedRepoWorktreesDir(worker.repoRoot);
    const newWorktreePath = path.join(worktreesDir, newSlug);

    // Check conflicts
    if (newSessionName !== oldSessionName && (state.workers[newSessionName] || state.copilots[newSessionName])) {
      throw new Error(`Session "${newSessionName}" already exists`);
    }
    if (await coreGit.localBranchExists(worker.repoRoot, newBranchName)) {
      throw new Error(`Branch "${newBranchName}" already exists`);
    }

    // 1. Rename git branch
    if (worker.branch) {
      await exec(
        `git branch -m ${shellQuote(worker.branch)} ${shellQuote(newBranchName)}`,
        { cwd: worker.repoRoot },
      );

      // Update vscode-merge-base config
      try {
        const baseBranch = await exec(
          `git config ${shellQuote(`branch.${worker.branch}.vscode-merge-base`)}`,
          { cwd: worker.repoRoot },
        );
        if (baseBranch.trim()) {
          await exec(
            `git config ${shellQuote(`branch.${newBranchName}.vscode-merge-base`)} ${shellQuote(baseBranch.trim())}`,
            { cwd: worker.repoRoot },
          );
        }
      } catch {
        // No vscode-merge-base config — skip
      }
      try {
        await exec(
          `git config --unset ${shellQuote(`branch.${worker.branch}.vscode-merge-base`)}`,
          { cwd: worker.repoRoot },
        );
      } catch {
        // Already absent — skip
      }
    }

    // 2. Move worktree directory (if it's a managed worktree and slug changed)
    if (worker.workdir && newSlug !== worker.slug && fs.existsSync(worker.workdir)) {
      await exec(
        `git worktree move ${shellQuote(worker.workdir)} ${shellQuote(newWorktreePath)}`,
        { cwd: worker.repoRoot },
      );
    }

    // 3. Rename tmux session (if running and name changed)
    if (newSessionName !== oldSessionName) {
      const hasLive = await this.backend.hasSession(oldSessionName);
      if (hasLive) {
        await this.backend.renameSession(oldSessionName, newSessionName);

        // Update @workdir metadata if worktree moved
        if (newSlug !== worker.slug) {
          await this.backend.setSessionWorkdir(newSessionName, newWorktreePath);
        }
      }
    }

    return this.updateSessionState((currentState) => {
      const currentWorker = currentState.workers[oldSessionName];
      if (!currentWorker) {
        throw new Error(`Worker "${oldSessionName}" not found`);
      }

      const worktreeMoved = newSlug !== currentWorker.slug && fs.existsSync(newWorktreePath);
      delete currentState.workers[oldSessionName];
      currentWorker.sessionName = newSessionName;
      currentWorker.displayName = newSlug;
      currentWorker.tmuxSession = newSessionName;
      currentWorker.branch = newBranchName;
      currentWorker.slug = newSlug;
      if (worktreeMoved) {
        currentWorker.workdir = newWorktreePath;
      }
      currentState.workers[newSessionName] = currentWorker;
      currentState.updatedAt = new Date().toISOString();
      return { ...currentWorker };
    });
  }

  async renameCopilot(oldSessionName: string, newSessionName: string): Promise<CopilotInfo> {
    const state = this.readSessionState();
    const copilot = state.copilots[oldSessionName];
    if (!copilot) {
      throw new Error(`Copilot "${oldSessionName}" not found`);
    }

    // Validate new name
    const sanitized = this.backend.sanitizeSessionName(newSessionName);
    if (!sanitized) {
      throw new Error('New session name is invalid');
    }

    // Check conflict
    if (state.copilots[newSessionName] || state.workers[newSessionName]) {
      throw new Error(`Session "${newSessionName}" already exists`);
    }

    // Rename live tmux session (copilots are always running)
    const hasLive = await this.backend.hasSession(oldSessionName);
    if (hasLive) {
      await this.backend.renameSession(oldSessionName, newSessionName);
    }

    return this.updateSessionState((currentState) => {
      const currentCopilot = currentState.copilots[oldSessionName];
      if (!currentCopilot) {
        throw new Error(`Copilot "${oldSessionName}" not found`);
      }

      delete currentState.copilots[oldSessionName];
      currentCopilot.sessionName = newSessionName;
      currentCopilot.displayName = newSessionName;
      currentCopilot.tmuxSession = newSessionName;
      currentState.copilots[newSessionName] = currentCopilot;
      currentState.updatedAt = new Date().toISOString();
      return { ...currentCopilot };
    });
  }

  async deleteCopilot(sessionName: string): Promise<void> {
    try {
      await this.backend.killSession(sessionName);
    } catch { /* Already dead */ }

    const copilot = this.readSessionState().copilots[sessionName];

    // Archive before removing
    if (copilot) {
      this.archiveEntry('copilot', copilot.sessionName, copilot.sessionId, copilot);
    }

    await this.updateSessionState((state) => {
      if (state.copilots[sessionName]) {
        delete state.copilots[sessionName];
        state.updatedAt = new Date().toISOString();
      }
    });
  }

  // ── Public helpers for VS Code extension ──

  /**
   * Persist a copilot entry to sessions.json with pre-assigned session ID.
   * Called by the VS Code extension which creates sessions directly via backend.
   */
  async persistCopilotSessionId(
    sessionName: string,
    agentType: string,
    workdir: string,
    sessionId: string | null,
    displayName?: string,
  ): Promise<void> {
    await this.updateSessionState((state) => {
      const now = new Date().toISOString();
      const existingCopilot = state.copilots[sessionName];
      state.copilots[sessionName] = {
        sessionName,
        displayName: displayName || existingCopilot?.displayName || sessionName,
        status: 'running',
        attached: false,
        agent: agentType,
        workdir,
        tmuxSession: sessionName,
        createdAt: existingCopilot?.createdAt ?? now,
        lastSeenAt: now,
        sessionId: sessionId ?? existingCopilot?.sessionId ?? null,
      };
      state.updatedAt = now;
    });
  }

  /**
   * Capture session ID via slash command and persist to sessions.json.
   * Used by VS Code extension for Codex/Gemini copilots.
   */
  async captureAndPersistSessionId(sessionName: string, agentType: string): Promise<void> {
    const sessionId = await this.captureAgentSessionId(sessionName, agentType);
    await this.updateSessionId(sessionName, sessionId);
  }

  // ── Archive ──

  listArchived(): ArchivedSessionInfo[] {
    return this.readArchiveState().entries;
  }

  getArchivedAll(sessionName: string): ArchivedSessionInfo[] {
    return this.readArchiveState().entries.filter(e => e.sessionName === sessionName);
  }

  getArchived(sessionName: string): ArchivedSessionInfo | undefined {
    const all = this.getArchivedAll(sessionName);
    return all.length > 0 ? all[all.length - 1] : undefined;
  }

  listArchivedLatest(): ArchivedSessionInfo[] {
    const entries = this.readArchiveState().entries;
    const latest = new Map<string, ArchivedSessionInfo>();
    for (const entry of entries) {
      latest.set(entry.sessionName, entry);
    }
    return [...latest.values()];
  }

  async restoreWorker(sessionName: string): Promise<CreateWorkerResult> {
    const entry = this.getArchived(sessionName);
    if (!entry) {
      throw new Error(`Archived session "${sessionName}" not found`);
    }
    if (entry.type !== 'worker') {
      throw new Error(`Archived session "${sessionName}" is a copilot, not a worker`);
    }

    const worker = entry.data as WorkerInfo;
    return this.createWorker({
      repoRoot: worker.repoRoot,
      branchName: worker.branch,
      agentType: worker.agent,
      resumeSessionId: entry.agentSessionId || undefined,
    });
  }

  async restoreCopilot(sessionName: string): Promise<CreateCopilotResult> {
    const entry = this.getArchived(sessionName);
    if (!entry) {
      throw new Error(`Archived session "${sessionName}" not found`);
    }
    if (entry.type !== 'copilot') {
      throw new Error(`Archived session "${sessionName}" is a worker, not a copilot`);
    }

    const copilot = entry.data as CopilotInfo;
    return this.createCopilot({
      workdir: copilot.workdir,
      agentType: copilot.agent,
      name: copilot.displayName,
      sessionName: copilot.sessionName,
      resumeSessionId: entry.agentSessionId || undefined,
    });
  }

  // ── Private helpers ──

  private async finalizeCopilotResult(result: CreateCopilotResult): Promise<CopilotInfo> {
    await result.postCreatePromise;
    const state = await this.sync();
    return state.copilots[result.copilotInfo.sessionName] || result.copilotInfo;
  }

  private withPostCreateTimeout(
    promise: Promise<void>,
    sessionName: string,
    operation: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${operation} for "${sessionName}" after ${POST_CREATE_TIMEOUT_MS}ms`));
      }, POST_CREATE_TIMEOUT_MS);

      promise.then(
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      );
    });
  }

  private async killSessionOrConfirmAbsent(sessionName: string): Promise<void> {
    try {
      await this.backend.killSession(sessionName);
      return;
    } catch (error) {
      let hasLiveSession: boolean;
      try {
        hasLiveSession = await this.backend.hasSession(sessionName);
      } catch {
        throw error;
      }

      if (!hasLiveSession) {
        return;
      }

      throw error;
    }
  }

  private archiveEntry(
    type: 'worker' | 'copilot',
    sessionName: string,
    agentSessionId: string | null,
    data: WorkerInfo | CopilotInfo,
  ): void {
    const archive = this.readArchiveState();
    archive.entries.push({
      type,
      sessionName,
      agentSessionId,
      archivedAt: new Date().toISOString(),
      data: { ...data },
    });
    this.writeArchiveState(archive);
  }

  private readArchiveState(): ArchiveState {
    const archiveFile = getHydraArchiveFile();
    try {
      if (fs.existsSync(archiveFile)) {
        const raw = fs.readFileSync(archiveFile, 'utf-8');
        const parsed = JSON.parse(raw);
        return { entries: parsed.entries || [] };
      }
    } catch {
      // Corrupted file — start fresh
    }
    return { entries: [] };
  }

  private writeArchiveState(archive: ArchiveState): void {
    const archiveFile = getHydraArchiveFile();
    this.writeJsonAtomically(archiveFile, JSON.stringify(archive, null, 2));
  }

  private readSessionState(): SessionState {
    const sessionsFile = getHydraSessionsFile();
    try {
      if (fs.existsSync(sessionsFile)) {
        const raw = fs.readFileSync(sessionsFile, 'utf-8');
        const parsed = JSON.parse(raw);
        const state: SessionState = {
          copilots: parsed.copilots || {},
          workers: parsed.workers || {},
          nextWorkerId: parsed.nextWorkerId || 1,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
        // Backward compat: ensure sessionId and displayName fields exist for legacy entries
        for (const w of Object.values(state.workers)) {
          w.sessionId ??= null;
          w.displayName ??= w.slug || this.extractSlugFromSessionName(w.sessionName);
        }
        for (const c of Object.values(state.copilots)) {
          c.sessionId ??= null;
          c.displayName ??= c.sessionName;
        }
        return state;
      }
    } catch {
      // Corrupted file — start fresh
    }
    return { copilots: {}, workers: {}, nextWorkerId: 1, updatedAt: new Date().toISOString() };
  }

  private writeSessionState(state: SessionState): void {
    const sessionsFile = getHydraSessionsFile();
    this.writeJsonAtomically(sessionsFile, JSON.stringify(state, null, 2));
  }

  private async updateSessionState<T>(mutate: (state: SessionState) => T): Promise<T> {
    const release = await this.acquireSessionStateLock();
    try {
      const state = this.readSessionState();
      const result = mutate(state);
      this.writeSessionState(state);
      return result;
    } finally {
      await release();
    }
  }

  private async acquireSessionStateLock(): Promise<() => Promise<void>> {
    const sessionsFile = getHydraSessionsFile();
    const hydraHome = getHydraHome();
    if (!fs.existsSync(hydraHome)) {
      fs.mkdirSync(hydraHome, { recursive: true });
    }

    const lockFile = `${sessionsFile}.lock`;
    const deadline = Date.now() + SESSION_STATE_LOCK_TIMEOUT_MS;

    while (true) {
      try {
        const handle = await fs.promises.open(lockFile, 'wx');
        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2),
            'utf-8',
          );
        } catch (error) {
          await handle.close().catch(() => undefined);
          throw error;
        }

        return async () => {
          try {
            await handle.close();
          } finally {
            try {
              await fs.promises.unlink(lockFile);
            } catch {
              // Best-effort cleanup
            }
          }
        };
      } catch (error) {
        const err = error as { code?: string };
        if (err.code !== 'EEXIST') {
          throw error;
        }

        if (this.isSessionStateLockStale(lockFile)) {
          try {
            fs.unlinkSync(lockFile);
            continue;
          } catch (unlinkError) {
            const unlinkErr = unlinkError as { code?: string };
            if (unlinkErr.code === 'ENOENT') {
              continue;
            }
            throw unlinkError;
          }
        }

        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for sessions lock: ${lockFile}`);
        }

        await this.sleep(SESSION_STATE_LOCK_RETRY_MS);
      }
    }
  }

  private isSessionStateLockStale(lockFile: string): boolean {
    try {
      const stat = fs.statSync(lockFile);
      return (Date.now() - stat.mtimeMs) > SESSION_STATE_LOCK_STALE_MS;
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private writeJsonAtomically(filePath: string, contents: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempFile = path.join(
      dir,
      `${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
    );

    try {
      fs.writeFileSync(tempFile, contents, 'utf-8');
      fs.renameSync(tempFile, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {
        // Best-effort cleanup
      }
      throw error;
    }
  }

  /**
   * Resolve @imports: for each line in a file, if it starts with @<path>,
   * replace it with the contents of <repoRoot>/<path>.
   */
  private resolveImports(filePath: string, repoRoot: string): void {
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let changed = false;
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@') && !trimmed.startsWith('@{')) {
        const importPath = trimmed.substring(1);
        const absPath = path.resolve(repoRoot, importPath);
        if (fs.existsSync(absPath)) {
          result.push(fs.readFileSync(absPath, 'utf-8'));
          changed = true;
          continue;
        }
      }
      result.push(line);
    }

    if (changed) {
      fs.writeFileSync(filePath, result.join('\n'), 'utf-8');
    }
  }

  /**
   * ── Phase 1: Capture session ID ──
   *
   * Wait for agent readiness and ensure the agent's session ID is in sessions.json.
   * This is the convergence point for all 3 agents:
   *
   * - Claude: sessionId pre-assigned via --session-id flag → just wait for TUI readiness
   * - Codex: wait for readiness, send /status, parse session ID from output
   * - Gemini: wait for readiness, send /stats, parse session ID from output
   *
   * After this method completes, sessions.json has the definitive sessionId.
   * Skipped entirely on resume (sessionId already stored from the original create).
   */
  private async waitForReadyAndCaptureSessionId(
    sessionName: string,
    agentType: string,
    preAssignedSessionId: string | null,
  ): Promise<void> {
    if (preAssignedSessionId) {
      // Claude (or resume): sessionId already known — just wait for TUI readiness
      await this.waitForAgentReady(sessionName, agentType);
    } else {
      // Codex/Gemini: capture sessionId via slash command (includes readiness wait)
      const sessionId = await this.captureAgentSessionId(sessionName, agentType);
      await this.updateSessionId(sessionName, sessionId);
    }
  }

  /**
   * Send the initial task prompt to the agent.
   * Only called after waitForReadyAndCaptureSessionId completes
   * (i.e., sessions.json has the definitive sessionId).
   *
   * - Workers: send the task prompt (provided by copilot or --task flag)
   * - Copilots: VS Code extension sends onboarding prompt separately
   */
  private async sendInitialPrompt(
    sessionName: string,
    task?: string,
  ): Promise<void> {
    if (task) {
      await this.backend.sendMessage(sessionName, task);
    }
  }

  // ── Completion hook injection ──

  /**
   * Metadata needed to build the completion notification hook.
   * Gathered before updateSessionState so the hook is in place before the agent starts.
   */
  private injectCompletionHook(
    worktreePath: string,
    agentType: string,
    info: {
      copilotSessionName: string;
      sessionName: string;
      workerId: number;
      displayName: string;
      branch: string;
    },
  ): void {
    try {
      // 1. Write the notification shell script
      const hooksDir = path.join(getHydraHome(), 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      const scriptPath = path.join(hooksDir, `notify-${info.sessionName}.sh`);
      fs.writeFileSync(scriptPath, this.buildNotifyScript(info), { mode: 0o755 });

      const hookCommand = `sh ${shellQuote(scriptPath)}`;

      // 2. Merge the completion hook into the agent's config
      switch (agentType) {
        case 'claude':
          this.mergeAgentHookConfig(
            path.join(worktreePath, '.claude', 'settings.json'),
            'Stop',
            { hooks: [{ type: 'command', command: hookCommand, async: true }] },
          );
          break;
        case 'codex':
          this.mergeAgentHookConfig(
            path.join(worktreePath, '.codex', 'hooks.json'),
            'Stop',
            { hooks: [{ type: 'command', command: hookCommand }] },
          );
          // Codex requires the codex_hooks feature flag to be enabled
          this.ensureCodexHooksEnabled(path.join(worktreePath, '.codex', 'config.toml'));
          break;
        case 'gemini':
          this.mergeAgentHookConfig(
            path.join(worktreePath, '.gemini', 'settings.json'),
            'AfterAgent',
            { matcher: '*', hooks: [{ type: 'command', command: hookCommand }] },
          );
          break;
        // custom: no known hook system — skip
      }
    } catch {
      // Best-effort — don't fail worker creation if hook injection fails
    }
  }

  private mergeAgentHookConfig(
    configPath: string,
    eventName: string,
    hookEntry: Record<string, unknown>,
  ): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let config: any = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch { /* start fresh */ }

    if (!config.hooks) config.hooks = {};
    if (!Array.isArray(config.hooks[eventName])) config.hooks[eventName] = [];
    config.hooks[eventName].push(hookEntry);

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  private ensureCodexHooksEnabled(configTomlPath: string): void {
    fs.mkdirSync(path.dirname(configTomlPath), { recursive: true });

    const featureLine = 'codex_hooks = true';
    if (fs.existsSync(configTomlPath)) {
      const content = fs.readFileSync(configTomlPath, 'utf-8');
      if (content.includes(featureLine)) return; // already enabled
      // Append the feature flag
      fs.writeFileSync(
        configTomlPath,
        content.trimEnd() + '\n\n[features]\n' + featureLine + '\n',
        'utf-8',
      );
    } else {
      fs.writeFileSync(configTomlPath, '[features]\n' + featureLine + '\n', 'utf-8');
    }
  }

  private buildNotifyScript(info: {
    copilotSessionName: string;
    sessionName: string;
    workerId: number;
    displayName: string;
    branch: string;
  }): string {
    const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    return [
      '#!/bin/sh',
      '# Auto-generated by Hydra — notifies the parent copilot when this worker responds.',
      '',
      `COPILOT=${sq(info.copilotSessionName)}`,
      `SESSION=${sq(info.sessionName)}`,
      `WORKER_ID=${sq(String(info.workerId))}`,
      `NAME=${sq(info.displayName)}`,
      `BRANCH=${sq(info.branch)}`,
      '',
      '# Resolve tmux command (honors HYDRA_TMUX_SOCKET if set)',
      't=tmux',
      'if [ -n "$HYDRA_TMUX_SOCKET" ]; then',
      '  case "$HYDRA_TMUX_SOCKET" in',
      '    /*|./*|../*) t="tmux -S $HYDRA_TMUX_SOCKET" ;;',
      '    *) t="tmux -L $HYDRA_TMUX_SOCKET" ;;',
      '  esac',
      'fi',
      '',
      '# Only notify if copilot session still exists',
      '$t has-session -t "$COPILOT" 2>/dev/null || exit 0',
      '',
      'MSG="Worker #${WORKER_ID} (${NAME}) has completed. Branch: ${BRANCH}. Use \\`hydra worker logs ${SESSION}\\` to review output."',
      '',
      '# Use load-buffer/paste-buffer to avoid the Enter-swallow issue (see PR #122)',
      'f=$(mktemp) || exit 0',
      'printf \'%s\' "$MSG" > "$f"',
      'b="hydra-$$"',
      '$t load-buffer -b "$b" "$f" 2>/dev/null',
      '$t paste-buffer -b "$b" -t "$COPILOT" -d 2>/dev/null',
      'sleep 0.1',
      '$t send-keys -t "$COPILOT" Enter 2>/dev/null',
      'rm -f "$f"',
    ].join('\n') + '\n';
  }

  /**
   * Poll the tmux pane output until the agent's ready indicator appears,
   * or fall back to the fixed delay on timeout.
   *
   * Handles the Claude trust prompt: if detected, sends Enter to accept it
   * before continuing to poll for the actual input prompt.
   */
  private async waitForAgentReady(sessionName: string, agentType: string): Promise<void> {
    const pattern = AGENT_READY_PATTERNS[agentType];
    if (!pattern) {
      // No known ready pattern — fall back to fixed delay
      await this.sleep(CLAUDE_READY_DELAY_MS);
      return;
    }

    const deadline = Date.now() + AGENT_READY_TIMEOUT_MS;
    let trustPromptHandled = false;

    // Initial delay before first poll (agent needs time to start the process)
    await this.sleep(AGENT_READY_POLL_INTERVAL_MS);

    while (Date.now() < deadline) {
      try {
        const output = await this.backend.capturePane(sessionName, 50);

        if (pattern.test(output)) {
          // Brief settle delay — TUI input handler may not be fully interactive yet
          await this.sleep(AGENT_READY_POLL_INTERVAL_MS);
          return;
        }

        // Handle trust prompt: send Enter to accept "Yes, I trust this folder"
        if (!trustPromptHandled && CLAUDE_TRUST_PROMPT_PATTERN.test(output)) {
          await this.backend.sendKeys(sessionName, '');
          trustPromptHandled = true;
        }
      } catch {
        // Session may not be ready yet — keep polling
      }
      await this.sleep(AGENT_READY_POLL_INTERVAL_MS);
    }

    // Timeout reached — proceed anyway (best-effort, matches old behavior)
  }

  /**
   * Capture session ID by sending a slash command (/status or /stats) to the agent,
   * waiting for output, and parsing the result from the terminal pane.
   *
   * Used for Codex and Gemini. Claude uses --session-id flag instead.
   * Returns null on failure (graceful fallback).
   */
  private async captureAgentSessionId(
    sessionName: string,
    agentType: string,
  ): Promise<string | null> {
    const config = AGENT_SESSION_CAPTURE[agentType];
    if (!config) return null;

    try {
      // For Codex, accept the trust prompt first
      if (agentType === 'codex') {
        await this.sleep(3000);
        await this.backend.sendKeys(sessionName, ''); // Enter to accept trust prompt
        await this.sleep(config.readyDelayMs);
      } else {
        await this.sleep(config.readyDelayMs);
      }

      // Send status slash command (use sendMessage for reliable Enter delivery to TUIs)
      await this.backend.sendMessage(sessionName, config.statusCommand);

      // Poll pane output until session ID is found
      const maxAttempts = 10;
      const pollInterval = config.captureDelayMs;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await this.sleep(pollInterval);
        const output = await this.backend.capturePane(sessionName, 200);
        const match = output.match(config.sessionIdPattern);
        if (match?.[1]) {
          return match[1];
        }
      }

      console.warn(
        `[hydra] Could not parse session ID for ${agentType} in ${sessionName}`,
      );
      return null;
    } catch (error) {
      console.warn(`[hydra] Session ID capture failed for ${sessionName}:`, error);
      return null;
    }
  }

  private async updateSessionId(sessionName: string, sessionId: string | null): Promise<void> {
    await this.updateSessionState((state) => {
      if (state.workers[sessionName]) {
        state.workers[sessionName].sessionId = sessionId;
        state.updatedAt = new Date().toISOString();
      } else if (state.copilots[sessionName]) {
        state.copilots[sessionName].sessionId = sessionId;
        state.updatedAt = new Date().toISOString();
      }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private extractSlugFromSessionName(sessionName: string): string {
    const underscoreIdx = sessionName.indexOf('_');
    if (underscoreIdx >= 0) {
      return sessionName.substring(underscoreIdx + 1);
    }
    return sessionName;
  }

  private async resolveAgentCommand(agentCommand: string): Promise<string> {
    const trimmed = agentCommand.trim();
    if (!trimmed) return agentCommand;

    const [binary, ...rest] = trimmed.split(/\s+/);
    if (!binary || binary.includes('/') || binary.includes('\\')) return trimmed;

    try {
      const resolved = await resolveCommandPath(binary);
      if (!resolved) return trimmed;
      return [shellQuote(resolved), ...rest].join(' ');
    } catch {
      return trimmed;
    }
  }

  private async resumeWorker(
    repoRoot: string,
    branchName: string,
    repoSessionNamespace: string,
    agentType: string,
    agentCommand: string,
    task?: string,
  ): Promise<CreateWorkerResult> {
    const slug = coreGit.branchNameToSlug(branchName, this.backend);
    const sessionName = this.backend.buildSessionName(repoSessionNamespace, slug);

    const isRunning = await this.backend.hasSession(sessionName);
    if (isRunning) {
      if (task) {
        await this.backend.sendKeys(sessionName, task);
      }

      const workdir = await this.backend.getSessionWorkdir(sessionName) || '';
      const agent = await this.backend.getSessionAgent(sessionName) || agentType;
      const now = new Date().toISOString();

      const workerInfo = await this.updateSessionState((state) => {
        const existingWorker = state.workers[sessionName];
        const workerId = existingWorker?.workerId ?? state.nextWorkerId++;
        const nextWorker: WorkerInfo = {
          sessionName,
          displayName: slug,
          workerId,
          repo: coreGit.getRepoName(repoRoot),
          repoRoot,
          branch: branchName,
          slug,
          status: 'running',
          attached: false,
          agent,
          workdir,
          tmuxSession: sessionName,
          createdAt: existingWorker?.createdAt ?? now,
          lastSeenAt: now,
          sessionId: existingWorker?.sessionId ?? null,
          copilotSessionName: existingWorker?.copilotSessionName ?? null,
        };

        state.workers[sessionName] = nextWorker;
        state.updatedAt = now;
        return nextWorker;
      });

      return {
        workerInfo,
        postCreatePromise: this.withPostCreateTimeout(Promise.resolve(), sessionName, 'worker startup'),
      };
    }

    // Worktree exists but tmux is dead — check new and legacy locations
    const worktreesDir = coreGit.getManagedRepoWorktreesDir(repoRoot);
    let worktreePath = path.join(worktreesDir, slug);
    if (!fs.existsSync(worktreePath)) {
      // Fallback: check legacy in-repo location
      const legacyDir = coreGit.getInRepoWorktreesDir(repoRoot);
      const legacyPath = path.join(legacyDir, slug);
      if (fs.existsSync(legacyPath)) {
        worktreePath = legacyPath;
      }
    }
    if (fs.existsSync(worktreePath)) {
      await this.backend.createSession(sessionName, worktreePath);
      await this.backend.setSessionWorkdir(sessionName, worktreePath);
      await this.backend.setSessionRole(sessionName, 'worker');
      await this.backend.setSessionAgent(sessionName, agentType);

      const now = new Date().toISOString();
      const existingWorker = this.readSessionState().workers[sessionName];
      const storedSessionId = existingWorker?.sessionId;

      // Resume or fresh start
      const resumeCmd = storedSessionId
        ? buildAgentResumeCommand(agentType, agentCommand, storedSessionId)
        : null;

      let postCreatePromise: Promise<void>;
      let sessionId: string | null;

      if (resumeCmd) {
        // ── Resume flow: launch with --resume, no session ID capture needed ──
        // The agent already has its conversation context from the previous session.
        await this.backend.sendKeys(sessionName, resumeCmd);
        sessionId = storedSessionId;
        // Skip Phase 1 (sessionId already known). Phase 2 only: send task if provided.
        postCreatePromise = (async () => {
          await this.waitForAgentReady(sessionName, agentType);
          await this.sendInitialPrompt(sessionName, task);
        })();
      } else {
        // ── Fresh start: Phase 1 (capture sessionId) → Phase 2 (send task) ──
        const preAssignedSessionId = agentType === 'claude' ? randomUUID() : null;
        const launchCmd = buildAgentLaunchCommand(agentType, agentCommand, undefined, preAssignedSessionId ?? undefined);
        await this.backend.sendKeys(sessionName, launchCmd);
        sessionId = preAssignedSessionId;
        postCreatePromise = (async () => {
          await this.waitForReadyAndCaptureSessionId(sessionName, agentType, preAssignedSessionId);
          await this.sendInitialPrompt(sessionName, task);
        })();
      }

      const workerInfo = await this.updateSessionState((state) => {
        const currentWorker = state.workers[sessionName];
        const workerId = currentWorker?.workerId ?? state.nextWorkerId++;
        const nextWorker: WorkerInfo = {
          sessionName,
          displayName: slug,
          workerId,
          repo: coreGit.getRepoName(repoRoot),
          repoRoot,
          branch: branchName,
          slug,
          status: 'running',
          attached: false,
          agent: agentType,
          workdir: worktreePath,
          tmuxSession: sessionName,
          createdAt: currentWorker?.createdAt ?? now,
          lastSeenAt: now,
          sessionId,
          copilotSessionName: currentWorker?.copilotSessionName ?? null,
        };

        state.workers[sessionName] = nextWorker;
        state.updatedAt = now;
        return nextWorker;
      });

      return {
        workerInfo,
        postCreatePromise: this.withPostCreateTimeout(postCreatePromise, sessionName, 'worker startup'),
      };
    }

    throw new Error(`Branch "${branchName}" exists but has no managed worktree. Delete the branch first or use a different name.`);
  }
}
