import * as vscode from 'vscode';
import {
  getRepoRoot,
  isGitRepo,
  findGitReposInDir,
  validateBranchName
} from '../utils/git';
import { getActiveBackend } from '../utils/multiplexer';
import { pickAgentType, getAgentCommand } from '../utils/agentConfig';
import { SessionManager } from '../core/sessionManager';

async function resolveRepoRoot(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return undefined;
  }

  let repoRoot: string;
  try {
    repoRoot = getRepoRoot();
  } catch {
    repoRoot = workspaceFolders[0].uri.fsPath;
  }

  if (await isGitRepo(repoRoot)) {
    return repoRoot;
  }

  const repos = await findGitReposInDir(repoRoot);
  if (repos.length === 0) {
    vscode.window.showErrorMessage('No git repositories found in workspace.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    repos.map(r => ({ label: r.name, description: r.path, value: r.path })),
    { placeHolder: 'Select a repository for the worker' }
  );

  return picked?.value;
}

export async function createWorker(): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  const repoRoot = await resolveRepoRoot();
  if (!repoRoot) return;

  // 1. Branch name input
  const branchInput = await vscode.window.showInputBox({
    prompt: 'Enter branch name (e.g., "feat/auth", "task/my-task")',
    placeHolder: 'feat/my-task',
    validateInput: (value) => validateBranchName(value)
  });

  if (!branchInput) return;

  const branchName = branchInput.trim();
  const branchValidationError = validateBranchName(branchName);
  if (branchValidationError) {
    vscode.window.showErrorMessage(branchValidationError);
    return;
  }

  // 2. Pick agent type
  const agentType = await pickAgentType();
  if (!agentType) return;

  try {
    const sm = new SessionManager(backend);
    const { workerInfo } = await sm.createWorker({
      repoRoot,
      branchName,
      agentType,
      baseBranchOverride: vscode.workspace.getConfiguration('hydra').get<string>('baseBranch')
        || vscode.workspace.getConfiguration('tmuxWorktree').get<string>('baseBranch') || undefined,
      agentCommand: getAgentCommand(agentType),
    });

    // Attach (vscode-specific) — no need to await postCreatePromise, extension is long-running
    backend.attachSession(workerInfo.sessionName, workerInfo.workdir, undefined, 'worker');

    vscode.window.showInformationMessage(`Worker created: ${branchName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create worker: ${message}`);
  }
}
