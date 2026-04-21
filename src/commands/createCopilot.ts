import * as vscode from 'vscode';
import { getActiveBackend } from '../utils/multiplexer';
import { pickAgentType, getAgentCommand } from '../utils/agentConfig';

const COPILOT_SESSION_NAME = 'hydra-copilot';

export async function createCopilot(): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  // Check if copilot session already exists
  const sessions = await backend.listSessions();
  for (const session of sessions) {
    const role = await backend.getSessionRole(session.name);
    if (role === 'copilot') {
      const action = await vscode.window.showInformationMessage(
        `Copilot session "${session.name}" already exists.`,
        'Attach',
        'Cancel'
      );
      if (action === 'Attach') {
        const workdir = await backend.getSessionWorkdir(session.name);
        backend.attachSession(session.name, workdir);
      }
      return;
    }
  }

  // Pick agent type
  const agentType = await pickAgentType();
  if (!agentType) return;

  // Use workspace folder as cwd (no git required)
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }
  const cwd = workspaceFolders[0].uri.fsPath;

  try {
    // Create tmux session
    await backend.createSession(COPILOT_SESSION_NAME, cwd);
    await backend.setSessionWorkdir(COPILOT_SESSION_NAME, cwd);
    await backend.setSessionRole(COPILOT_SESSION_NAME, 'copilot');
    await backend.setSessionAgent(COPILOT_SESSION_NAME, agentType);

    // Launch agent
    const agentCommand = getAgentCommand(agentType);
    await backend.sendKeys(COPILOT_SESSION_NAME, agentCommand);

    // Attach
    backend.attachSession(COPILOT_SESSION_NAME, cwd);

    vscode.window.showInformationMessage(`Copilot created with ${agentType}`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create copilot: ${message}`);
  }
}
