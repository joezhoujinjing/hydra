import * as vscode from 'vscode';

export type AgentType = 'claude' | 'codex' | 'gemini' | 'aider' | 'custom';

const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  aider: 'Aider',
  custom: 'Custom',
};

export function getDefaultAgent(): AgentType {
  return vscode.workspace
    .getConfiguration('hydra')
    .get<AgentType>('defaultAgent', 'claude');
}

export function getAgentCommand(agentType: string): string {
  const commands = vscode.workspace
    .getConfiguration('hydra')
    .get<Record<string, string>>('agentCommands', {
      claude: 'claude',
      codex: 'codex',
      gemini: 'gemini',
      aider: 'aider',
    });
  return commands[agentType] || agentType;
}

/**
 * Build a full agent command with worker-specific yolo flags.
 * Mirrors the get_agent_command() logic in run/hydra-worker.
 */
export function getWorkerAgentCommand(agentType: string, repoRoot: string): string {
  const baseCmd = getAgentCommand(agentType);
  switch (agentType) {
    case 'claude':
      return `${baseCmd} --dangerously-skip-permissions --add-dir ${repoRoot}`;
    case 'codex':
      return `${baseCmd} --full-auto`;
    case 'gemini':
      return `${baseCmd} -y --include-directories /tmp`;
    default:
      return baseCmd;
  }
}

export async function pickAgentType(): Promise<AgentType | undefined> {
  const defaultAgent = getDefaultAgent();
  const items = (Object.keys(AGENT_LABELS) as AgentType[]).map(key => ({
    label: AGENT_LABELS[key],
    description: key === defaultAgent ? '(default)' : '',
    value: key,
  }));

  // Move default to top
  items.sort((a, b) => {
    if (a.value === defaultAgent) return -1;
    if (b.value === defaultAgent) return 1;
    return 0;
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select agent type',
  });
  return picked?.value;
}
