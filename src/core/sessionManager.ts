import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MultiplexerBackendCore } from './types';
import * as coreGit from './git';
import { injectWorkerInstructions, ensureHydraGlobalConfig } from './hydraGlobalConfig';
import { buildAgentLaunchCommand, DEFAULT_AGENT_COMMANDS } from './agentConfig';
import { exec } from './exec';
import { shellQuote } from './shell';

const HYDRA_DIR = path.join(os.homedir(), '.hydra');
const SESSIONS_FILE = path.join(HYDRA_DIR, 'sessions.json');

// ── Types ──

export interface WorkerInfo {
  sessionName: string;
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
}

export interface SessionState {
  copilots: Record<string, CopilotInfo>;
  workers: Record<string, WorkerInfo>;
  updatedAt: string;
}

export interface CreateWorkerOpts {
  repoRoot: string;
  branchName: string;
  agentType?: string;
  baseBranchOverride?: string;
  task?: string;
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

    const { repoRoot, branchName, task } = opts;
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

    // Resolve @imports in instruction files
    this.resolveImports(path.join(worktreePath, 'CLAUDE.md'), repoRoot);
    this.resolveImports(path.join(worktreePath, 'AGENTS.md'), repoRoot);
    this.resolveImports(path.join(worktreePath, 'GEMINI.md'), repoRoot);

    // Inject worker instructions
    injectWorkerInstructions(worktreePath, agentType);

    // Create tmux session + set metadata
    const sessionName = this.backend.buildSessionName(repoSessionNamespace, finalSlug);
    await this.backend.createSession(sessionName, worktreePath);
    await this.backend.setSessionWorkdir(sessionName, worktreePath);
    await this.backend.setSessionRole(sessionName, 'worker');
    await this.backend.setSessionAgent(sessionName, agentType);

    // Build & send agent launch command
    const launchCmd = buildAgentLaunchCommand(agentType, agentCommand, task, repoRoot);
    await this.backend.sendKeys(sessionName, launchCmd);

    const now = new Date().toISOString();
    const workerInfo: WorkerInfo = {
      sessionName,
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
    };

    const state = this.readSessionState();
    state.workers[sessionName] = workerInfo;
    state.updatedAt = now;
    this.writeSessionState(state);

    // Delayed Enter for Claude trust prompt — returns a promise the CLI can await
    const postCreatePromise = this.delayedEnterForClaude(agentType, sessionName);

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

    const launchCmd = buildAgentLaunchCommand(agent, command, undefined, worker.repoRoot);
    await this.backend.sendKeys(sessionName, launchCmd);

    worker.status = 'running';
    worker.attached = false;
    worker.agent = agent;
    worker.lastSeenAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    this.writeSessionState(state);

    const postCreatePromise = this.delayedEnterForClaude(agent, sessionName);

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

    await this.backend.sendKeys(sessionName, agentCommand);

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
    };

    const state = this.readSessionState();
    state.copilots[sessionName] = copilotInfo;
    state.updatedAt = now;
    this.writeSessionState(state);

    return copilotInfo;
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

  // ── Private helpers ──

  private readSessionState(): SessionState {
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          copilots: parsed.copilots || {},
          workers: parsed.workers || {},
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
      }
    } catch {
      // Corrupted file — start fresh
    }
    return { copilots: {}, workers: {}, updatedAt: new Date().toISOString() };
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

  private delayedEnterForClaude(agentType: string, sessionName: string): Promise<void> {
    if (agentType !== 'claude') return Promise.resolve();
    return new Promise(resolve => {
      setTimeout(async () => {
        try { await this.backend.sendKeys(sessionName, ''); } catch { /* */ }
        resolve();
      }, 8000);
    });
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

      const workerInfo: WorkerInfo = {
        sessionName,
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
      };

      const state = this.readSessionState();
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

      const launchCmd = buildAgentLaunchCommand(agentType, agentCommand, task, repoRoot);
      await this.backend.sendKeys(sessionName, launchCmd);

      const now = new Date().toISOString();
      const workerInfo: WorkerInfo = {
        sessionName,
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
      };

      const state = this.readSessionState();
      state.workers[sessionName] = workerInfo;
      state.updatedAt = now;
      this.writeSessionState(state);

      const postCreatePromise = this.delayedEnterForClaude(agentType, sessionName);
      return { workerInfo, postCreatePromise };
    }

    throw new Error(`Branch "${branchName}" exists but has no managed worktree. Delete the branch first or use a different name.`);
  }
}
