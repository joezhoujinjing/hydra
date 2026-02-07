import * as vscode from "vscode";
import * as fs from "fs";
import { exec } from "../utils/exec";
import { killSession, sanitizeSessionName } from "../utils/tmux";
import { getRepoRoot } from "../utils/git";
import {
  TmuxItem,
  TmuxSessionItem,
  InactiveWorktreeItem,
  WorktreeItem,
  TmuxDetailItem,
  InactiveDetailItem,
  GitStatusItem,
} from "../providers/tmuxSessionProvider";
import * as path from "path";

async function isWorktreePathManagedByRepo(
  repoRoot: string,
  worktreePath: string,
): Promise<boolean> {
  try {
    const output = await exec(`git -C "${repoRoot}" worktree list --porcelain`);
    const worktreePaths = output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.substring("worktree ".length).trim())
      .filter((p) => p.length > 0);

    const candidate = path.resolve(fs.realpathSync(worktreePath));
    for (const wtPath of worktreePaths) {
      try {
        const resolved = path.resolve(fs.realpathSync(wtPath));
        if (resolved === candidate) return true;
      } catch {
        if (path.resolve(wtPath) === candidate) return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function getSlugFromSessionName(
  sessionName: string,
  repoName?: string,
): string | undefined {
  if (!repoName) return undefined;
  const prefix = `${sanitizeSessionName(repoName)}_`;
  if (!sessionName.startsWith(prefix)) return undefined;
  const slug = sessionName.substring(prefix.length);
  return slug || undefined;
}

function isMainWorktreeItem(item: TmuxItem): boolean {
  if (item instanceof WorktreeItem) return item.isMainWorktree;
  if (item instanceof TmuxDetailItem && item.worktree) return item.worktree.isMain;
  if (item instanceof InactiveDetailItem && item.worktree) return item.worktree.isMain;
  if (item instanceof GitStatusItem) {
    return false;
  }
  return false;
}

export async function removeTask(item: TmuxItem): Promise<void> {
  if (!item || !item.sessionName) {
    vscode.window.showErrorMessage("No session selected");
    return;
  }

  const sessionName = item.sessionName;
  const isMain = isMainWorktreeItem(item);

  let worktreePath: string | undefined;
  let slug: string | undefined;

  if (item instanceof TmuxSessionItem) {
    worktreePath = item.session.worktreePath;
    slug = item.session.slug;
  } else if (item instanceof TmuxDetailItem && item.session) {
    worktreePath = item.session.worktreePath;
    slug = item.session.slug;
  } else if (item instanceof InactiveWorktreeItem) {
    worktreePath = item.worktree.path;
  } else if (item instanceof InactiveDetailItem && item.worktree) {
    worktreePath = item.worktree.path;
  } else if (item instanceof WorktreeItem) {
    worktreePath = item.worktreePath;
  } else if (item instanceof GitStatusItem) {
    worktreePath = item.worktreePath;
  }

  slug = slug || getSlugFromSessionName(sessionName, item.repoName);
  slug = slug || String(item.label);

  // ── Main worktree: tmux 세션만 종료, 워크트리/브랜치 삭제 불가 ──
  if (isMain) {
    const confirm = await vscode.window.showWarningMessage(
      `Kill tmux session "${sessionName}"?\n(Primary worktree cannot be removed)`,
      { modal: true },
      "Kill Session",
    );
    if (confirm !== "Kill Session") return;

    try {
      await killSession(sessionName);
      vscode.window.showInformationMessage(`Killed session: ${sessionName}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to kill session: ${err}`);
    }
    vscode.commands.executeCommand("tmux.refresh");
    return;
  }

  // ── 일반 워크트리: 세션 + 워크트리 + 브랜치 모두 삭제 가능 ──

  if (worktreePath) {
    try {
      const repoRoot = getRepoRoot();
      const managed = await isWorktreePathManagedByRepo(repoRoot, worktreePath);
      if (!managed) {
        vscode.window.showErrorMessage(
          "Cannot delete: selected path is not a worktree of the current repo.",
        );
        return;
      }
    } catch {
      void 0;
    }
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete tmux session "${sessionName}" and its worktree directory? This cannot be undone.`,
    { modal: true },
    "Delete Session & Worktree",
  );
  if (confirm !== "Delete Session & Worktree") return;

  try {
    await killSession(sessionName);
  } catch {
    void 0;
  }

  if (worktreePath && fs.existsSync(worktreePath)) {
    try {
      const repoRoot = getRepoRoot();
      await exec(`git worktree remove "${worktreePath}"`, { cwd: repoRoot });
    } catch {
      const forceConfirm = await vscode.window.showWarningMessage(
        "Worktree has uncommitted changes. Force remove?",
        "Force Remove",
        "Cancel",
      );
      if (forceConfirm === "Force Remove") {
        try {
          const repoRoot = getRepoRoot();
          await exec(`git worktree remove "${worktreePath}" --force`, {
            cwd: repoRoot,
          });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to remove worktree: ${err}`);
          return;
        }
      } else {
        return;
      }
    }
  }

  const branchName = slug ? `task/${slug}` : undefined;
  try {
    const repoRoot = getRepoRoot();
    if (!branchName) throw new Error("No slug");
    await exec(`git rev-parse --verify "${branchName}"`, { cwd: repoRoot });

    const deleteBranch = await vscode.window.showWarningMessage(
      `Also delete local branch "${branchName}"?`,
      "Delete Branch",
      "Keep Branch",
    );
    if (deleteBranch === "Delete Branch") {
      await exec(`git branch -d "${branchName}"`, { cwd: repoRoot });
    }
  } catch {
    void 0;
  }

  vscode.window.showInformationMessage(`Removed: ${slug || sessionName}`);
  vscode.commands.executeCommand("tmux.refresh");
}
