import * as vscode from 'vscode';
import { exec } from '../utils/exec';
import {
  TmuxItem,
  TmuxSessionItem,
  InactiveWorktreeItem,
  WorktreeItem,
  TmuxDetailItem,
  InactiveDetailItem,
  GitStatusItem
} from '../providers/tmuxSessionProvider';
import { attachSession, createSession, getSessionWorkdir, isTmuxInstalled, setSessionWorkdir } from '../utils/tmux';

function getWorktreePath(item: TmuxItem): string | undefined {
  if (item instanceof TmuxSessionItem) return item.session.worktreePath;
  if (item instanceof InactiveWorktreeItem) return item.worktree.path;
  if (item instanceof TmuxDetailItem) return item.session?.worktreePath;
  if (item instanceof InactiveDetailItem) return item.worktree?.path;
  if (item instanceof WorktreeItem) return item.worktreePath;
  if (item instanceof GitStatusItem) return item.worktreePath;
  return undefined;
}

async function ensureSessionExists(sessionName: string, worktreePath?: string): Promise<void> {
  try {
    await exec(`tmux has-session -t "${sessionName}"`);
    return;
  } catch {
    // Session doesn't exist (or tmux server isn't running yet).
    void 0;
  }

  if (!worktreePath) {
    throw new Error('Worktree path not found (cannot create session).');
  }

  await createSession(sessionName, worktreePath);
  await setSessionWorkdir(sessionName, worktreePath);
}

export async function attach(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  if (!await isTmuxInstalled()) {
    vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
    return;
  }

  try {
    const worktreePath = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, worktreePath);

    const workdir = worktreePath || await getSessionWorkdir(item.sessionName);
    attachSession(item.sessionName, workdir, vscode.TerminalLocation.Panel);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to attach: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function attachInEditor(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  if (!await isTmuxInstalled()) {
    vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
    return;
  }

  try {
    const worktreePath = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, worktreePath);

    const workdir = worktreePath || await getSessionWorkdir(item.sessionName);
    attachSession(item.sessionName, workdir, vscode.TerminalLocation.Editor);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to attach: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function openWorktree(item: TmuxItem): Promise<void> {
  const worktreePath = getWorktreePath(item);
  if (!worktreePath) {
    vscode.window.showErrorMessage('Worktree path not found');
    return;
  }
  const worktreeUri = vscode.Uri.file(worktreePath);
  await vscode.commands.executeCommand('vscode.openFolder', worktreeUri, true);
}

export async function copyPath(item: TmuxItem): Promise<void> {
  const worktreePath = getWorktreePath(item);
  if (!worktreePath) {
    vscode.window.showErrorMessage('Worktree path not found');
    return;
  }
  await vscode.env.clipboard.writeText(worktreePath);
  vscode.window.showInformationMessage(`Copied: ${worktreePath}`);
}

export async function newPane(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  try {
    if (!await isTmuxInstalled()) {
      vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
      return;
    }

    const cwd = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, cwd);
    const cwdArg = cwd ? `-c "${cwd}"` : '';
    await exec(`tmux split-window -t "${item.sessionName}" ${cwdArg}`);
    vscode.window.showInformationMessage(`New pane created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create pane: ${err}`);
  }
}

export async function newWindow(item: TmuxItem): Promise<void> {
  if (!item.sessionName) {
    vscode.window.showErrorMessage('No session selected');
    return;
  }
  try {
    if (!await isTmuxInstalled()) {
      vscode.window.showErrorMessage('tmux not found. Install: `brew install tmux`');
      return;
    }

    const cwd = getWorktreePath(item);
    await ensureSessionExists(item.sessionName, cwd);
    const cwdArg = cwd ? `-c "${cwd}"` : '';
    await exec(`tmux new-window -t "${item.sessionName}" ${cwdArg}`);
    vscode.window.showInformationMessage(`New window created in ${item.sessionName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create window: ${err}`);
  }
}
