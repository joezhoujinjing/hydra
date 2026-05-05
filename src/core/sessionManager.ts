import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { MultiplexerBackendCore } from './types';
import * as coreGit from './git';
import { injectWorkerInstructions, ensureHydraGlobalConfig } from './hydraGlobalConfig';
import { buildAgentLaunchCommand, buildAgentResumeCommand, DEFAULT_AGENT_COMMANDS, AGENT_SESSION_CAPTURE, CLAUDE_READY_DELAY_MS } from './agentConfig';
import { exec } from './exec';
import { shellQuote } from './shell';

const HYDRA_DIR = path.join(os.homedir(), '.hydra');
const SESSIONS_FILE = path.join(HYDRA_DIR, 'sessions.json');

/**
 * Look up a worker's numeric ID from sessions.json.
 * Lightweight standalone function — no SessionManager instance needed.
 */
export function lookupWorkerId(sessionName: string): number | undefined {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
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
}

export interface CopilotInfo {
  sessionName: string;
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

type SessionSnapshot = Record<string, never>;

export interface CreateWorkerOpts {
  repoRoot: string;
  branchName: string;
  agentType?: string;
  baseBranchOverride?: string;
  task?: string;
  taskFile?: string;
  agentCommand?: string;
}

export interface CreateCopilotOpts {
  workdir: string;
  agentType?: string;
  sessionName?: string;
  agentCommand?: string;
}

export interface CreateWorkerResult {
  workerInfo: WorkerInfo;
  /** Resolves after the delayed Enter is sent (for Claude trust prompt). CLI should await this. */
  postCreatePromise: Promise<void>;
}

// ── SessionManager Class ──

export class SessionManager {
  constructor(private backend: MultiplexerBackendCore) {}

  // ── Sync: reconcile sessions.json <-> live multiplexer ──

  async sync(): Promise<SessionState> {
    const state = this.readSessionState();
    const liveSessions = await this.backend.listSessions();
    const liveSessionMap = new Map(liveSessions.map(s => [s.name, s]));
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

      const role = await this.backend.getSessionRole(session.name);
      if (!role) continue;

      const agent = await this.backend.getSessionAgent(session.name) || 'unknown';
      const workdir = await this.backend.getSessionWorkdir(session.name) || '';

      if (role === 'worker') {
        // Derive repoRoot from workdir path: workdir is <repoRoot>/.hydra/worktrees/<slug>
        let repoRoot = '';
        if (workdir) {
          const hydraIdx = workdir.indexOf('/.hydra/worktrees/');
          if (hydraIdx >= 0) {
            repoRoot = workdir.substring(0, hydraIdx);
          }
        }
        state.workers[session.name] = {
          sessionName: session.name,
          workerId: state.nextWorkerId++,
          repo: repoRoot ? path.basename(repoRoot) : 'unknown',
          repoRoot,
          branch: '',
          slug: this.extractSlugFromSessionName(session.name),
          status: 'running',
          attached: session.attached,
          agent,
          workdir,
          tmuxSession: session.name,
          createdAt: now,
          lastSeenAt: now,
          sessionId: null,
        };
      } else if (role === 'copilot') {
        state.copilots[session.name] = {
          sessionName: session.name,
          status: 'running',
          attached: session.attached,
          agent,
          workdir,
          tmuxSession: session.name,
          createdAt: now,
          lastSeenAt: now,
          sessionId: null,
        };
      }
    }

    state.updatedAt = now;
    this.writeSessionState(state);
    return state;
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
    const agentCommand = opts.agentCommand || DEFAULT_AGENT_COMMANDS[agentType] || agentType;

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

    // Detect base branch
    const baseBranch = await coreGit.getBaseBranchFromRepo(repoRoot, opts.baseBranchOverride);

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

    // Inject worker instructions
    injectWorkerInstructions(worktreePath, agentType, taskFilename);

    // Create tmux session + set metadata
    const sessionName = this.backend.buildSessionName(repoSessionNamespace, finalSlug);
    await this.backend.createSession(sessionName, worktreePath);
    await this.backend.setSessionWorkdir(sessionName, worktreePath);
    await this.backend.setSessionRole(sessionName, 'worker');
    await this.backend.setSessionAgent(sessionName, agentType);

    // For Claude, pre-assign session ID via --session-id flag (guaranteed correct).
    // For other agents, capture from filesystem after launch.
    const preAssignedSessionId = agentType === 'claude' ? randomUUID() : null;
    const snapshot = this.snapshotAgentSessions(agentType, worktreePath);

    // Launch agent without task (task sent after session ID capture)
    const launchCmd = buildAgentLaunchCommand(agentType, agentCommand, undefined, preAssignedSessionId ?? undefined);
    await this.backend.sendKeys(sessionName, launchCmd);

    const now = new Date().toISOString();
    const state = this.readSessionState();
    const workerId = state.nextWorkerId;
    state.nextWorkerId = workerId + 1;

    const workerInfo: WorkerInfo = {
      sessionName,
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
      createdAt: now,
      lastSeenAt: now,
      sessionId: preAssignedSessionId,
    };

    state.workers[sessionName] = workerInfo;
    state.updatedAt = now;
    this.writeSessionState(state);

    // Post-create: capture session ID for non-Claude agents, then send task
    const postCreatePromise = this.postCreate(sessionName, agentType, worktreePath, snapshot, task, preAssignedSessionId);

    return { workerInfo, postCreatePromise };
  }

  async deleteWorker(sessionName: string): Promise<void> {
    try {
      await this.backend.killSession(sessionName);
    } catch { /* Already dead */ }

    const state = this.readSessionState();
    const worker = state.workers[sessionName];

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

    delete state.workers[sessionName];
    state.updatedAt = new Date().toISOString();
    this.writeSessionState(state);
  }

  async stopWorker(sessionName: string): Promise<void> {
    try {
      await this.backend.killSession(sessionName);
    } catch { /* Already dead */ }

    const state = this.readSessionState();
    if (state.workers[sessionName]) {
      state.workers[sessionName].status = 'stopped';
      state.workers[sessionName].attached = false;
      state.updatedAt = new Date().toISOString();
      this.writeSessionState(state);
    }
  }

  async startWorker(sessionName: string, agentType?: string, agentCommand?: string): Promise<CreateWorkerResult> {
    const state = this.readSessionState();
    const worker = state.workers[sessionName];
    if (!worker) {
      throw new Error(`Worker "${sessionName}" not found in sessions.json`);
    }

    if (!worker.workdir || !fs.existsSync(worker.workdir)) {
      throw new Error(`Worktree "${worker.workdir}" does not exist`);
    }

    const agent = agentType || worker.agent || 'claude';
    const command = agentCommand || DEFAULT_AGENT_COMMANDS[agent] || agent;

    await this.backend.createSession(sessionName, worker.workdir);
    await this.backend.setSessionWorkdir(sessionName, worker.workdir);
    await this.backend.setSessionRole(sessionName, 'worker');
    await this.backend.setSessionAgent(sessionName, agent);

    // Resume from stored session ID if available; otherwise fresh start
    const storedSessionId = worker.sessionId;
    const resumeCmd = storedSessionId
      ? buildAgentResumeCommand(agent, command, storedSessionId)
      : null;

    let postCreatePromise: Promise<void>;

    if (resumeCmd) {
      // Resume existing session — session ID stays the same
      await this.backend.sendKeys(sessionName, resumeCmd);
      worker.status = 'running';
      worker.attached = false;
      worker.agent = agent;
      worker.lastSeenAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      this.writeSessionState(state);
      postCreatePromise = Promise.resolve();
    } else {
      // Fresh start — capture new session ID
      const preAssignedSessionId = agent === 'claude' ? randomUUID() : null;
      const snapshot = this.snapshotAgentSessions(agent, worker.workdir);
      const launchCmd = buildAgentLaunchCommand(agent, command, undefined, preAssignedSessionId ?? undefined);
      await this.backend.sendKeys(sessionName, launchCmd);

      worker.status = 'running';
      worker.attached = false;
      worker.agent = agent;
      worker.sessionId = preAssignedSessionId;
      worker.lastSeenAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      this.writeSessionState(state);

      postCreatePromise = this.postCreate(sessionName, agent, worker.workdir, snapshot, undefined, preAssignedSessionId);
    }

    return { workerInfo: worker, postCreatePromise };
  }

  // ── Copilot Lifecycle ──

  async createCopilot(opts: CreateCopilotOpts): Promise<CopilotInfo> {
    ensureHydraGlobalConfig();

    const agentType = opts.agentType || 'claude';
    const agentCommand = opts.agentCommand || DEFAULT_AGENT_COMMANDS[agentType] || agentType;
    const sessionName = opts.sessionName || this.backend.sanitizeSessionName(`hydra-copilot-${agentType}`);

    const exists = await this.backend.hasSession(sessionName);
    if (exists) {
      throw new Error(`Session "${sessionName}" already exists`);
    }

    await this.backend.createSession(sessionName, opts.workdir);
    await this.backend.setSessionWorkdir(sessionName, opts.workdir);
    await this.backend.setSessionRole(sessionName, 'copilot');
    await this.backend.setSessionAgent(sessionName, agentType);

    const preAssignedSessionId = agentType === 'claude' ? randomUUID() : null;
    const snapshot = this.snapshotAgentSessions(agentType, opts.workdir);

    // For Claude, launch with --session-id; for others, use agentCommand as-is
    const launchCmd = agentType === 'claude'
      ? buildAgentLaunchCommand(agentType, agentCommand, undefined, preAssignedSessionId ?? undefined)
      : agentCommand;
    await this.backend.sendKeys(sessionName, launchCmd);

    const now = new Date().toISOString();
    const copilotInfo: CopilotInfo = {
      sessionName,
      status: 'running',
      attached: false,
      agent: agentType,
      workdir: opts.workdir,
      tmuxSession: sessionName,
      createdAt: now,
      lastSeenAt: now,
      sessionId: preAssignedSessionId,
    };

    const state = this.readSessionState();
    state.copilots[sessionName] = copilotInfo;
    state.updatedAt = now;
    this.writeSessionState(state);

    // Capture session ID in background for non-Claude agents
    if (!preAssignedSessionId) {
      this.postCreate(sessionName, agentType, opts.workdir, snapshot, undefined, null).catch(() => {});
    }

    return copilotInfo;
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

    // 4. Update sessions.json
    const worktreeMoved = newSlug !== worker.slug && fs.existsSync(newWorktreePath);
    delete state.workers[oldSessionName];
    worker.sessionName = newSessionName;
    worker.tmuxSession = newSessionName;
    worker.branch = newBranchName;
    worker.slug = newSlug;
    if (worktreeMoved) {
      worker.workdir = newWorktreePath;
    }
    state.workers[newSessionName] = worker;
    state.updatedAt = new Date().toISOString();
    this.writeSessionState(state);

    return worker;
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

    // Update sessions.json
    delete state.copilots[oldSessionName];
    copilot.sessionName = newSessionName;
    copilot.tmuxSession = newSessionName;
    state.copilots[newSessionName] = copilot;
    state.updatedAt = new Date().toISOString();
    this.writeSessionState(state);

    return copilot;
  }

  async deleteCopilot(sessionName: string): Promise<void> {
    try {
      await this.backend.killSession(sessionName);
    } catch { /* Already dead */ }

    const state = this.readSessionState();
    delete state.copilots[sessionName];
    state.updatedAt = new Date().toISOString();
    this.writeSessionState(state);
  }

  // ── Public helpers for VS Code extension ──

  /**
   * Persist a copilot entry to sessions.json with pre-assigned session ID.
   * Called by the VS Code extension which creates sessions directly via backend.
   */
  persistCopilotSessionId(
    sessionName: string,
    agentType: string,
    workdir: string,
    sessionId: string | null,
  ): void {
    const state = this.readSessionState();
    const now = new Date().toISOString();
    state.copilots[sessionName] = {
      sessionName,
      status: 'running',
      attached: false,
      agent: agentType,
      workdir,
      tmuxSession: sessionName,
      createdAt: now,
      lastSeenAt: now,
      sessionId,
    };
    state.updatedAt = now;
    this.writeSessionState(state);
  }

  /**
   * Capture session ID via slash command and persist to sessions.json.
   * Used by VS Code extension for Codex/Gemini copilots.
   */
  async captureAndPersistSessionId(sessionName: string, agentType: string): Promise<void> {
    const sessionId = await this.captureAgentSessionId(sessionName, agentType);
    this.updateSessionId(sessionName, sessionId);
  }

  // ── Private helpers ──

  private readSessionState(): SessionState {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const state: SessionState = {
          copilots: parsed.copilots || {},
          workers: parsed.workers || {},
          nextWorkerId: parsed.nextWorkerId || 1,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
        // Backward compat: ensure sessionId field exists for legacy entries
        for (const w of Object.values(state.workers)) {
          w.sessionId ??= null;
        }
        for (const c of Object.values(state.copilots)) {
          c.sessionId ??= null;
        }
        return state;
      }
    } catch {
      // Corrupted file — start fresh
    }
    return { copilots: {}, workers: {}, nextWorkerId: 1, updatedAt: new Date().toISOString() };
  }

  private writeSessionState(state: SessionState): void {
    if (!fs.existsSync(HYDRA_DIR)) {
      fs.mkdirSync(HYDRA_DIR, { recursive: true });
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(state, null, 2), 'utf-8');
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
   * Post-create flow: wait for agent readiness, capture session ID if needed,
   * then send task.
   *
   * For Claude, sessionId is pre-assigned via --session-id flag (no capture needed).
   * For Codex/Gemini, sends slash command and parses session ID from pane output.
   */
  private async postCreate(
    sessionName: string,
    agentType: string,
    _workdir: string,
    _snapshot: SessionSnapshot,
    task?: string,
    preAssignedSessionId?: string | null,
  ): Promise<void> {
    if (preAssignedSessionId) {
      // Session ID already known (Claude) — just wait for readiness then send task
      await this.sleep(CLAUDE_READY_DELAY_MS);
    } else {
      // Capture session ID via slash command (/status or /stats)
      const sessionId = await this.captureAgentSessionId(sessionName, agentType);
      this.updateSessionId(sessionName, sessionId);
    }
    if (task) {
      await this.backend.sendMessage(sessionName, task);
    }
  }

  /**
   * Snapshot before launch (placeholder for future use / compatibility).
   */
  private snapshotAgentSessions(_agentType: string, _workdir: string): SessionSnapshot {
    return {};
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

  private updateSessionId(sessionName: string, sessionId: string | null): void {
    const state = this.readSessionState();
    if (state.workers[sessionName]) {
      state.workers[sessionName].sessionId = sessionId;
      state.updatedAt = new Date().toISOString();
      this.writeSessionState(state);
    } else if (state.copilots[sessionName]) {
      state.copilots[sessionName].sessionId = sessionId;
      state.updatedAt = new Date().toISOString();
      this.writeSessionState(state);
    }
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

      const state = this.readSessionState();
      const existingWorker = state.workers[sessionName];
      const workerId = existingWorker?.workerId ?? state.nextWorkerId++;

      const workerInfo: WorkerInfo = {
        sessionName,
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
        createdAt: now,
        lastSeenAt: now,
        sessionId: existingWorker?.sessionId ?? null,
      };

      state.workers[sessionName] = workerInfo;
      state.updatedAt = now;
      this.writeSessionState(state);
      return { workerInfo, postCreatePromise: Promise.resolve() };
    }

    // Worktree exists but tmux is dead
    const worktreesDir = coreGit.getManagedRepoWorktreesDir(repoRoot);
    const worktreePath = path.join(worktreesDir, slug);
    if (fs.existsSync(worktreePath)) {
      await this.backend.createSession(sessionName, worktreePath);
      await this.backend.setSessionWorkdir(sessionName, worktreePath);
      await this.backend.setSessionRole(sessionName, 'worker');
      await this.backend.setSessionAgent(sessionName, agentType);

      const now = new Date().toISOString();
      const state = this.readSessionState();
      const existingWorker = state.workers[sessionName];
      const existingId = existingWorker?.workerId;
      const workerId = existingId ?? state.nextWorkerId++;
      const storedSessionId = existingWorker?.sessionId;

      // Resume from stored session ID if available; otherwise fresh start
      const resumeCmd = storedSessionId
        ? buildAgentResumeCommand(agentType, agentCommand, storedSessionId)
        : null;

      let postCreatePromise: Promise<void>;
      let sessionId: string | null;

      if (resumeCmd) {
        // Resume existing session — session ID stays the same
        await this.backend.sendKeys(sessionName, resumeCmd);
        sessionId = storedSessionId;
        // Send task after agent resumes (needs readiness delay)
        postCreatePromise = (async () => {
          await this.sleep(CLAUDE_READY_DELAY_MS);
          if (task) await this.backend.sendMessage(sessionName, task);
        })();
      } else {
        // Fresh start — capture new session ID
        const preAssignedSessionId = agentType === 'claude' ? randomUUID() : null;
        const snapshot = this.snapshotAgentSessions(agentType, worktreePath);
        const launchCmd = buildAgentLaunchCommand(agentType, agentCommand, undefined, preAssignedSessionId ?? undefined);
        await this.backend.sendKeys(sessionName, launchCmd);
        sessionId = preAssignedSessionId;
        postCreatePromise = this.postCreate(sessionName, agentType, worktreePath, snapshot, task, preAssignedSessionId);
      }

      const workerInfo: WorkerInfo = {
        sessionName,
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
        createdAt: now,
        lastSeenAt: now,
        sessionId,
      };

      state.workers[sessionName] = workerInfo;
      state.updatedAt = now;
      this.writeSessionState(state);

      return { workerInfo, postCreatePromise };
    }

    throw new Error(`Branch "${branchName}" exists but has no managed worktree. Delete the branch first or use a different name.`);
  }
}
