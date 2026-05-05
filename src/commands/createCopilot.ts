import * as os from 'os';
import * as vscode from 'vscode';
import { getActiveBackend, MultiplexerBackend } from '../utils/multiplexer';
import { pickAgentType, AgentType } from '../utils/agentConfig';
import { TmuxBackendCore } from '../core/tmux';
import { SessionManager } from '../core/sessionManager';

const ONBOARDING_PROMPT = `You are a Hydra copilot — an AI orchestrator that manages parallel AI workers to complete complex tasks.

## Preflight: verify the hydra CLI
Before anything else, run \`hydra --version\`. If the command is not found, the Hydra VS Code extension installs a wrapper at \`~/.hydra/bin/hydra\` — add it to PATH for this session with \`export PATH="$HOME/.hydra/bin:$PATH"\` and retry. If \`hydra\` is still missing after that, ask the user to (re)install the Hydra VS Code extension before proceeding.

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
  (async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 8000));
      await backend.sendMessage(sessionName, ONBOARDING_PROMPT);
    } catch {
      // Best-effort — agent may not be ready yet
    }
  })();
}

export async function createCopilotWithAgent(agentType: AgentType): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  const sessionName = backend.sanitizeSessionName(`hydra-copilot-${agentType}`);

  // If session already exists, just attach
  if (await backend.hasSession(sessionName)) {
    const workdir = await backend.getSessionWorkdir(sessionName);
    backend.attachSession(sessionName, workdir, undefined, 'copilot');
    return;
  }

  try {
    const sm = new SessionManager(new TmuxBackendCore());
    const copilotInfo = await sm.createCopilotAndFinalize({
      workdir: os.homedir(),
      agentType,
      sessionName,
    });

    sendCopilotOnboarding(backend, copilotInfo.sessionName);
    backend.attachSession(copilotInfo.sessionName, copilotInfo.workdir, undefined, 'copilot');

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
  if (await backend.hasSession(sessionName)) {
    const action = await vscode.window.showInformationMessage(
      `Session "${sessionName}" already exists.`,
      'Attach',
      'Cancel'
    );
    if (action === 'Attach') {
      const workdir = await backend.getSessionWorkdir(sessionName);
      backend.attachSession(sessionName, workdir, undefined, 'copilot');
    }
    return;
  }

  try {
    const sm = new SessionManager(new TmuxBackendCore());
    const copilotInfo = await sm.createCopilotAndFinalize({
      workdir: os.homedir(),
      agentType,
      sessionName,
      name: nameInput.trim(),
    });

    sendCopilotOnboarding(backend, copilotInfo.sessionName);
    backend.attachSession(copilotInfo.sessionName, copilotInfo.workdir, undefined, 'copilot');

    vscode.window.showInformationMessage(`Copilot created: ${sessionName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create copilot: ${message}`);
  }
}
