import * as vscode from 'vscode';
import { SessionManager } from '../core/sessionManager';
import { TmuxBackendCore } from '../core/tmux';
import { validateBranchName, localBranchExists, getRepoRoot } from '../utils/git';
import { pickAgentType } from '../utils/agentConfig';
import { getActiveBackend } from '../utils/multiplexer';
import { ensureBackendInstalled } from './ensureBackendInstalled';

function getBaseBranchOverride(): string | undefined {
  const hydraOverride = vscode.workspace.getConfiguration('hydra').get<string>('baseBranch');
  if (hydraOverride?.trim()) {
    return hydraOverride.trim();
  }

  const legacyOverride = vscode.workspace.getConfiguration('tmuxWorktree').get<string>('baseBranch');
  return legacyOverride?.trim() || undefined;
}

export async function newTask(): Promise<void> {
  const backend = getActiveBackend();
  if (!await ensureBackendInstalled(backend)) {
    return;
  }

  let repoRoot: string;
  try {
    repoRoot = getRepoRoot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create worker: ${message}`);
    return;
  }

  const branchInput = await vscode.window.showInputBox({
    prompt: 'Enter branch name (e.g. feat/auth, fix/session-cleanup)',
    placeHolder: 'feat/my-task',
    validateInput: validateBranchName,
  });
  if (!branchInput) {
    return;
  }

  const branchName = branchInput.trim();
  const validationError = validateBranchName(branchName);
  if (validationError) {
    vscode.window.showErrorMessage(validationError);
    return;
  }

  const agentType = await pickAgentType();
  if (!agentType) {
    return;
  }

  try {
    const branchExisted = await localBranchExists(repoRoot, branchName);
    const sessionManager = new SessionManager(new TmuxBackendCore());
    const { workerInfo, postCreatePromise } = await sessionManager.createWorker({
      repoRoot,
      branchName,
      agentType,
      baseBranchOverride: getBaseBranchOverride(),
    });

    backend.attachSession(workerInfo.sessionName, workerInfo.workdir, undefined, 'worker');
    void postCreatePromise.catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(
        `Worker "${workerInfo.sessionName}" started, but agent initialization did not complete cleanly: ${message}`,
      );
    });

    const action = branchExisted ? 'Resumed' : 'Created';
    vscode.window.showInformationMessage(`${action} worker: ${workerInfo.sessionName}`);
    void vscode.commands.executeCommand('tmux.refresh');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create worker: ${message}`);
  }
}
