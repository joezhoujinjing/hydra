import * as vscode from 'vscode';
import {
  addWorktree,
  branchNameToSlug,
  getBaseBranch,
  getRepoRoot,
  getRepoSessionNamespace,
  isGitRepo,
  findGitReposInDir,
  isSlugTaken,
  localBranchExists,
  validateBranchName
} from '../utils/git';
import { getActiveBackend } from '../utils/multiplexer';
import { pickAgentType, getAgentCommand } from '../utils/agentConfig';

async function resolveRepoRoot(): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return undefined;
  }

  // Try normal getRepoRoot first
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot();
  } catch {
    repoRoot = workspaceFolders[0].uri.fsPath;
  }

  // If repoRoot is a git repo, use it directly
  if (await isGitRepo(repoRoot)) {
    return repoRoot;
  }

  // Not a git repo — scan subdirectories for git repos
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

  const repoSessionNamespace = getRepoSessionNamespace(repoRoot);

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
    if (await localBranchExists(repoRoot, branchName)) {
      throw new Error(`Branch "${branchName}" already exists.`);
    }

    // 3. Base branch
    const baseBranch = await getBaseBranch(repoRoot);

    // 4. Slug collision resolution
    const slug = branchNameToSlug(branchName);
    let finalSlug = slug;
    let suffix = 1;
    while (await isSlugTaken(finalSlug, repoSessionNamespace, repoRoot)) {
      suffix++;
      finalSlug = `${slug}-${suffix}`;
    }

    // 5. Create worktree
    const worktreePath = await addWorktree(repoRoot, branchName, finalSlug, baseBranch);

    // 6. Create session
    const sessionName = backend.buildSessionName(repoSessionNamespace, finalSlug);
    await backend.createSession(sessionName, worktreePath);
    await backend.setSessionWorkdir(sessionName, worktreePath);
    await backend.setSessionRole(sessionName, 'worker');
    await backend.setSessionAgent(sessionName, agentType);

    // 7. Launch agent
    const agentCommand = getAgentCommand(agentType);
    await backend.sendKeys(sessionName, agentCommand);

    // 8. Attach
    backend.attachSession(sessionName, worktreePath);

    vscode.window.showInformationMessage(`Worker created: ${branchName} (${agentType})`);
    vscode.commands.executeCommand('tmux.refresh');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create worker: ${message}`);
  }
}
