import { AgentType } from './types';

export const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude', codex: 'Codex', gemini: 'Gemini', custom: 'Custom',
};

export const DEFAULT_AGENT_COMMANDS: Record<string, string> = {
  claude: 'claude', codex: 'codex', gemini: 'gemini',
};

/** Build the shell command to launch an agent (matches bash CLI get_agent_command) */
export function buildAgentLaunchCommand(
  agentType: string,
  agentBinary: string,
  task?: string,
  repoRoot?: string
): string {
  switch (agentType) {
    case 'claude': {
      let flags = '--dangerously-skip-permissions';
      if (repoRoot) flags += ` --add-dir ${repoRoot}`;
      return task ? `${agentBinary} ${flags} -- ${shellQuoteForDisplay(task)}` : `${agentBinary} ${flags}`;
    }
    case 'codex':
      return task ? `${agentBinary} --full-auto ${shellQuoteForDisplay(task)}` : `${agentBinary} --full-auto`;
    case 'gemini':
      return task ? `${agentBinary} -y --include-directories /tmp ${shellQuoteForDisplay(task)}` : `${agentBinary} -y --include-directories /tmp`;
    default:
      return agentBinary;
  }
}

function shellQuoteForDisplay(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
