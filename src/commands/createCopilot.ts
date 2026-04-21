import * as vscode from 'vscode';
import { getActiveBackend } from '../utils/multiplexer';
import { pickAgentType, getAgentCommand } from '../utils/agentConfig';

export async function createCopilot(): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  // Pick agent type
  const agentType = await pickAgentType();
  if (!agentType) return;

  // Ask for session name (default: hydra-copilot-<agent>)
  const defaultName = `hydra-copilot-${agentType}`;
  const nameInput = await vscode.window.showInputBox({
    prompt: 'Copilot session name',
    value: defaultName,
    placeHolder: defaultName,
  });
  if (!nameInput) return;

  const sessionName = backend.sanitizeSessionName(nameInput.trim());

  // Check if session already exists
  const sessions = await backend.listSessions();
  for (const session of sessions) {
    if (session.name === sessionName) {
      const action = await vscode.window.showInformationMessage(
        `Session "${sessionName}" already exists.`,
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

  // Use workspace folder as cwd (no git required)
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }
  const cwd = workspaceFolders[0].uri.fsPath;

  try {
    // Create tmux session
    await backend.createSession(sessionName, cwd);
    await backend.setSessionWorkdir(sessionName, cwd);
    await backend.setSessionRole(sessionName, 'copilot');
    await backend.setSessionAgent(sessionName, agentType);

    // Launch agent
    const agentCommand = getAgentCommand(agentType);
    await backend.sendKeys(sessionName, agentCommand);

    // Attach
    backend.attachSession(sessionName, cwd);

    vscode.window.showInformationMessage(`Copilot created: ${sessionName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create copilot: ${message}`);
  }
}
