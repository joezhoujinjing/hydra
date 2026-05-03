import * as vscode from 'vscode';
import {
  addWorktree,
  branchNameToSlug,
  getBaseBranch,
  getRepoRoot,
  getRepoSessionNamespace,
  isSlugTaken,
  localBranchExists,
  validateBranchName
} from '../utils/git';
import { getActiveBackend } from '../utils/multiplexer';

export async function newTask(): Promise<void> {
  const backend = getActiveBackend();
  if (!await backend.isInstalled()) {
    vscode.window.showErrorMessage(`${backend.displayName} not found. ${backend.installHint}`);
    return;
  }

  let repoRoot: string;
  let repoSessionNamespace: string;
  try {
    repoRoot = getRepoRoot();
    repoSessionNamespace = getRepoSessionNamespace(repoRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create task: ${message}`);
    return;
  }

  // 1. Get branch name input
  const branchInput = await vscode.window.showInputBox({
    prompt: 'Enter branch name (e.g., "feat/auth", "task/my-task")',
    placeHolder: 'feat/my-task',
    validateInput: (value) => {
      return validateBranchName(value);
    }
  });

  if (!branchInput) return; // cancelled

  // 2. Normalize branch name
  const branchName = branchInput.trim();
  const branchValidationError = validateBranchName(branchName);
  if (branchValidationError) {
    vscode.window.showErrorMessage(branchValidationError);
    return;
  }

  try {
    if (await localBranchExists(repoRoot, branchName)) {
      throw new Error(`Branch "${branchName}" already exists.`);
    }

    // 3. Determine base branch
    const baseBranch = await getBaseBranch(repoRoot);

    // 4. Resolve session/worktree slug collisions
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

    // 7. attach
    backend.attachSession(sessionName, worktreePath, undefined, 'worker');

    // 8. Success message
    vscode.window.showInformationMessage(`Created task: ${branchName}`);

    // 9. Refresh tree view
    vscode.commands.executeCommand('tmux.refresh');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to create task: ${message}`);
  }
}
