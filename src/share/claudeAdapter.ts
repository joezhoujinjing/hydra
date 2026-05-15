import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encodeClaudeWorkdir, resolveAgentSessionFile } from '../core/path';
import type { ClaudeNativeSessionPayload, NativeSessionFile } from './types';

export interface ImportClaudeSessionOptions {
  force?: boolean;
}

export interface ImportClaudeSessionResult {
  written: string[];
  skipped: string[];
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function toHomeRelativePath(filePath: string): string {
  const home = path.resolve(os.homedir());
  const absoluteFilePath = path.resolve(filePath);
  const relative = path.relative(home, absoluteFilePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Claude session file is outside the current home directory: ${filePath}`);
  }
  return relative;
}

function readNativeSessionFile(filePath: string): NativeSessionFile {
  const contents = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return {
    homeRelativePath: toHomeRelativePath(filePath),
    mode: stat.mode & 0o777,
    size: contents.length,
    sha256: sha256(contents),
    contentBase64: contents.toString('base64'),
  };
}

function resolveClaudeTargetSessionFile(workdir: string, sessionId: string): string {
  const encoded = encodeClaudeWorkdir(path.resolve(workdir));
  return path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}

export function exportClaudeNativeSession(
  workdir: string,
  sessionId: string,
): ClaudeNativeSessionPayload {
  const sessionFile = resolveAgentSessionFile('claude', workdir, sessionId);
  if (!sessionFile) {
    throw new Error(`Claude session file not found for session ID "${sessionId}"`);
  }

  return {
    adapter: 'claude',
    adapterVersion: 1,
    sessionId,
    sourceWorkdir: workdir,
    files: [readNativeSessionFile(sessionFile)],
  };
}

export function importClaudeNativeSession(
  payload: ClaudeNativeSessionPayload,
  targetWorkdir: string,
  options: ImportClaudeSessionOptions = {},
): ImportClaudeSessionResult {
  if (payload.adapter !== 'claude') {
    throw new Error(`Unsupported native session adapter: ${payload.adapter}`);
  }
  if (payload.adapterVersion !== 1) {
    throw new Error(`Unsupported Claude adapter version: ${payload.adapterVersion}`);
  }
  if (!payload.sessionId) {
    throw new Error('Claude native session payload is missing sessionId');
  }
  if (payload.files.length !== 1) {
    throw new Error(`Claude native session payload must contain exactly one file, got ${payload.files.length}`);
  }

  const file = payload.files[0]!;
  const contents = Buffer.from(file.contentBase64, 'base64');
  const actualHash = sha256(contents);
  if (actualHash !== file.sha256) {
    throw new Error(`Hash mismatch for native session file: ${file.homeRelativePath}`);
  }
  if (contents.length !== file.size) {
    throw new Error(`Size mismatch for native session file: ${file.homeRelativePath}`);
  }

  const targetPath = resolveClaudeTargetSessionFile(targetWorkdir, payload.sessionId);
  if (fs.existsSync(targetPath)) {
    const existingHash = sha256(fs.readFileSync(targetPath));
    if (existingHash === file.sha256) {
      return { written: [], skipped: [targetPath] };
    }
    if (!options.force) {
      throw new Error(
        `Claude session file already exists with different contents: ${targetPath}. Use --force to overwrite it.`,
      );
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents, { mode: file.mode || 0o600 });
  try {
    fs.chmodSync(targetPath, file.mode || 0o600);
  } catch {
    // Best-effort: some filesystems ignore chmod.
  }
  return { written: [targetPath], skipped: [] };
}
