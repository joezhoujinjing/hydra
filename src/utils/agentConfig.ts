import * as vscode from 'vscode';
import { AgentType } from '../core/types';
import { AGENT_LABELS } from '../core/agentConfig';

export type { AgentType } from '../core/types';
export { AGENT_LABELS, DEFAULT_AGENT_COMMANDS, buildAgentLaunchCommand } from '../core/agentConfig';

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
      codex: 'codex --full-auto',
      gemini: 'gemini',
      aider: 'aider',
    });
  return commands[agentType] || agentType;
}

export async function pickAgentType(): Promise<AgentType | undefined> {
  const defaultAgent = getDefaultAgent();
  const items = (Object.keys(AGENT_LABELS) as AgentType[]).map(key => ({
    label: AGENT_LABELS[key],
    description: key === defaultAgent ? '(default)' : '',
    value: key,
  }));

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
