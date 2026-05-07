import * as vscode from 'vscode';
import { getRepoRoot } from '../utils/git';
import { getActiveBackend } from '../utils/multiplexer';
import { InactiveWorktreeItem, InactiveDetailItem, TmuxItem, TmuxSessionItem } from '../providers/tmuxSessionProvider';
import { createRepoSessionPrefixConfig, isWorkdirInRepo } from '../utils/sessionCompatibility';
import { SessionManager } from '../core/sessionManager';
import { TmuxBackendCore } from '../core/tmux';
import { ensureBackendInstalled } from './ensureBackendInstalled';

/**
 * Open a VS Code terminal that runs `ssh -t <host> tmux attach -t <session>`
 * for a remote worker. Hydra speaks plain ssh — the alias must already work
 * (`~/.ssh/config` / `gcloud compute config-ssh`). If the host is unreachable
 * the terminal will simply show the ssh stderr and exit.
 *
 * Windows: the published Hydra extension targets darwin/linux for now; on
 * win32 we fall back to PowerShell which can also exec `ssh ...` directly,
 * so the same shape works.
 */
function attachRemoteSession(host: string, sessionName: string): vscode.Terminal {
  // Single-quote the session name for the remote shell. Host is never quoted —
  // ssh treats it as an opaque alias and accepts at most user@host syntax,
  // neither of which contains shell metacharacters in practice.
  const escSession = sessionName.replace(/'/g, "'\\''");
  const remoteCmd = `tmux attach -t '${escSession}'`;
  const sshArgs = [
    '-t',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3',
    host,
    remoteCmd,
  ];

  const terminal = vscode.window.createTerminal({
    name: `[hydra] remote ${sessionName}`,
    shellPath: 'ssh',
    shellArgs: sshArgs,
    iconPath: new vscode.ThemeIcon('cloud'),
    location: { viewColumn: vscode.ViewColumn.Active },
    // Scrub VS Code shell-integration env vars so they don't leak into the
    // ssh process (ssh itself ignores them, but `SendEnv` / `LANG` interplay
    // can confuse some sshd configs). Matches the hygiene we already do on
    // the local tmux attach path in src/utils/tmuxBackend.ts.
    env: {
      'TERM': 'xterm-256color',
      'TERM_PROGRAM': null,
      'TERM_PROGRAM_VERSION': null,
      'VSCODE_SHELL_INTEGRATION': null,
      'VSCODE_INJECTION': null,
    },
  });
  terminal.show();
  return terminal;
}

async function findSessionsForWorkspace(repoRoot: string): Promise<string[]> {
  const backend = getActiveBackend();
  const sessions = await backend.listSessions();
  const matchingSessions: string[] = [];
  const sessionPrefixConfig = createRepoSessionPrefixConfig(repoRoot);
  const repoPrefix = sessionPrefixConfig.primaryPrefix;

  for (const session of sessions) {
    const workdir = session.workdir || await backend.getSessionWorkdir(session.name);
    const inRepo = isWorkdirInRepo(workdir, sessionPrefixConfig.canonicalRepoRoot);
    if (inRepo) {
      matchingSessions.push(session.name);
      continue;
    }

    if (session.name.startsWith(repoPrefix)) {
      matchingSessions.push(session.name);
      continue;
    }
  }

  return matchingSessions;
}

async function handleTreeViewItem(item: TmuxItem): Promise<void> {
    // Remote workers route through ssh — local tmux doesn't have the session
    // and never will. Dispatch BEFORE the local-listSessions probe so we don't
    // spuriously hit the "session not found, try to start" fallback below.
    if (item instanceof TmuxSessionItem && item.remote && item.sessionName) {
        attachRemoteSession(item.remote.host, item.sessionName);
        return;
    }

    const backend = getActiveBackend();
    const sessionName = item.sessionName || item.label;

    const sessions = await backend.listSessions();
    const exists = sessions.some(s => s.name === sessionName);

    if (exists) {
        const workdir = await backend.getSessionWorkdir(sessionName);
        const role = await backend.getSessionRole(sessionName);
        backend.attachSession(sessionName, workdir, undefined, role);
        return;
    }

    // Inactive worktree: resume the agent via SessionManager
    if (item instanceof InactiveWorktreeItem || item instanceof InactiveDetailItem) {
        const worktreePath = item instanceof InactiveWorktreeItem
            ? item.worktree.path
            : item.worktree!.path;

        try {
            const sm = new SessionManager(new TmuxBackendCore());
            const result = await sm.startWorker(sessionName);
            result.postCreatePromise.catch(() => {});
        } catch {
            // Fallback for worktrees without sessions.json entries (legacy)
            await backend.createSession(sessionName, worktreePath);
            await backend.setSessionWorkdir(sessionName, worktreePath);
            await backend.setSessionRole(sessionName, 'worker');
        }

        backend.attachSession(sessionName, worktreePath, undefined, 'worker');
        vscode.window.showInformationMessage(`Launched session: ${sessionName}`);
        vscode.commands.executeCommand('tmux.refresh');
        return;
    }

    vscode.window.showErrorMessage(`Session '${sessionName}' not found and cannot be created automatically.`);
}

async function handleCommandExecution(): Promise<void> {
    const backend = getActiveBackend();
    const repoRoot = getRepoRoot();
    const matchingSessions = await findSessionsForWorkspace(repoRoot);

    if (matchingSessions.length > 0) {
        for (const session of matchingSessions) {
            const workdir = await backend.getSessionWorkdir(session);
            const role = await backend.getSessionRole(session);
            backend.attachSession(session, workdir, undefined, role);
        }
        vscode.window.showInformationMessage(`Attached to ${matchingSessions.length} session(s)`);
    } else {
        vscode.window.showInformationMessage(
            `No existing ${backend.displayName} session found for this workspace. Ask your copilot to create a worker.`
        );
    }
}

export async function attachCreate(item?: TmuxItem | string): Promise<void> {
  const backend = getActiveBackend();
  if (!await ensureBackendInstalled(backend)) {
    return;
  }

  try {
    if (item instanceof TmuxItem) {
        await handleTreeViewItem(item);
    } else {
        await handleCommandExecution();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to attach/create: ${message}`);
  }
}
