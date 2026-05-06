/**
 * Smoke test for the completion monitor.
 *
 * Creates two tmux sessions (fake worker + fake copilot), spawns the
 * completion monitor with fast timing overrides, simulates the worker
 * going busy → idle, and verifies the copilot receives the notification.
 *
 * Requires: tmux installed and no existing sessions named
 * hydra-smoke-cm-worker / hydra-smoke-cm-copilot.
 */

import assert from 'node:assert/strict';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const WORKER_SESSION = 'hydra-smoke-cm-worker';
const COPILOT_SESSION = 'hydra-smoke-cm-copilot';
const IDLE_MARKER = 'HYDRA_SMOKE_IDLE';

function sq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function killSession(name: string): void {
  try {
    execSync(`tmux kill-session -t ${sq(name)}`, { stdio: 'ignore', timeout: 5000 });
  } catch { /* may not exist */ }
}

function capturePane(session: string, lines = 50): string {
  return execSync(
    `tmux capture-pane -p -t ${sq(session)} -S -${lines}`,
    { encoding: 'utf-8', timeout: 5000 },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main(): Promise<void> {
  // Pre-flight: tmux must be installed
  try {
    execSync('which tmux', { stdio: 'ignore' });
  } catch {
    console.log('completionMonitorSmoke: SKIP (tmux not available)');
    return;
  }

  // Clean up leftover sessions from a previous failed run
  killSession(WORKER_SESSION);
  killSession(COPILOT_SESSION);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-smoke-cm-'));
  let monitorProcess: ChildProcess | undefined;

  try {
    // ── 1. Create worker session running a fake agent script ──
    //
    // The script prints IDLE_MARKER (idle), waits for input, then prints
    // 20 filler lines to push the marker off the last-10-line capture
    // window (simulating "busy"), sleeps briefly, then prints IDLE_MARKER
    // again (idle / completed).
    const fakeScript = path.join(tmpDir, 'fake-agent.sh');
    fs.writeFileSync(fakeScript, [
      '#!/bin/bash',
      `printf '%s\\n' '${IDLE_MARKER}'`,
      'read -r',
      '# Print enough filler to push the marker beyond the last 10 lines',
      '# of scrollback (capture-pane -S -10 = 10 scrollback + 24 visible = 34).',
      'for i in $(seq 1 50); do printf "busy %s\\n" "$i"; done',
      'sleep 2',
      `printf '%s\\n' '${IDLE_MARKER}'`,
      'exec sleep 999',
    ].join('\n'), { mode: 0o755 });

    execSync(
      `tmux new-session -d -s ${sq(WORKER_SESSION)} -x 80 -y 24 -- bash ${sq(fakeScript)}`,
      { timeout: 5000 },
    );

    // ── 2. Create copilot session running cat (receives notifications) ──
    execSync(
      `tmux new-session -d -s ${sq(COPILOT_SESSION)} -x 80 -y 24 -- cat`,
      { timeout: 5000 },
    );

    // Wait for the fake agent to start and print its initial marker
    await sleep(1000);
    const initialPane = capturePane(WORKER_SESSION);
    assert.ok(
      initialPane.includes(IDLE_MARKER),
      `Worker pane should show idle marker initially, got:\n${initialPane}`,
    );

    // ── 3. Spawn the completion monitor with fast timing ──
    const monitorScript = path.resolve(__dirname, '../core/completionMonitor.js');
    const notificationMessage =
      `Worker #1 (smoke-test) has completed. Branch: test/smoke. ` +
      `Use \`hydra worker logs ${WORKER_SESSION}\` to review output.`;

    const monitorConfig = JSON.stringify({
      tmuxCommand: 'tmux',
      sessionName: WORKER_SESSION,
      copilotSessionName: COPILOT_SESSION,
      readyPattern: IDLE_MARKER,
      message: notificationMessage,
      // Fast timing for smoke test (~8s total instead of ~30s)
      initialSleepMs: 2000,
      phase1PollMs: 500,
      phase1TimeoutMs: 30000,
      confirmationMs: 1000,
      phase2PollMs: 500,
      phase2TimeoutMs: 30000,
    });

    monitorProcess = spawn(process.execPath, [monitorScript, monitorConfig], {
      stdio: 'ignore',
    });

    // ── 4. Make the worker "busy" ──
    //
    // Wait for the monitor to pass its initial sleep and enter Phase 1
    // polling, then send Enter to unblock `read` in the fake agent.
    // The fake agent will print 50 filler lines (pushing the marker
    // well beyond the capture window) and sleep 2s — the monitor
    // detects the marker is gone.
    await sleep(3000);
    execSync(`tmux send-keys -t ${sq(WORKER_SESSION)} Enter`, { timeout: 5000 });

    // ── 5. Wait for the fake agent to return to idle ──
    //
    // After the 2s sleep in the script, the marker reappears.
    // The monitor detects it, waits 1s confirmation, then sends
    // the notification to the copilot. Budget 8s total from step 4.
    await sleep(8000);

    // ── 6. Verify the copilot received the notification ──
    const copilotPane = capturePane(COPILOT_SESSION);
    assert.ok(
      copilotPane.includes('has completed'),
      `Copilot pane should contain notification, got:\n${copilotPane}`,
    );
    assert.ok(
      copilotPane.includes('smoke-test'),
      `Notification should mention worker name, got:\n${copilotPane}`,
    );

    console.log('completionMonitorSmoke: ok');
  } finally {
    // ── 7. Clean up ──
    if (monitorProcess && !monitorProcess.killed) {
      monitorProcess.kill();
    }
    killSession(WORKER_SESSION);
    killSession(COPILOT_SESSION);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
