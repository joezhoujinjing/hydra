import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec as execCore } from '../core/exec';
import { TmuxBackendCore } from '../core/tmux';
import { SessionManager } from '../core/sessionManager';
import { getHydraDir, getSessionsFile, getArchiveFile } from '../core/paths';

// ── Types ──

export interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface TestReport {
  results: TestResult[];
  passed: number;
  failed: number;
  total: number;
  durationMs: number;
}

type TestFn = () => Promise<void>;

// ── Test Infrastructure ──

const TEST_PREFIX = 'test-e2e-';
let testRepoRoot: string;
let hydraHome: string;

function generateTestName(suffix: string): string {
  const id = Math.random().toString(36).substring(2, 8);
  return `${TEST_PREFIX}${suffix}-${id}`;
}

async function exec(cmd: string, opts?: { cwd?: string }): Promise<string> {
  return execCore(cmd, opts);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}


// ── Setup / Teardown ──

async function setupTestEnvironment(): Promise<void> {
  // Create isolated HYDRA_HOME
  hydraHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-e2e-'));
  process.env.HYDRA_HOME = hydraHome;
  fs.mkdirSync(hydraHome, { recursive: true });

  // Create a test git repo for workers
  testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-e2e-repo-'));
  await exec('git init', { cwd: testRepoRoot });
  await exec('git config user.email "test@hydra.dev"', { cwd: testRepoRoot });
  await exec('git config user.name "Hydra E2E"', { cwd: testRepoRoot });
  fs.writeFileSync(path.join(testRepoRoot, 'README.md'), '# E2E Test Repo\n');
  await exec('git add -A && git commit -m "init"', { cwd: testRepoRoot });
}

async function teardownTestEnvironment(): Promise<void> {
  // Kill any leftover test tmux sessions
  try {
    const output = await exec("tmux list-sessions -F '#{session_name}' 2>/dev/null || true");
    const sessions = output.split('\n').filter(s => s.includes(TEST_PREFIX));
    for (const session of sessions) {
      try {
        await exec(`tmux kill-session -t '${session}'`);
      } catch { /* ignore */ }
    }
  } catch { /* no tmux server */ }

  // Remove test worktrees
  if (testRepoRoot) {
    try {
      await exec(`git worktree list --porcelain`, { cwd: testRepoRoot });
      const wtOutput = await exec(`git worktree list --porcelain`, { cwd: testRepoRoot });
      const worktrees = wtOutput.split('\n\n')
        .filter(block => block.includes(TEST_PREFIX))
        .map(block => {
          const match = block.match(/^worktree (.+)$/m);
          return match ? match[1] : null;
        })
        .filter(Boolean) as string[];
      for (const wt of worktrees) {
        try {
          await exec(`git worktree remove --force '${wt}'`, { cwd: testRepoRoot });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    // Clean up test branches
    try {
      const branches = await exec(`git branch --list '${TEST_PREFIX}*'`, { cwd: testRepoRoot });
      for (const branch of branches.split('\n').map(b => b.trim()).filter(Boolean)) {
        try {
          await exec(`git branch -D '${branch}'`, { cwd: testRepoRoot });
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // Remove temp directories
  if (hydraHome && fs.existsSync(hydraHome)) {
    fs.rmSync(hydraHome, { recursive: true, force: true });
  }
  if (testRepoRoot && fs.existsSync(testRepoRoot)) {
    fs.rmSync(testRepoRoot, { recursive: true, force: true });
  }

  delete process.env.HYDRA_HOME;
}

// ── Helpers ──

function readSessions(): Record<string, unknown> {
  const file = getSessionsFile();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function readArchive(): { entries: Array<Record<string, unknown>> } {
  const file = getArchiveFile();
  if (!fs.existsSync(file)) return { entries: [] };
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function getBackendAndManager(): { backend: TmuxBackendCore; sm: SessionManager } {
  const backend = new TmuxBackendCore();
  const sm = new SessionManager(backend);
  return { backend, sm };
}

async function createTestWorker(sm: SessionManager, branchSuffix?: string): Promise<{ sessionName: string; branch: string }> {
  const branch = generateTestName(branchSuffix || 'worker');
  const { workerInfo } = await sm.createWorker({
    repoRoot: testRepoRoot,
    branchName: branch,
    agentType: 'claude',
  });
  // Don't await postCreatePromise — it waits for agent TUI which won't appear in tests
  // Give tmux a moment to start
  await new Promise(r => setTimeout(r, 500));
  return { sessionName: workerInfo.sessionName, branch };
}

async function createTestCopilot(sm: SessionManager, nameSuffix?: string): Promise<{ sessionName: string }> {
  const name = generateTestName(nameSuffix || 'copilot');
  const copilotInfo = await sm.createCopilot({
    workdir: testRepoRoot,
    agentType: 'claude',
    name,
    sessionName: name,
  });
  await new Promise(r => setTimeout(r, 500));
  return { sessionName: copilotInfo.sessionName };
}

// ── Test Cases ──

// Worker Lifecycle

const test_worker_create: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const branch = generateTestName('create');

  const { workerInfo } = await sm.createWorker({
    repoRoot: testRepoRoot,
    branchName: branch,
    agentType: 'claude',
  });
  await new Promise(r => setTimeout(r, 500));

  try {
    // Verify sessions.json entry
    const sessions = readSessions() as { workers?: Record<string, { branch: string; agent: string; workdir: string; sessionId: string | null }> };
    assert(!!sessions.workers?.[workerInfo.sessionName], 'Worker should exist in sessions.json');
    assertEqual(sessions.workers![workerInfo.sessionName].branch, branch, 'Branch name');
    assertEqual(sessions.workers![workerInfo.sessionName].agent, 'claude', 'Agent type');

    // Verify tmux session exists
    const hasSession = await backend.hasSession(workerInfo.sessionName);
    assert(hasSession, 'Tmux session should exist');

    // Verify worktree exists
    assert(fs.existsSync(workerInfo.workdir), 'Worktree directory should exist');

    // Verify it's a git worktree
    const gitDir = await exec('git rev-parse --git-dir', { cwd: workerInfo.workdir });
    assert(gitDir.trim().length > 0, 'Should be a git worktree');

    // Verify sessionId was pre-assigned (Claude agent)
    assert(sessions.workers![workerInfo.sessionName].sessionId !== null, 'Claude agent should have pre-assigned sessionId');
  } finally {
    await sm.deleteWorker(workerInfo.sessionName);
  }
};

const test_worker_delete: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const { sessionName, branch } = await createTestWorker(sm, 'delete');

  // Verify exists before delete
  let hasSession = await backend.hasSession(sessionName);
  assert(hasSession, 'Session should exist before delete');

  // Delete
  await sm.deleteWorker(sessionName);

  // Verify archived in archive.json
  const archive = readArchive();
  const archived = archive.entries.find(e => e.sessionName === sessionName);
  assert(!!archived, 'Should be archived in archive.json');
  assertEqual(archived!.type, 'worker', 'Archive type');

  // Verify tmux killed
  hasSession = await backend.hasSession(sessionName);
  assert(!hasSession, 'Tmux session should be killed after delete');

  // Verify sessions.json cleaned
  const sessions = readSessions() as { workers?: Record<string, unknown> };
  assert(!sessions.workers?.[sessionName], 'Worker should be removed from sessions.json');

  // Verify branch deleted
  try {
    await exec(`git rev-parse --verify '${branch}'`, { cwd: testRepoRoot });
    throw new Error('Branch should have been deleted');
  } catch (e) {
    if (e instanceof Error && e.message === 'Branch should have been deleted') throw e;
    // Expected: branch not found
  }
};

const test_worker_stop_start: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const { sessionName } = await createTestWorker(sm, 'stopstart');

  try {
    // Get sessionId before stop
    const sessionsBefore = readSessions() as { workers?: Record<string, { sessionId: string | null; status: string }> };
    const sessionIdBefore = sessionsBefore.workers?.[sessionName]?.sessionId;

    // Stop
    await sm.stopWorker(sessionName);

    // Verify stopped status
    const sessionsAfterStop = readSessions() as { workers?: Record<string, { status: string; sessionId: string | null }> };
    assertEqual(sessionsAfterStop.workers?.[sessionName]?.status, 'stopped', 'Status after stop');

    // Verify sessionId preserved
    assertEqual(sessionsAfterStop.workers?.[sessionName]?.sessionId, sessionIdBefore, 'SessionId preserved after stop');

    // Verify tmux session gone
    const hasSession = await backend.hasSession(sessionName);
    assert(!hasSession, 'Tmux session should be killed on stop');

    // Start
    await sm.startWorker(sessionName);
    await new Promise(r => setTimeout(r, 500));

    // Verify running
    const sessionsAfterStart = readSessions() as { workers?: Record<string, { status: string }> };
    assertEqual(sessionsAfterStart.workers?.[sessionName]?.status, 'running', 'Status after start');

    // Verify tmux session recreated
    const hasSessionAfterStart = await backend.hasSession(sessionName);
    assert(hasSessionAfterStart, 'Tmux session should be recreated on start');
  } finally {
    await sm.deleteWorker(sessionName);
  }
};

const test_worker_rename: TestFn = async () => {
  const { sm } = getBackendAndManager();
  const { sessionName } = await createTestWorker(sm, 'rename');

  const newBranch = generateTestName('renamed');

  try {
    const worker = await sm.renameWorker(sessionName, newBranch);

    // Verify branch renamed
    const branchExists = await exec(`git branch --list '${newBranch}'`, { cwd: testRepoRoot });
    assert(branchExists.trim().length > 0, 'New branch should exist');

    // Verify sessions.json updated with new session name
    const sessions = readSessions() as { workers?: Record<string, { branch: string }> };
    assert(!!sessions.workers?.[worker.sessionName], 'New session name should exist in sessions.json');
    assertEqual(sessions.workers![worker.sessionName].branch, newBranch, 'Branch in sessions.json');

    // Verify old session name removed
    if (worker.sessionName !== sessionName) {
      assert(!sessions.workers?.[sessionName], 'Old session name should be removed');
    }

    // Verify worktree moved (new workdir exists)
    assert(fs.existsSync(worker.workdir), 'New worktree path should exist');

    // Clean up with new session name
    await sm.deleteWorker(worker.sessionName);
  } catch (e) {
    // Clean up on failure
    try { await sm.deleteWorker(sessionName); } catch { /* ignore */ }
    throw e;
  }
};

// Copilot Lifecycle

const test_copilot_create: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const name = generateTestName('cop-create');

  const copilotInfo = await sm.createCopilot({
    workdir: testRepoRoot,
    agentType: 'claude',
    name,
    sessionName: name,
  });
  await new Promise(r => setTimeout(r, 500));

  try {
    // Verify sessions.json entry
    const sessions = readSessions() as { copilots?: Record<string, { agent: string; workdir: string; sessionId: string | null }> };
    assert(!!sessions.copilots?.[copilotInfo.sessionName], 'Copilot should exist in sessions.json');
    assertEqual(sessions.copilots![copilotInfo.sessionName].agent, 'claude', 'Agent type');

    // Verify tmux session
    const hasSession = await backend.hasSession(copilotInfo.sessionName);
    assert(hasSession, 'Tmux session should exist');

    // Verify sessionId (Claude gets pre-assigned)
    assert(sessions.copilots![copilotInfo.sessionName].sessionId !== null, 'Claude copilot should have sessionId');
  } finally {
    await sm.deleteCopilot(copilotInfo.sessionName);
  }
};

const test_copilot_delete: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const { sessionName } = await createTestCopilot(sm, 'cop-del');

  // Verify exists
  let hasSession = await backend.hasSession(sessionName);
  assert(hasSession, 'Session should exist before delete');

  // Delete
  await sm.deleteCopilot(sessionName);

  // Verify archived
  const archive = readArchive();
  const archived = archive.entries.find(e => e.sessionName === sessionName);
  assert(!!archived, 'Copilot should be archived');
  assertEqual(archived!.type, 'copilot', 'Archive type');

  // Verify tmux killed
  hasSession = await backend.hasSession(sessionName);
  assert(!hasSession, 'Tmux session should be killed');

  // Verify sessions.json cleaned
  const sessions = readSessions() as { copilots?: Record<string, unknown> };
  assert(!sessions.copilots?.[sessionName], 'Copilot should be removed from sessions.json');
};

const test_copilot_stop_resume: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const { sessionName } = await createTestCopilot(sm, 'cop-resume');

  try {
    // Get sessionId
    const sessionsBefore = readSessions() as { copilots?: Record<string, { sessionId: string | null }> };
    const sessionId = sessionsBefore.copilots?.[sessionName]?.sessionId;

    // Stop (kill tmux, which removes copilot from state on next sync)
    await backend.killSession(sessionName);

    // Verify tmux dead
    const hasSession = await backend.hasSession(sessionName);
    assert(!hasSession, 'Tmux should be killed');

    // Restore from archive (first need to archive it)
    // Delete the copilot to archive it
    await sm.deleteCopilot(sessionName);

    // Verify archived with sessionId
    const archive = readArchive();
    const archived = archive.entries.find(e => e.sessionName === sessionName);
    assert(!!archived, 'Should be archived');
    assertEqual(archived!.agentSessionId, sessionId, 'Archived sessionId should match');

    // Restore
    const restored = await sm.restoreCopilot(sessionName);
    await new Promise(r => setTimeout(r, 500));

    // Verify restored
    const sessionsAfter = readSessions() as { copilots?: Record<string, { sessionId: string | null }> };
    assert(!!sessionsAfter.copilots?.[restored.sessionName], 'Restored copilot should be in sessions.json');

    // Clean up
    await sm.deleteCopilot(restored.sessionName);
  } catch (e) {
    try { await sm.deleteCopilot(sessionName); } catch { /* ignore */ }
    throw e;
  }
};

// Archive

const test_archive_list: TestFn = async () => {
  const { sm } = getBackendAndManager();

  // Create and delete workers to populate archive
  const { sessionName: s1 } = await createTestWorker(sm, 'arc-list1');
  const { sessionName: s2 } = await createTestWorker(sm, 'arc-list2');

  await sm.deleteWorker(s1);
  await sm.deleteWorker(s2);

  // Verify archive entries
  const archive = readArchive();
  const e1 = archive.entries.find(e => e.sessionName === s1);
  const e2 = archive.entries.find(e => e.sessionName === s2);
  assert(!!e1, 'First worker should be archived');
  assert(!!e2, 'Second worker should be archived');

  // Verify via SessionManager API
  const entries = sm.listArchived();
  const found1 = entries.find(e => e.sessionName === s1);
  const found2 = entries.find(e => e.sessionName === s2);
  assert(!!found1, 'listArchived should include first worker');
  assert(!!found2, 'listArchived should include second worker');
};

const test_archive_restore: TestFn = async () => {
  const { sm } = getBackendAndManager();
  const { sessionName, branch } = await createTestWorker(sm, 'arc-restore');

  // Get sessionId before delete
  const sessionsBefore = readSessions() as { workers?: Record<string, { sessionId: string | null }> };
  const sessionId = sessionsBefore.workers?.[sessionName]?.sessionId;

  // Delete (archives it)
  await sm.deleteWorker(sessionName);

  // Restore
  const { workerInfo } = await sm.restoreWorker(sessionName);
  await new Promise(r => setTimeout(r, 500));

  try {
    // Verify agent resumes with stored sessionId
    const sessionsAfter = readSessions() as { workers?: Record<string, { sessionId: string | null; branch: string }> };
    const restored = sessionsAfter.workers?.[workerInfo.sessionName];
    assert(!!restored, 'Restored worker should be in sessions.json');
    assertEqual(restored!.branch, branch, 'Branch should be preserved');
    // sessionId should be preserved from the archive entry
    assertEqual(restored!.sessionId, sessionId, 'SessionId should be preserved from archive');
  } finally {
    await sm.deleteWorker(workerInfo.sessionName);
  }
};

const test_archive_dedup: TestFn = async () => {
  const { sm } = getBackendAndManager();
  const { sessionName } = await createTestWorker(sm, 'arc-dedup');

  // Delete (1st archive entry)
  await sm.deleteWorker(sessionName);

  // Restore
  const { workerInfo } = await sm.restoreWorker(sessionName);
  await new Promise(r => setTimeout(r, 500));

  // Delete again (2nd archive entry)
  await sm.deleteWorker(workerInfo.sessionName);

  // Verify archive has 2 entries for this session
  const all = sm.getArchivedAll(sessionName);
  assert(all.length >= 2, `Expected >= 2 archive entries, got ${all.length}`);

  // Verify listArchivedLatest shows only the latest
  const latest = sm.listArchivedLatest();
  const matching = latest.filter(e => e.sessionName === sessionName);
  assertEqual(matching.length, 1, 'listArchivedLatest should show one entry per session');
};

// Session Model Invariants

const test_1to1_tmux_agent: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const { sessionName: s1 } = await createTestWorker(sm, 'inv-tmux1');
  const { sessionName: s2 } = await createTestWorker(sm, 'inv-tmux2');

  try {
    // Sync to get current state
    const state = await sm.sync();

    // Every running worker/copilot in sessions.json should have a live tmux session
    for (const worker of Object.values(state.workers)) {
      if (worker.status === 'running') {
        const has = await backend.hasSession(worker.sessionName);
        assert(has, `Worker ${worker.sessionName} is running but has no tmux session`);
      }
    }
    for (const copilot of Object.values(state.copilots)) {
      if (copilot.status === 'running') {
        const has = await backend.hasSession(copilot.sessionName);
        assert(has, `Copilot ${copilot.sessionName} is running but has no tmux session`);
      }
    }
  } finally {
    await sm.deleteWorker(s1);
    await sm.deleteWorker(s2);
  }
};

const test_1to1_worker_worktree: TestFn = async () => {
  const { sm } = getBackendAndManager();
  const { sessionName } = await createTestWorker(sm, 'inv-wt');

  try {
    const state = await sm.sync();

    // Every worker should have a worktree
    for (const worker of Object.values(state.workers)) {
      assert(!!worker.workdir, `Worker ${worker.sessionName} has no workdir`);
      assert(fs.existsSync(worker.workdir), `Worker ${worker.sessionName} workdir does not exist: ${worker.workdir}`);
    }
  } finally {
    await sm.deleteWorker(sessionName);
  }
};

const test_no_orphan_sessions: TestFn = async () => {
  const { backend, sm } = getBackendAndManager();
  const { sessionName } = await createTestWorker(sm, 'inv-orphan');

  // Delete
  await sm.deleteWorker(sessionName);

  // Verify no test tmux sessions remain
  const liveSessions = await backend.listSessions();
  const testSessions = liveSessions.filter(s => s.name.includes(TEST_PREFIX));
  assertEqual(testSessions.length, 0, `Expected 0 orphan test sessions, found: ${testSessions.map(s => s.name).join(', ')}`);
};

// CLI

const test_whoami: TestFn = async () => {
  const { sm } = getBackendAndManager();
  const { sessionName } = await createTestWorker(sm, 'whoami');

  try {
    const state = await sm.sync();
    const worker = state.workers[sessionName];
    assert(!!worker, 'Worker should exist');

    // Simulate whoami by checking workdir matching
    const workdir = worker.workdir;
    assert(!!workdir, 'Worker should have workdir');
    assert(fs.existsSync(workdir), 'Workdir should exist');

    // Read sessions file and match cwd against workdirs (same logic as whoami command)
    const sessions = readSessions() as { workers?: Record<string, { workdir: string; sessionName: string }> };
    let found = false;
    for (const w of Object.values(sessions.workers || {})) {
      if (path.resolve(w.workdir) === path.resolve(workdir)) {
        assertEqual(w.sessionName, sessionName, 'whoami should identify correct session');
        found = true;
        break;
      }
    }
    assert(found, 'whoami should find the worker by workdir');
  } finally {
    await sm.deleteWorker(sessionName);
  }
};

const test_doctor: TestFn = async () => {
  // Doctor checks prerequisites — just verify it doesn't throw
  // We test the core logic directly since we can't run the full CLI in-process
  const gitInstalled = await exec('which git').then(() => true, () => false);
  assert(gitInstalled, 'git should be installed (prerequisite for E2E tests)');

  const tmuxInstalled = await exec('which tmux').then(() => true, () => false);
  assert(tmuxInstalled, 'tmux should be installed (prerequisite for E2E tests)');

  // Verify HYDRA_HOME directory was created or exists
  const hydraDir = getHydraDir();
  // It may or may not exist yet depending on earlier tests; just check it's set correctly
  assertEqual(hydraDir, hydraHome, 'getHydraDir() should respect HYDRA_HOME');
};

// ── Test Registry ──

const ALL_TESTS: Array<{ name: string; fn: TestFn }> = [
  // Worker lifecycle
  { name: 'test_worker_create', fn: test_worker_create },
  { name: 'test_worker_delete', fn: test_worker_delete },
  { name: 'test_worker_stop_start', fn: test_worker_stop_start },
  { name: 'test_worker_rename', fn: test_worker_rename },
  // Copilot lifecycle
  { name: 'test_copilot_create', fn: test_copilot_create },
  { name: 'test_copilot_delete', fn: test_copilot_delete },
  { name: 'test_copilot_stop_resume', fn: test_copilot_stop_resume },
  // Archive
  { name: 'test_archive_list', fn: test_archive_list },
  { name: 'test_archive_restore', fn: test_archive_restore },
  { name: 'test_archive_dedup', fn: test_archive_dedup },
  // Session model invariants
  { name: 'test_1to1_tmux_agent', fn: test_1to1_tmux_agent },
  { name: 'test_1to1_worker_worktree', fn: test_1to1_worker_worktree },
  { name: 'test_no_orphan_sessions', fn: test_no_orphan_sessions },
  // CLI
  { name: 'test_whoami', fn: test_whoami },
  { name: 'test_doctor', fn: test_doctor },
];

// ── Runner ──

export async function runE2ETests(opts?: { filter?: string }): Promise<TestReport> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  let tests = ALL_TESTS;
  if (opts?.filter) {
    const filterLower = opts.filter.toLowerCase();
    tests = tests.filter(t => t.name.toLowerCase().includes(filterLower));
  }

  await setupTestEnvironment();

  try {
    for (const test of tests) {
      const testStart = Date.now();
      try {
        await test.fn();
        results.push({
          name: test.name,
          passed: true,
          durationMs: Date.now() - testStart,
        });
      } catch (error) {
        results.push({
          name: test.name,
          passed: false,
          durationMs: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await teardownTestEnvironment();
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    results,
    passed,
    failed,
    total: results.length,
    durationMs: Date.now() - startTime,
  };
}
