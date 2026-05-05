import { AgentType } from './types';

export const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude', codex: 'Codex', gemini: 'Gemini', custom: 'Custom',
};

export const DEFAULT_AGENT_COMMANDS: Record<string, string> = {
  claude: 'claude', codex: 'codex', gemini: 'gemini',
};

/** Per-agent flag to enable full auto-approve (skip all permission prompts) */
export const AGENT_YOLO_FLAGS: Record<string, string> = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
  gemini: '--yolo',
};

/**
 * Session ID capture configuration per agent.
 *
 * - Claude Code: uses --session-id flag at launch (no capture needed)
 * - Codex CLI (>= 0.1.2025042500): /status command, parse session ID from output
 * - Gemini CLI (>= 0.5.0): /stats command, parse session ID from output
 */
export interface SessionCaptureConfig {
  /** Slash command to query agent status */
  statusCommand: string;
  /** Regex to extract session ID from captured pane output (first capture group) */
  sessionIdPattern: RegExp;
  /** Delay (ms) before sending status command, to wait for agent readiness */
  readyDelayMs: number;
  /** Delay (ms) after sending status command, before capturing pane output */
  captureDelayMs: number;
}

export const AGENT_SESSION_CAPTURE: Partial<Record<string, SessionCaptureConfig>> = {
  codex: {
    statusCommand: '/status',
    sessionIdPattern: /Session:\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/,
    readyDelayMs: 8000,
    captureDelayMs: 2000,
  },
  gemini: {
    statusCommand: '/stats',
    sessionIdPattern: /Session ID:\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/,
    readyDelayMs: 15000,
    captureDelayMs: 2000,
  },
};

/** Delay (ms) for Claude before sending task (agent needs time to start) — used as fallback timeout */
export const CLAUDE_READY_DELAY_MS = 5000;

/**
 * Ready indicator patterns per agent type.
 * Poll tmux pane output for these patterns to detect when the agent TUI is ready.
 *
 * Claude Code's trust prompt uses both ❯ (selection indicator) and ─ (separator),
 * so neither alone is sufficient. The status bar with ⏵ only appears once the TUI
 * is fully initialized and at the idle input prompt.
 */
export const AGENT_READY_PATTERNS: Record<string, RegExp> = {
  claude: /⏵/,
  codex: /⏵/,
  gemini: /⏵/,
};

/**
 * Pattern to detect the Claude trust prompt ("Do you trust this folder?").
 * When detected, send Enter to accept it before waiting for the actual input prompt.
 */
export const CLAUDE_TRUST_PROMPT_PATTERN = /trust this folder/;

/** Maximum time (ms) to wait for agent readiness before giving up */
export const AGENT_READY_TIMEOUT_MS = 30000;

/** Polling interval (ms) when waiting for agent readiness */
export const AGENT_READY_POLL_INTERVAL_MS = 500;

/**
 * Build the shell command to RESUME an existing agent session.
 * Returns null if the agent type doesn't support resume.
 */
export function buildAgentResumeCommand(
  agentType: string,
  agentBinary: string,
  sessionId: string,
): string | null {
  const binary = agentBinary.split(/\s+/)[0]; // strip flags from default command
  switch (agentType) {
    case 'claude': {
      return `${binary} --resume ${sessionId}`;
    }
    case 'codex':
      return `${binary} resume ${sessionId}`;
    case 'gemini':
      return `${binary} --resume ${sessionId}`;
    default:
      return null;
  }
}

/** Build the shell command to launch an agent (matches bash CLI get_agent_command) */
export function buildAgentLaunchCommand(
  agentType: string,
  agentBinary: string,
  task?: string,
  sessionId?: string,
): string {
  const yolo = AGENT_YOLO_FLAGS[agentType] || '';

  switch (agentType) {
    case 'claude': {
      let flags = yolo;
      if (sessionId) flags += ` --session-id ${sessionId}`;
      return task ? `${agentBinary} ${flags} -- ${shellQuoteForDisplay(task)}` : `${agentBinary} ${flags}`;
    }
    case 'codex':
      return task
        ? `${agentBinary} ${yolo} ${shellQuoteForDisplay(task)}`
        : `${agentBinary} ${yolo}`;
    case 'gemini':
      return task
        ? `${agentBinary} ${yolo} ${shellQuoteForDisplay(task)}`
        : `${agentBinary} ${yolo}`;
    default:
      return agentBinary;
  }
}

function shellQuoteForDisplay(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
