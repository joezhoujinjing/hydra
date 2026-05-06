#!/usr/bin/env node
/**
 * Standalone background monitor: watches a worker's tmux pane for agent idle
 * and notifies the parent copilot when the worker completes its task.
 *
 * Spawned as a detached child process by SessionManager after sending the
 * initial task prompt. Exits silently on any error or when the session is gone.
 *
 * Usage: node completionMonitor.js '<json-config>'
 */

import { execSync } from 'child_process';

interface MonitorConfig {
  tmuxCommand: string;
  sessionName: string;
  copilotSessionName: string;
  readyPattern: string;
  message: string;
  /** @internal Timing overrides for testing */
  initialSleepMs?: number;
  phase1PollMs?: number;
  phase1TimeoutMs?: number;
  confirmationMs?: number;
  phase2PollMs?: number;
  phase2TimeoutMs?: number;
}

const config: MonitorConfig = JSON.parse(process.argv[2]);

function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '`"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function capturePane(): string | null {
  try {
    return execSync(
      `${config.tmuxCommand} capture-pane -p -t ${shellQuote(config.sessionName)} -S -10`,
      { encoding: 'utf-8', timeout: 5000 },
    );
  } catch {
    return null;
  }
}

function hasSession(sessionName: string): boolean {
  try {
    execSync(
      `${config.tmuxCommand} has-session -t ${shellQuote(sessionName)}`,
      { stdio: 'ignore', timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const pattern = new RegExp(config.readyPattern);
  const initialSleep = config.initialSleepMs ?? 15_000;
  const phase1Poll = config.phase1PollMs ?? 3_000;
  const phase1Timeout = config.phase1TimeoutMs ?? 120_000;
  const confirmation = config.confirmationMs ?? 3_000;
  const phase2Poll = config.phase2PollMs ?? 5_000;
  const phase2Timeout = config.phase2TimeoutMs ?? 7_200_000;

  // Phase 1: Wait for agent to start processing (ready pattern disappears).
  // After the task prompt is sent the agent may still briefly show the idle
  // indicator, so we give it time to begin work.
  await sleep(initialSleep);
  const busyDeadline = Date.now() + phase1Timeout;
  let seenBusy = false;

  while (Date.now() < busyDeadline) {
    const output = capturePane();
    if (output === null) return; // Session gone
    if (!pattern.test(output)) {
      seenBusy = true;
      break;
    }
    await sleep(phase1Poll);
  }

  if (!seenBusy) return; // Agent never started processing — nothing to notify

  // Phase 2: Wait for agent to become idle again (ready pattern reappears).
  const idleDeadline = Date.now() + phase2Timeout;

  while (Date.now() < idleDeadline) {
    if (!hasSession(config.sessionName)) return;

    const output = capturePane();
    if (output === null) return;

    if (pattern.test(output)) {
      // Confirm with a second check after a brief delay to avoid false positives
      await sleep(confirmation);
      const output2 = capturePane();
      if (output2 && pattern.test(output2)) {
        // Agent is idle — send notification to copilot
        if (!hasSession(config.copilotSessionName)) return;

        try {
          execSync(
            `${config.tmuxCommand} send-keys -l -t ${shellQuote(config.copilotSessionName)} ${shellQuote(config.message)}`,
            { stdio: 'ignore', timeout: 5000 },
          );
          await sleep(100);
          execSync(
            `${config.tmuxCommand} send-keys -t ${shellQuote(config.copilotSessionName)} Enter`,
            { stdio: 'ignore', timeout: 5000 },
          );
        } catch {
          // Best-effort notification
        }
        return;
      }
    }

    await sleep(phase2Poll);
  }
}

main().catch(() => process.exit(0));
