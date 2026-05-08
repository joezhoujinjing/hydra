/**
 * Smoke test for the remote worker MVP (Epic #129 phase 1).
 *
 * Skipped automatically unless SMOKE_REMOTE_HOST is set.
 *
 *   SMOKE_REMOTE_HOST=claude-remote-test.us-west1-a.nexi-lab-888 \
 *   SMOKE_REMOTE_REPO=/home/sean/smoke-repo \
 *   node out/smoke/remoteWorkerSmoke.js
 *
 * SMOKE_REMOTE_HOST  — SSH alias (must resolve via ~/.ssh/config; for GCP run
 *                     `gcloud compute config-ssh` first).
 * SMOKE_REMOTE_REPO  — Absolute path to a git repo on the remote that we can
 *                     `git worktree add` against. Defaults to /tmp/hydra-smoke-repo
 *                     and we initialize one there if missing.
 *
 * The test:
 *   1. Preflight (tmux + claude on the remote).
 *   2. Create a remote worker (branch hydra-smoke-<ts>) on a throwaway repo.
 *   3. send a `pwd` keystroke and capture the pane — assert the worktree
 *      path appears in the output.
 *   4. Delete the worker (kill session + remove worktree + delete branch).
 *
 * Returns non-zero on failure so CI / manual operators see the failure clearly.
 */

import { RemoteTmuxBackend } from '../core/remoteTmux';

const HOST = process.env.SMOKE_REMOTE_HOST;
const REPO = process.env.SMOKE_REMOTE_REPO || '/tmp/hydra-smoke-repo';
const AGENT_BIN = process.env.SMOKE_REMOTE_AGENT || 'claude';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function ensureSmokeRepo(remote: RemoteTmuxBackend, repoPath: string): Promise<void> {
  if (await remote.repoExists(repoPath)) return;
  // Bootstrap a tiny repo so the test is self-contained.
  // We use the same private SSH machinery via the public preflight surface.
  // Run a small init script.
  const initScript = [
    'set -e',
    `mkdir -p ${shQ(repoPath)}`,
    `cd ${shQ(repoPath)}`,
    'if [ ! -d .git ]; then',
    'git init -q',
    'git config user.email "smoke@hydra.local"',
    'git config user.name "Hydra Smoke"',
    'echo "smoke" > README.md',
    'git add README.md',
    'git commit -q -m "init"',
    'fi',
  ].join('\n');
  await runRaw(remote, initScript);
}

function shQ(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Reach into the backend's runRemote path via newSession-style commands.
// For test setup we want a simple shell exec — easiest is to spawn ssh ourselves.
import { execFile } from 'child_process';
async function runRaw(remote: RemoteTmuxBackend, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', remote.host, cmd],
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`ssh ${remote.host} failed: ${stderr || err.message}`));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

async function main(): Promise<void> {
  if (!HOST) {
    console.log('SMOKE_REMOTE_HOST not set — skipping remote worker smoke test.');
    process.exit(0);
  }

  console.log(`=== remoteWorkerSmoke ===`);
  console.log(`host:   ${HOST}`);
  console.log(`repo:   ${REPO}`);
  console.log(`agent:  ${AGENT_BIN}`);
  console.log();

  const remote = new RemoteTmuxBackend(HOST);

  // 1. preflight
  console.log('[1/5] Preflight (tmux + agent)…');
  await remote.preflight(AGENT_BIN);
  console.log('  OK');

  // 2. ensure repo exists
  console.log('[2/5] Ensuring smoke repo exists on remote…');
  await ensureSmokeRepo(remote, REPO);
  console.log('  OK');

  const ts = Date.now();
  const branch = `hydra-smoke-${ts}`;
  const slug = branch.replace(/[/\\\s.:]/g, '-');
  const sessionName = `hydra-smoke_${slug}`;
  const worktreePath = `${REPO.replace(/\/+$/, '')}/.hydra-worktrees/${slug}`;

  let createdWorktree = false;
  let createdSession = false;

  try {
    // 3. create worker (worktree + tmux session running a no-op command for testability)
    console.log(`[3/5] Creating worker (branch=${branch}, session=${sessionName})…`);
    await remote.addWorktree(REPO, branch, worktreePath);
    createdWorktree = true;
    // For the smoke test we run `bash` in tmux instead of the actual agent —
    // we want to send `pwd` and read deterministic output, not boot a TUI.
    await remote.newSession(sessionName, worktreePath, 'bash');
    createdSession = true;
    console.log('  OK');

    // Give bash a moment to initialize.
    await sleep(800);

    // 4. send pwd, capture pane, assert worktreePath is present
    console.log('[4/5] Sending `pwd` and capturing pane…');
    await remote.sendMessage(sessionName, 'pwd');
    await sleep(800);
    const pane = await remote.capturePane(sessionName, 50);
    if (!pane.includes(worktreePath)) {
      console.error('  FAIL — pane did not contain worktree path:');
      console.error('    expected substring:', worktreePath);
      console.error('    pane output:');
      console.error(pane.split('\n').map(l => '      ' + l).join('\n'));
      throw new Error('Worktree path not found in pane output');
    }
    console.log('  OK — pane contains worktree path');

    // 5. delete (kill session + remove worktree + delete branch)
    console.log('[5/5] Tearing down…');
    await remote.killSession(sessionName);
    createdSession = false;
    await remote.removeWorktree(REPO, worktreePath);
    createdWorktree = false;
    await remote.deleteBranch(REPO, branch);
    console.log('  OK');

    console.log('\n=== Smoke test PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('\n=== Smoke test FAILED ===');
    console.error(err instanceof Error ? err.message : String(err));
    // Best-effort cleanup.
    if (createdSession) {
      console.error('Cleaning up tmux session…');
      await remote.killSession(sessionName).catch(() => {});
    }
    if (createdWorktree) {
      console.error('Cleaning up worktree…');
      await remote.removeWorktree(REPO, worktreePath).catch(() => {});
      await remote.deleteBranch(REPO, branch).catch(() => {});
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
