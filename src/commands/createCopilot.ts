import * as os from 'os';
import * as vscode from 'vscode';
import { getActiveBackend, MultiplexerBackend } from '../utils/multiplexer';
import { pickAgentType, getAgentCommand, AgentType } from '../utils/agentConfig';
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
  setTimeout(async () => {
    try {
      await backend.sendMessage(sessionName, ONBOARDING_PROMPT);
    } catch {
      // Best-effort — agent may not be ready yet
    }
  }, 10000);
}

export async function createCopilotWithAgent(agentType: AgentType): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  const sm = new SessionManager(new TmuxBackendCore());
  const state = await sm.sync();
  const cwd = os.homedir();
  const sessionName = backend.sanitizeSessionName(`hydra-copilot-${agentType}`);

  // Check for existing copilot
  const existing = state.copilots[sessionName];
  if (existing) {
    if (existing.status === 'running') {
      backend.attachSession(sessionName, existing.workdir, undefined, 'copilot');
      return;
    }
    // Stopped — resume
    try {
      const { postCreatePromise } = await sm.resumeCopilot(sessionName);
      sendCopilotOnboarding(backend, sessionName);
      backend.attachSession(sessionName, existing.workdir || cwd, undefined, 'copilot');
      postCreatePromise.catch(() => { /* best-effort */ });
      vscode.window.showInformationMessage(`Resumed copilot: ${sessionName} (${agentType})`);
      vscode.commands.executeCommand('tmux.refresh');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to resume copilot: ${message}`);
      return;
    }
  }

  try {
    const copilotInfo = await sm.createCopilot({
      workdir: cwd,
      agentType,
      sessionName,
      agentCommand: getAgentCommand(agentType),
    });

    sendCopilotOnboarding(backend, copilotInfo.sessionName);
    backend.attachSession(copilotInfo.sessionName, cwd, undefined, 'copilot');

    vscode.window.showInformationMessage(`Copilot created: ${copilotInfo.sessionName} (${agentType})`);
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

  const agentType = await pickAgentType();
  if (!agentType) return;

  const defaultName = `hydra-copilot-${agentType}`;
  const nameInput = await vscode.window.showInputBox({
    prompt: 'Copilot session name',
    value: defaultName,
    placeHolder: defaultName,
  });
  if (!nameInput) return;

  const sessionName = backend.sanitizeSessionName(nameInput.trim());
  const sm = new SessionManager(new TmuxBackendCore());
  const state = await sm.sync();
  const cwd = os.homedir();

  // Check for existing copilot
  const existing = state.copilots[sessionName];
  if (existing) {
    if (existing.status === 'running') {
      const action = await vscode.window.showInformationMessage(
        `Session "${sessionName}" is already running.`,
        'Attach',
        'Cancel'
      );
      if (action === 'Attach') {
        backend.attachSession(sessionName, existing.workdir, undefined, 'copilot');
      }
      return;
    }

    // Stopped — ask user
    const action = await vscode.window.showInformationMessage(
      `Copilot "${sessionName}" was stopped. Resume previous session?`,
      'Resume',
      'Create New',
      'Cancel'
    );
    if (action === 'Cancel' || !action) return;

    if (action === 'Resume') {
      try {
        const { postCreatePromise } = await sm.resumeCopilot(sessionName);
        sendCopilotOnboarding(backend, sessionName);
        backend.attachSession(sessionName, existing.workdir || cwd, undefined, 'copilot');
        postCreatePromise.catch(() => { /* best-effort */ });
        vscode.window.showInformationMessage(`Resumed copilot: ${sessionName} (${agentType})`);
        vscode.commands.executeCommand('tmux.refresh');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to resume copilot: ${message}`);
      }
      return;
    }

    // "Create New" — delete old and fall through
    await sm.deleteCopilot(sessionName);
  }

  try {
    const copilotInfo = await sm.createCopilot({
      workdir: cwd,
      agentType,
      sessionName,
      agentCommand: getAgentCommand(agentType),
    });

    sendCopilotOnboarding(backend, copilotInfo.sessionName);
    backend.attachSession(copilotInfo.sessionName, cwd, undefined, 'copilot');

    vscode.window.showInformationMessage(`Copilot created: ${copilotInfo.sessionName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create copilot: ${message}`);
  }
}
