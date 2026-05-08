import * as path from 'path';
import { execFile as execFileCallback } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { resolveCommandPath } from '../core/exec';

const execFile = promisify(execFileCallback);
const REVIEW_SCHEME = 'hydra-git';
const MAX_GIT_OUTPUT = 50 * 1024 * 1024;

interface ReviewChange {
  status: string;
  path: string;
  oldPath?: string;
}

interface SnapshotQuery {
  worktreePath: string;
  ref?: string;
  filePath?: string;
  empty?: boolean;
  current?: boolean;
}

let gitBinary: string | undefined;
let providerDisposable: vscode.Disposable | undefined;

async function getGitBinary(): Promise<string> {
  if (gitBinary) {
    return gitBinary;
  }

  const resolved = await resolveCommandPath('git');
  if (!resolved) {
    throw new Error('git not found');
  }
  gitBinary = resolved;
  return gitBinary;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile(await getGitBinary(), args, {
    cwd,
    maxBuffer: MAX_GIT_OUTPUT,
  });
  return stdout.toString();
}

async function tryGit(args: string[], cwd: string): Promise<string> {
  try {
    return await git(args, cwd);
  } catch {
    return '';
  }
}

function ensureReviewContentProvider(): void {
  if (providerDisposable) {
    return;
  }

  providerDisposable = vscode.workspace.registerTextDocumentContentProvider(REVIEW_SCHEME, {
    async provideTextDocumentContent(uri): Promise<string> {
      const query = parseSnapshotQuery(uri);
      if (!query || !query.filePath || query.empty) {
        return '';
      }

      if (query.current) {
        return tryReadFile(path.join(query.worktreePath, query.filePath));
      }

      if (!query.ref) {
        return '';
      }
      return tryGit(['show', `${query.ref}:${query.filePath}`], query.worktreePath);
    },
  });
}

function parseSnapshotQuery(uri: vscode.Uri): SnapshotQuery | undefined {
  try {
    const parsed = JSON.parse(uri.query) as Partial<SnapshotQuery>;
    if (typeof parsed.worktreePath !== 'string' || !parsed.worktreePath) {
      return undefined;
    }
    return {
      worktreePath: parsed.worktreePath,
      ref: typeof parsed.ref === 'string' ? parsed.ref : undefined,
      filePath: typeof parsed.filePath === 'string' ? parsed.filePath : undefined,
      empty: parsed.empty === true,
      current: parsed.current === true,
    };
  } catch {
    return undefined;
  }
}

async function tryReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function reviewUri(worktreePath: string, filePath: string, query: Omit<SnapshotQuery, 'worktreePath' | 'filePath'>): vscode.Uri {
  return vscode.Uri.from({
    scheme: REVIEW_SCHEME,
    path: `/${filePath}`,
    query: JSON.stringify({ worktreePath, filePath, ...query }),
  });
}

function snapshotUri(worktreePath: string, ref: string, filePath: string): vscode.Uri {
  return reviewUri(worktreePath, filePath, { ref });
}

function emptyUri(worktreePath: string, filePath: string): vscode.Uri {
  return reviewUri(worktreePath, filePath, { empty: true });
}

function currentUri(worktreePath: string, filePath: string): vscode.Uri {
  return reviewUri(worktreePath, filePath, { current: true });
}

function splitNul(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

function parseNameStatus(output: string): ReviewChange[] {
  const tokens = splitNul(output);
  const changes: ReviewChange[] = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) {
      continue;
    }

    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (oldPath && newPath) {
        changes.push({ status, oldPath, path: newPath });
      }
      continue;
    }

    const filePath = tokens[index++];
    if (filePath) {
      changes.push({ status, path: filePath });
    }
  }

  return changes;
}

async function getCurrentBranch(worktreePath: string): Promise<string> {
  return (await tryGit(['branch', '--show-current'], worktreePath)).trim();
}

async function getReviewBaseRef(worktreePath: string): Promise<string> {
  const branch = await getCurrentBranch(worktreePath);
  if (branch) {
    const configuredBase = (await tryGit(['config', '--get', `branch.${branch}.vscode-merge-base`], worktreePath)).trim();
    if (configuredBase && await refExists(worktreePath, configuredBase)) {
      return configuredBase;
    }
  }

  const candidates = ['origin/main', 'main', 'origin/master', 'master'];
  for (const candidate of candidates) {
    if (await refExists(worktreePath, candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to find a base branch for this worktree.');
}

async function refExists(worktreePath: string, ref: string): Promise<boolean> {
  return Boolean((await tryGit(['rev-parse', '--verify', `${ref}^{commit}`], worktreePath)).trim());
}

async function getMergeBase(worktreePath: string, baseRef: string): Promise<string> {
  const mergeBase = (await tryGit(['merge-base', baseRef, 'HEAD'], worktreePath)).trim();
  return mergeBase || baseRef;
}

async function getReviewChanges(worktreePath: string, baseCommit: string): Promise<ReviewChange[]> {
  const trackedChanges = parseNameStatus(
    await tryGit(['diff', '--name-status', '--find-renames', '-z', baseCommit, '--'], worktreePath)
  );
  const seen = new Set(trackedChanges.map(change => change.path));

  const untracked = splitNul(await tryGit(['ls-files', '--others', '--exclude-standard', '-z'], worktreePath));
  for (const filePath of untracked) {
    if (!seen.has(filePath)) {
      trackedChanges.push({ status: 'A', path: filePath });
      seen.add(filePath);
    }
  }

  return trackedChanges.sort((a, b) => a.path.localeCompare(b.path));
}

function getResourceUri(worktreePath: string, change: ReviewChange): vscode.Uri {
  return currentUri(worktreePath, change.path);
}

function getOriginalUri(worktreePath: string, baseCommit: string, change: ReviewChange): vscode.Uri {
  if (change.status.startsWith('A')) {
    return emptyUri(worktreePath, change.path);
  }
  return snapshotUri(worktreePath, baseCommit, change.oldPath || change.path);
}

function getModifiedUri(worktreePath: string, change: ReviewChange): vscode.Uri {
  if (change.status.startsWith('D')) {
    return emptyUri(worktreePath, change.path);
  }
  return currentUri(worktreePath, change.path);
}

function getDiffTitle(worktreePath: string, baseRef: string, changes: ReviewChange[]): string {
  const name = path.basename(worktreePath);
  return `${name}: ${changes.length} change${changes.length === 1 ? '' : 's'} since ${baseRef}`;
}

async function openFallbackDiff(
  worktreePath: string,
  baseCommit: string,
  baseRef: string,
  changes: ReviewChange[]
): Promise<void> {
  const first = changes[0];
  await vscode.commands.executeCommand(
    'vscode.diff',
    getOriginalUri(worktreePath, baseCommit, first),
    getModifiedUri(worktreePath, first),
    `${first.path} (${baseRef} ↔ worker)`,
    { preview: false }
  );

  if (changes.length > 1) {
    vscode.window.showInformationMessage(
      `Opened the first of ${changes.length} worker changes. Update VS Code to use the full changes editor.`
    );
  }
}

export async function openChangesReview(worktreePath: string): Promise<void> {
  ensureReviewContentProvider();

  const baseRef = await getReviewBaseRef(worktreePath);
  const baseCommit = await getMergeBase(worktreePath, baseRef);
  const changes = await getReviewChanges(worktreePath, baseCommit);

  if (changes.length === 0) {
    vscode.window.showInformationMessage('No worker changes to review.');
    return;
  }

  const resources = changes.map(change => [
    getResourceUri(worktreePath, change),
    getOriginalUri(worktreePath, baseCommit, change),
    getModifiedUri(worktreePath, change),
  ]);

  try {
    await vscode.commands.executeCommand('vscode.changes', getDiffTitle(worktreePath, baseRef, changes), resources);
  } catch {
    await openFallbackDiff(worktreePath, baseCommit, baseRef, changes);
  }
}
