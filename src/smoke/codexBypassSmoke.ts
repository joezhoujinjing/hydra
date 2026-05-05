import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  HydraRole,
  MultiplexerBackendCore,
  MultiplexerSession,
  SessionStatusInfo,
} from '../core/types';

const BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';

type SessionRecord = {
  agent?: string;
  role?: HydraRole;
  workdir?: string;
};

class FakeBackend implements MultiplexerBackendCore {
  readonly type = 'tmux' as const;
  readonly displayName = 'fake-tmux';
  readonly installHint = 'not needed';

  readonly sendKeysCalls: Array<{ sessionName: string; keys: string }> = [];
  readonly sendMessageCalls: Array<{ sessionName: string; message: string }> = [];
  readonly capturePaneCalls: Array<{ sessionName: string; lines?: number }> = [];
  readonly paneOutputs = new Map<string, string>();

  private readonly sessions = new Map<string, SessionRecord>();

  async isInstalled(): Promise<boolean> {
    return true;
  }

  async listSessions(): Promise<MultiplexerSession[]> {
    return [...this.sessions.entries()].map(([name, session]) => ({
      name,
      windows: 1,
      attached: false,
      workdir: session.workdir,
    }));
  }

  async createSession(sessionName: string, cwd: string): Promise<void> {
    this.sessions.set(sessionName, { workdir: cwd });
  }

  async killSession(sessionName: string): Promise<void> {
    this.sessions.delete(sessionName);
  }

  async renameSession(oldName: string, newName: string): Promise<void> {
    const session = this.sessions.get(oldName);
    if (session) {
      this.sessions.set(newName, session);
      this.sessions.delete(oldName);
    }
  }

  async hasSession(sessionName: string): Promise<boolean> {
    return this.sessions.has(sessionName);
  }

  async getSessionWorkdir(sessionName: string): Promise<string | undefined> {
    return this.sessions.get(sessionName)?.workdir;
  }

  async setSessionWorkdir(sessionName: string, workdir: string): Promise<void> {
    const session = this.sessions.get(sessionName) || {};
    session.workdir = workdir;
    this.sessions.set(sessionName, session);
  }

  async getSessionRole(sessionName: string): Promise<HydraRole | undefined> {
    return this.sessions.get(sessionName)?.role;
  }

  async setSessionRole(sessionName: string, role: HydraRole): Promise<void> {
    const session = this.sessions.get(sessionName) || {};
    session.role = role;
    this.sessions.set(sessionName, session);
  }

  async getSessionAgent(sessionName: string): Promise<string | undefined> {
    return this.sessions.get(sessionName)?.agent;
  }

  async setSessionAgent(sessionName: string, agent: string): Promise<void> {
    const session = this.sessions.get(sessionName) || {};
    session.agent = agent;
    this.sessions.set(sessionName, session);
  }

  async sendKeys(sessionName: string, keys: string): Promise<void> {
    this.sendKeysCalls.push({ sessionName, keys });
  }

  async capturePane(sessionName: string, lines?: number): Promise<string> {
    this.capturePaneCalls.push({ sessionName, lines });
    return this.paneOutputs.get(sessionName) || '⏵';
  }

  async sendMessage(sessionName: string, message: string): Promise<void> {
    this.sendMessageCalls.push({ sessionName, message });
  }

  async getSessionInfo(): Promise<SessionStatusInfo> {
    return { attached: false, lastActive: 0 };
  }

  async getSessionPaneCount(): Promise<number> {
    return 1;
  }

  async getSessionPanePids(): Promise<string[]> {
    return [];
  }

  async splitPane(): Promise<void> {}

  async newWindow(): Promise<void> {}

  buildSessionName(repoName: string, slug: string): string {
    return `${this.sanitizeSessionName(repoName)}_${this.sanitizeSessionName(slug)}`;
  }

  sanitizeSessionName(name: string): string {
    return name.replace(/[/\\\s.:]/g, '-');
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function patchModule(
  target: Record<string, unknown>,
  overrides: Record<string, unknown>,
): () => void {
  const originals = new Map<string, unknown>();
  for (const [key, value] of Object.entries(overrides)) {
    originals.set(key, target[key]);
    target[key] = value;
  }

  return () => {
    for (const [key, value] of originals.entries()) {
      target[key] = value;
    }
  };
}

function lastSendKeysFor(backend: FakeBackend, sessionName: string): string {
  const call = [...backend.sendKeysCalls].reverse().find(entry => entry.sessionName === sessionName);
  assert.ok(call, `Expected a sendKeys call for ${sessionName}`);
  return call.keys;
}

function forceFastSleeps(sessionManager: object): void {
  (sessionManager as { sleep: (ms: number) => Promise<void> }).sleep = async () => {};
}

async function main(): Promise<void> {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-codex-bypass-'));
  process.env.HOME = tempHome;

  const hydraDir = path.join(tempHome, '.hydra');
  const sessionsFile = path.join(hydraDir, 'sessions.json');
  const archiveFile = path.join(hydraDir, 'archive.json');

  const agentConfig = await import('../core/agentConfig');
  const coreGit = await import('../core/git') as unknown as Record<string, unknown>;
  const { SessionManager } = await import('../core/sessionManager');

  const launchCommand = agentConfig.buildAgentLaunchCommand('codex', 'codex');
  assert.equal(launchCommand, `codex ${BYPASS_FLAG}`);

  const dedupedLaunchCommand = agentConfig.buildAgentLaunchCommand(
    'codex',
    `codex ${BYPASS_FLAG}`,
  );
  assert.equal(countOccurrences(dedupedLaunchCommand, BYPASS_FLAG), 1);

  const resumeCommand = agentConfig.buildAgentResumeCommand('codex', 'codex', 'resume-session-id');
  assert.equal(
    resumeCommand,
    `codex ${BYPASS_FLAG} resume 'resume-session-id'`,
  );

  const dedupedResumeCommand = agentConfig.buildAgentResumeCommand(
    'codex',
    `codex ${BYPASS_FLAG}`,
    'resume-session-id',
  );
  assert.ok(dedupedResumeCommand);
  assert.equal(countOccurrences(dedupedResumeCommand, BYPASS_FLAG), 1);

  {
    const backend = new FakeBackend();
    backend.paneOutputs.set(
      'copilot-fresh',
      'Session: 11111111-1111-4111-8111-111111111111\n⏵',
    );
    const sm = new SessionManager(backend);
    forceFastSleeps(sm);

    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-copilot-fresh-'));
    const copilot = await sm.createCopilotAndFinalize({
      workdir,
      agentType: 'codex',
      sessionName: 'copilot-fresh',
    });

    assert.equal(
      backend.sendKeysCalls[0]?.keys,
      `codex ${BYPASS_FLAG}`,
    );
    assert.ok(
      backend.sendMessageCalls.some(call => call.sessionName === 'copilot-fresh' && call.message === '/status'),
    );
    assert.equal(copilot.sessionId, '11111111-1111-4111-8111-111111111111');
  }

  {
    const archive = readJson<{ entries: Array<Record<string, unknown>> }>(archiveFile, { entries: [] });
    archive.entries.push({
      type: 'copilot',
      sessionName: 'copilot-restored',
      agentSessionId: '22222222-2222-4222-8222-222222222222',
      archivedAt: new Date().toISOString(),
      data: {
        sessionName: 'copilot-restored',
        displayName: 'copilot-restored',
        status: 'stopped',
        attached: false,
        agent: 'codex',
        workdir: fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-copilot-restored-')),
        tmuxSession: 'copilot-restored',
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        sessionId: '22222222-2222-4222-8222-222222222222',
      },
    });
    writeJson(archiveFile, archive);

    const backend = new FakeBackend();
    backend.paneOutputs.set('copilot-restored', '⏵');
    const sm = new SessionManager(backend);
    forceFastSleeps(sm);

    const copilot = await sm.restoreCopilotAndFinalize('copilot-restored');
    const command = lastSendKeysFor(backend, 'copilot-restored');

    assert.equal(
      command,
      `codex ${BYPASS_FLAG} resume '22222222-2222-4222-8222-222222222222'`,
    );
    assert.ok(
      backend.capturePaneCalls.some(call => call.sessionName === 'copilot-restored'),
    );
    assert.equal(copilot.sessionId, '22222222-2222-4222-8222-222222222222');
  }

  {
    const workerWorkdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-worker-start-'));
    const state = readJson<Record<string, unknown>>(sessionsFile, {
      copilots: {},
      workers: {},
      nextWorkerId: 2,
      updatedAt: new Date().toISOString(),
    });
    const workers = (state.workers as Record<string, unknown>) || {};
    workers['worker-start'] = {
      sessionName: 'worker-start',
      displayName: 'worker-start',
      workerId: 1,
      repo: 'repo',
      repoRoot: workerWorkdir,
      branch: 'fix/codex-start',
      slug: 'fix-codex-start',
      status: 'stopped',
      attached: false,
      agent: 'codex',
      workdir: workerWorkdir,
      tmuxSession: 'worker-start',
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      sessionId: '33333333-3333-4333-8333-333333333333',
      copilotSessionName: null,
    };
    state.workers = workers;
    writeJson(sessionsFile, state);

    const backend = new FakeBackend();
    backend.paneOutputs.set('worker-start', '⏵');
    const sm = new SessionManager(backend);
    forceFastSleeps(sm);

    const result = await sm.startWorker('worker-start');
    await result.postCreatePromise;

    const command = lastSendKeysFor(backend, 'worker-start');
    assert.equal(
      command,
      `codex ${BYPASS_FLAG} resume '33333333-3333-4333-8333-333333333333'`,
    );
    assert.ok(
      backend.capturePaneCalls.some(call => call.sessionName === 'worker-start'),
      'startWorker should wait for the resumed agent to become ready',
    );
  }

  {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-worker-restore-repo-'));
    const restoredWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-worker-restore-worktree-'));
    const archive = readJson<{ entries: Array<Record<string, unknown>> }>(archiveFile, { entries: [] });
    archive.entries.push({
      type: 'worker',
      sessionName: 'worker-restored',
      agentSessionId: '44444444-4444-4444-8444-444444444444',
      archivedAt: new Date().toISOString(),
      data: {
        sessionName: 'worker-restored',
        displayName: 'worker-restored',
        workerId: 2,
        repo: 'repo',
        repoRoot,
        branch: 'fix/codex-restored',
        slug: 'fix-codex-restored',
        status: 'stopped',
        attached: false,
        agent: 'codex',
        workdir: restoredWorktree,
        tmuxSession: 'worker-restored',
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        sessionId: '44444444-4444-4444-8444-444444444444',
        copilotSessionName: null,
      },
    });
    writeJson(archiveFile, archive);

    const restoreCoreGit = patchModule(coreGit, {
      validateBranchName: () => undefined,
      getRepoSessionNamespace: () => 'repo-ns',
      localBranchExists: async () => false,
      fetchOrigin: async () => {},
      getBaseBranchFromRepo: async () => 'main',
      getLocalAheadCount: async () => 0,
      branchNameToSlug: () => 'fix-codex-restored',
      isSlugTaken: async () => false,
      addWorktree: async () => restoredWorktree,
      getRepoName: () => 'repo',
    });

    try {
      const backend = new FakeBackend();
      backend.paneOutputs.set('repo-ns_fix-codex-restored', '⏵');
      const sm = new SessionManager(backend);
      forceFastSleeps(sm);

      const result = await sm.restoreWorker('worker-restored');
      await result.postCreatePromise;

      const command = lastSendKeysFor(backend, 'repo-ns_fix-codex-restored');
      assert.equal(
        command,
        `codex ${BYPASS_FLAG} resume '44444444-4444-4444-8444-444444444444'`,
      );
      assert.equal(result.workerInfo.sessionId, '44444444-4444-4444-8444-444444444444');
      assert.ok(
        backend.capturePaneCalls.some(call => call.sessionName === 'repo-ns_fix-codex-restored'),
      );
    } finally {
      restoreCoreGit();
    }
  }

  console.log('codexBypassSmoke: ok');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
