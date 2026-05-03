import * as os from 'os';
import * as vscode from 'vscode';
import { getActiveBackend, MultiplexerBackend } from '../utils/multiplexer';
import { pickAgentType, getAgentCommand, buildAgentLaunchCommand, AgentType } from '../utils/agentConfig';

const ONBOARDING_PROMPT = `You are a Hydra copilot — an AI orchestrator that manages parallel AI workers to complete complex tasks.

## Key commands
- \`hydra list --json\`                                   — See all copilots and workers
- \`hydra worker create --repo <path> --branch <name>\`   — Spawn a worker
- \`hydra worker logs <session> --lines 50\`              — Read worker output
- \`hydra worker send <session> "<message>"\`              — Send instructions to a worker
- \`hydra worker delete <session>\`                        — Clean up a finished worker

## Workflow: Plan → Delegate → Monitor → Review → Ship
1. Break the task into independent units of work
2. Create one worker per unit (\`hydra worker create\`)
3. Monitor progress (\`hydra worker logs\`)
4. Review changes (\`git -C <workdir> diff\`)
5. Iterate if needed (\`hydra worker send\`)
6. Ship approved work (push branches and create PRs)

Full reference: https://github.com/joezhoujinjing/hydra/blob/main/AGENTS.md`;

function sendCopilotOnboarding(backend: MultiplexerBackend, sessionName: string): void {
  setTimeout(async () => {
    try {
      await backend.sendMessage(sessionName, ONBOARDING_PROMPT);
    } catch {
      // Best-effort — agent may not be ready yet
    }
  }, 5000);
}

export async function createCopilotWithAgent(agentType: AgentType): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  const cwd = os.homedir();
  const sessionName = backend.sanitizeSessionName(`hydra-copilot-${agentType}`);

  // If session already exists, just attach
  const sessions = await backend.listSessions();
  for (const session of sessions) {
    if (session.name === sessionName) {
      const workdir = await backend.getSessionWorkdir(session.name);
      backend.attachSession(session.name, workdir);
      return;
    }
  }

  try {
    await backend.createSession(sessionName, cwd);
    await backend.setSessionWorkdir(sessionName, cwd);
    await backend.setSessionRole(sessionName, 'copilot');
    await backend.setSessionAgent(sessionName, agentType);

    // Prepend PATH so `hydra` CLI is available inside the session
    await backend.sendKeys(sessionName, 'export PATH="$HOME/.hydra/bin:$PATH"');

    const agentBinary = getAgentCommand(agentType);
    const launchCmd = buildAgentLaunchCommand(agentType, agentBinary);
    await backend.sendKeys(sessionName, launchCmd);

    // Send onboarding prompt after agent boots
    sendCopilotOnboarding(backend, sessionName);

    backend.attachSession(sessionName, cwd);

    vscode.window.showInformationMessage(`Copilot created: ${sessionName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create copilot: ${message}`);
  }
}

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

  const cwd = os.homedir();

  try {
    // Create tmux session
    await backend.createSession(sessionName, cwd);
    await backend.setSessionWorkdir(sessionName, cwd);
    await backend.setSessionRole(sessionName, 'copilot');
    await backend.setSessionAgent(sessionName, agentType);

    // Prepend PATH so `hydra` CLI is available inside the session
    await backend.sendKeys(sessionName, 'export PATH="$HOME/.hydra/bin:$PATH"');

    // Launch agent with full-auto flags
    const agentBinary = getAgentCommand(agentType);
    const launchCmd = buildAgentLaunchCommand(agentType, agentBinary);
    await backend.sendKeys(sessionName, launchCmd);

    // Send onboarding prompt after agent boots
    sendCopilotOnboarding(backend, sessionName);

    // Attach
    backend.attachSession(sessionName, cwd);

    vscode.window.showInformationMessage(`Copilot created: ${sessionName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create copilot: ${message}`);
  }
}
