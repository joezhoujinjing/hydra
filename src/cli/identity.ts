import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as os from 'os';

const SESSIONS_FILE = join(os.homedir(), '.hydra', 'sessions.json');

export interface HydraIdentity {
  role: 'worker' | 'copilot';
  sessionName: string;
  displayName: string;
  agent: string;
  sessionId: string | null;
  workdir: string;
  /** Worker-specific fields */
  workerId?: number;
  branch?: string;
  repo?: string;
  copilotSessionName?: string | null;
}

/**
 * Lightweight identity detection — reads sessions.json (no tmux sync)
 * and matches cwd against known session workdirs.
 * Returns null if not running inside a known Hydra session.
 */
export function detectIdentity(cwd?: string): HydraIdentity | null {
  const dir = resolve(cwd || process.cwd());

  interface RawSession {
    sessionName?: string;
    displayName?: string;
    agent?: string;
    sessionId?: string | null;
    workdir?: string;
    status?: string;
    workerId?: number;
    branch?: string;
    repo?: string;
    copilotSessionName?: string | null;
  }

  let state: { copilots?: Record<string, RawSession>; workers?: Record<string, RawSession> };
  try {
    if (!existsSync(SESSIONS_FILE)) return null;
    state = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8'));
  } catch {
    return null;
  }

  // Check copilots first (a copilot spawning workers is the primary use case)
  for (const copilot of Object.values(state.copilots || {})) {
    const copilotDir = resolve(copilot.workdir || '');
    if (dir === copilotDir || dir.startsWith(copilotDir + '/')) {
      return {
        role: 'copilot',
        sessionName: copilot.sessionName || '',
        displayName: copilot.displayName || copilot.sessionName || '',
        agent: copilot.agent || 'unknown',
        sessionId: copilot.sessionId ?? null,
        workdir: copilot.workdir || '',
      };
    }
  }

  // Check workers
  for (const worker of Object.values(state.workers || {})) {
    const workerDir = resolve(worker.workdir || '');
    if (dir === workerDir || dir.startsWith(workerDir + '/')) {
      return {
        role: 'worker',
        sessionName: worker.sessionName || '',
        displayName: worker.displayName || worker.sessionName || '',
        agent: worker.agent || 'unknown',
        sessionId: worker.sessionId ?? null,
        workdir: worker.workdir || '',
        workerId: worker.workerId,
        branch: worker.branch,
        repo: worker.repo,
        copilotSessionName: worker.copilotSessionName ?? null,
      };
    }
  }

  return null;
}
