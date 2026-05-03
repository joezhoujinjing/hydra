import * as vscode from 'vscode';
import * as path from 'path';
import { HydraRole } from './multiplexer';

export const HYDRA_PREFIX_COPILOT = 'Copilot:';
export const HYDRA_PREFIX_WORKER = 'Worker:';

/**
 * Scan tabGroups for a tab whose label starts with the given prefix.
 * Returns the viewColumn of the first match, or undefined.
 */
function findGroupByPrefix(prefix: string): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (typeof tab.label === 'string' && tab.label.startsWith(prefix)) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

/**
 * Get the location options for a Hydra terminal.
 * When a role is specified, discovers the editor group containing only that role's tabs.
 * Falls back to ViewColumn.Beside when no matching group is found (creates a new group).
 */
export function getHydraEditorLocation(role?: HydraRole): vscode.TerminalEditorLocationOptions {
  let existing: vscode.ViewColumn | undefined;
  if (role === 'copilot') {
    existing = findGroupByPrefix(HYDRA_PREFIX_COPILOT);
  } else if (role === 'worker') {
    existing = findGroupByPrefix(HYDRA_PREFIX_WORKER);
  } else {
    // No role: search for either prefix (backward compat)
    existing = findGroupByPrefix(HYDRA_PREFIX_COPILOT) ?? findGroupByPrefix(HYDRA_PREFIX_WORKER);
  }
  return { viewColumn: existing ?? vscode.ViewColumn.Beside, preserveFocus: false };
}

const MAX_SHORT_NAME_LENGTH = 20;

function truncateShortName(name: string): string {
  if (name.length <= MAX_SHORT_NAME_LENGTH) return name;
  return name.slice(0, MAX_SHORT_NAME_LENGTH - 1) + '\u2026';
}

/**
 * Build a terminal name with a Hydra prefix based on role.
 * Returns a plain shortName when no role is specified.
 */
export function buildHydraTerminalName(shortName: string, role?: HydraRole): string {
  if (role === 'copilot') {
    const agentName = shortName.replace(/^hydra-copilot-/, '');
    return `${HYDRA_PREFIX_COPILOT} ${truncateShortName(agentName)}`;
  }
  if (role === 'worker') return `${HYDRA_PREFIX_WORKER} ${truncateShortName(shortName)}`;
  return truncateShortName(shortName);
}

/**
 * Get the terminal icon (resources/tmux.svg) for a Hydra terminal.
 */
export function getHydraTerminalIcon(): vscode.Uri {
  // __dirname at runtime is `out/utils/`, so go up two levels to reach the extension root
  return vscode.Uri.file(path.join(__dirname, '..', '..', 'resources', 'tmux.svg'));
}

/**
 * Get the terminal tab color based on role.
 * Blue for copilot, green for worker.
 */
export function getHydraTerminalColor(role?: HydraRole): vscode.ThemeColor | undefined {
  if (role === 'copilot') return new vscode.ThemeColor('terminal.ansiBlue');
  if (role === 'worker') return new vscode.ThemeColor('terminal.ansiGreen');
  return undefined;
}
