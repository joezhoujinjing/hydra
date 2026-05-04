import * as os from 'os';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { getActiveBackend, MultiplexerBackend } from '../utils/multiplexer';
import { pickAgentType, getAgentCommand, buildAgentLaunchCommand, AgentType } from '../utils/agentConfig';
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

function sendCopilotOnboarding(
  backend: MultiplexerBackend,
  sessionName: string,
  agentType?: string,
  sm?: SessionManager,
  preAssignedSessionId?: string,
): void {
  (async () => {
    try {
      if (!preAssignedSessionId && agentType && sm) {
        // Non-Claude: capture session ID first (includes readiness wait)
        await sm.captureAndPersistSessionId(sessionName, agentType);
      } else {
        // Claude: wait for agent readiness before sending prompt
        await new Promise(resolve => setTimeout(resolve, 8000));
      }
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

  const cwd = os.homedir();
  const sessionName = backend.sanitizeSessionName(`hydra-copilot-${agentType}`);

  // If session already exists, just attach
  const sessions = await backend.listSessions();
  for (const session of sessions) {
    if (session.name === sessionName) {
      const workdir = await backend.getSessionWorkdir(session.name);
      backend.attachSession(session.name, workdir, undefined, 'copilot');
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

    // For Claude, pre-assign session ID via --session-id flag
    const preAssignedSessionId = agentType === 'claude' ? randomUUID() : undefined;
    const agentBinary = getAgentCommand(agentType);
    const launchCmd = buildAgentLaunchCommand(agentType, agentBinary, undefined, undefined, preAssignedSessionId);
    await backend.sendKeys(sessionName, launchCmd);

    // Persist copilot with session ID to sessions.json
    const sm = new SessionManager(new TmuxBackendCore());
    sm.persistCopilotSessionId(sessionName, agentType, cwd, preAssignedSessionId ?? null);

    // Send onboarding prompt after agent boots (and capture session ID for non-Claude)
    sendCopilotOnboarding(backend, sessionName, agentType, sm, preAssignedSessionId);

    backend.attachSession(sessionName, cwd, undefined, 'copilot');

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
        backend.attachSession(session.name, workdir, undefined, 'copilot');
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

    // For Claude, pre-assign session ID via --session-id flag
    const preAssignedSessionId = agentType === 'claude' ? randomUUID() : undefined;
    const agentBinary = getAgentCommand(agentType);
    const launchCmd = buildAgentLaunchCommand(agentType, agentBinary, undefined, undefined, preAssignedSessionId);
    await backend.sendKeys(sessionName, launchCmd);

    // Persist copilot with session ID to sessions.json
    const sm = new SessionManager(new TmuxBackendCore());
    sm.persistCopilotSessionId(sessionName, agentType, cwd, preAssignedSessionId ?? null);

    // Send onboarding prompt after agent boots (and capture session ID for non-Claude)
    sendCopilotOnboarding(backend, sessionName, agentType, sm, preAssignedSessionId);

    // Attach
    backend.attachSession(sessionName, cwd, undefined, 'copilot');

    vscode.window.showInformationMessage(`Copilot created: ${sessionName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create copilot: ${message}`);
  }
}
