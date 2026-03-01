import * as vscode from 'vscode';
import { exec } from '../utils/exec';
import { attachSession } from '../utils/tmux';
import { createRepoSessionPrefixConfig, isWorkdirInRepo } from '../utils/sessionCompatibility';

const STARTUP_ATTACH_DELAY_MS = 500;
const ATTACH_STAGGER_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function autoAttachOnStartup(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  const repoRoot = workspaceFolders[0].uri.fsPath;
  const sessionPrefixConfig = createRepoSessionPrefixConfig(repoRoot);
  const repoPrefix = sessionPrefixConfig.primaryPrefix;

  interface SessionInfo {
    name: string;
    attached: boolean;
  }

  let sessions: SessionInfo[] = [];
  try {
    const output = await exec("tmux list-sessions -F '#{session_name}|||#{session_attached}'");
    sessions = output.split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        const [name, attachedStr] = line.split('|||');
        return {
          name,
          attached: attachedStr === '1'
        };
      });
  } catch { return; }

  if (sessions.length === 0) return;

  const matching: string[] = [];
  for (const session of sessions) {
    if (session.attached) {
        continue;
    }

    try {
      const output = await exec(`tmux show-options -t "${session.name}" @workdir`);
      const rawWorkdir = output.split(' ').slice(1).join(' ').trim();
      const workdir = rawWorkdir || undefined;
      const inRepo = isWorkdirInRepo(workdir, sessionPrefixConfig.canonicalRepoRoot);
      if (inRepo) {
        matching.push(session.name);
        continue;
      }

      if (session.name.startsWith(repoPrefix)) {
        matching.push(session.name);
        continue;
      }
    } catch {
      continue;
    }
  }

  if (matching.length === 0) return;

  // Give the workbench a moment to settle terminal/editor layout on startup.
  await sleep(STARTUP_ATTACH_DELAY_MS);

  for (const [index, sessionName] of matching.entries()) {
    if (index > 0) {
      await sleep(ATTACH_STAGGER_MS);
    }
    attachSession(sessionName);
  }
}
