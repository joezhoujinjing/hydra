import * as vscode from 'vscode';
import { createBackendFromConfig } from './backendFactory';

// ─── Shared Types ─────────────────────────────────────────

export type MultiplexerType = 'tmux' | 'zellij';

export type HydraRole = 'copilot' | 'worker';

export interface MultiplexerSession {
  name: string;
  windows: number; // tmux: windows, zellij: tabs
  attached: boolean;
  workdir?: string;
}

export interface SessionStatusInfo {
  attached: boolean;
  lastActive: number; // unix timestamp (seconds)
}

// ─── Backend Interface ────────────────────────────────────

/**
 * Abstraction layer for terminal multiplexer backends (tmux, zellij).
 * Each backend implements the same session lifecycle operations so the
 * rest of the extension can work with either multiplexer transparently.
 */
export interface MultiplexerBackend {
  readonly type: MultiplexerType;

  /** Human-readable name for UI messages (e.g. "tmux", "Zellij") */
  readonly displayName: string;

  /** Install hint shown when the binary is missing */
  readonly installHint: string;

  // ── Detection ──

  isInstalled(): Promise<boolean>;

  // ── Session CRUD ──

  listSessions(): Promise<MultiplexerSession[]>;
  createSession(sessionName: string, cwd: string): Promise<void>;
  killSession(sessionName: string): Promise<void>;
  hasSession(sessionName: string): Promise<boolean>;

  // ── Session Metadata ──
  // tmux stores workdir as a custom option (@workdir).
  // Zellij uses a JSON file since it has no built-in metadata store.

  getSessionWorkdir(sessionName: string): Promise<string | undefined>;
  setSessionWorkdir(sessionName: string, workdir: string): Promise<void>;

  // ── Hydra Metadata ──

  getSessionRole(sessionName: string): Promise<HydraRole | undefined>;
  setSessionRole(sessionName: string, role: HydraRole): Promise<void>;
  getSessionAgent(sessionName: string): Promise<string | undefined>;
  setSessionAgent(sessionName: string, agent: string): Promise<void>;

  // ── Keys ──

  sendKeys(sessionName: string, keys: string): Promise<void>;

  // ── Session Status ──

  getSessionInfo(sessionName: string): Promise<SessionStatusInfo>;
  getSessionPaneCount(sessionName: string): Promise<number>;
  /** Returns PIDs of processes running in session panes (for CPU tracking). */
  getSessionPanePids(sessionName: string): Promise<string[]>;

  // ── Terminal Attachment ──

  attachSession(
    sessionName: string,
    cwd?: string,
    location?: vscode.TerminalLocation
  ): vscode.Terminal;

  // ── Pane / Window (Tab) Operations ──

  splitPane(sessionName: string, cwd?: string): Promise<void>;
  /** tmux: new-window, zellij: new-tab */
  newWindow(sessionName: string, cwd?: string): Promise<void>;

  // ── Session Naming ──

  buildSessionName(repoName: string, slug: string): string;
  sanitizeSessionName(name: string): string;
}

// ─── Backend Registry & Factory ───────────────────────────

let activeBackend: MultiplexerBackend | undefined;

export function getActiveBackend(): MultiplexerBackend {
  if (!activeBackend) {
    activeBackend = createBackendFromConfig();
  }
  return activeBackend;
}

export function refreshBackendFromConfig(): void {
  activeBackend = createBackendFromConfig();
}

/**
 * Read the user's multiplexer preference from VS Code settings.
 * Falls back to 'tmux' when no preference is set.
 */
export function getConfiguredMultiplexerType(): MultiplexerType {
  return vscode.workspace
    .getConfiguration('tmuxWorktree')
    .get<MultiplexerType>('multiplexer', 'tmux');
}
