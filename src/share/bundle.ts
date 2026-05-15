import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveAgentSessionFile } from '../core/path';
import type { CopilotInfo, WorkerInfo } from '../core/sessionManager';
import { exportClaudeNativeSession } from './claudeAdapter';
import { exportCodexNativeSession } from './codexAdapter';
import { collectRepoInfo } from './repo';
import type { HydraShareBundle, ShareAgent, ShareHydraSessionInfo } from './types';

export type ShareableSession =
  | { type: 'copilot'; data: CopilotInfo }
  | { type: 'worker'; data: WorkerInfo };

export function generateShareId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function isShareAgent(agent: string): agent is ShareAgent {
  return agent === 'codex' || agent === 'claude';
}

function assertShareableSession(session: ShareableSession): { agent: ShareAgent; sessionId: string } {
  if (!isShareAgent(session.data.agent)) {
    throw new Error(`Only Codex and Claude sessions can be shared natively. Session agent is "${session.data.agent}".`);
  }
  if (!session.data.sessionId) {
    throw new Error(`Session "${session.data.sessionName}" does not have a captured ${session.data.agent} session ID yet.`);
  }
  const sessionFile = resolveAgentSessionFile(session.data.agent, session.data.workdir, session.data.sessionId);
  if (!sessionFile) {
    throw new Error(`${session.data.agent} session file not found for session "${session.data.sessionName}".`);
  }
  return { agent: session.data.agent, sessionId: session.data.sessionId };
}

function buildHydraSessionInfo(session: ShareableSession, agent: ShareAgent, sessionId: string): ShareHydraSessionInfo {
  if (session.type === 'copilot') {
    return {
      type: 'copilot',
      sessionName: session.data.sessionName,
      displayName: session.data.displayName || session.data.sessionName,
      agent,
      workdir: session.data.workdir,
      agentSessionId: sessionId,
    };
  }

  return {
    type: 'worker',
    sessionName: session.data.sessionName,
    displayName: session.data.displayName || session.data.slug || session.data.sessionName,
    agent,
    workdir: session.data.workdir,
    agentSessionId: sessionId,
    worker: {
      workerId: session.data.workerId,
      repo: session.data.repo,
      repoRoot: session.data.repoRoot,
      branch: session.data.branch,
      slug: session.data.slug,
      copilotSessionName: session.data.copilotSessionName,
    },
  };
}

export async function createShareBundle(
  session: ShareableSession,
  shareId = generateShareId(),
): Promise<HydraShareBundle> {
  const { agent, sessionId } = assertShareableSession(session);
  const repo = await collectRepoInfo(session.data.workdir);
  const agents = agent === 'codex'
    ? { codex: exportCodexNativeSession(session.data.workdir, sessionId) }
    : { claude: exportClaudeNativeSession(session.data.workdir, sessionId) };

  return {
    schemaVersion: 1,
    shareId,
    createdAt: new Date().toISOString(),
    encryption: {
      enabled: false,
      algorithm: null,
      keyHint: null,
    },
    repo,
    hydraSession: buildHydraSessionInfo(session, agent, sessionId),
    agents,
  };
}

export function writeBundle(filePath: string, bundle: HydraShareBundle): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf-8');
}

export function readBundle(filePath: string): HydraShareBundle {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HydraShareBundle;
  validateBundle(parsed);
  return parsed;
}

export function validateBundle(bundle: HydraShareBundle): void {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Invalid share bundle');
  }
  if (bundle.schemaVersion !== 1) {
    throw new Error(`Unsupported share bundle schema version: ${bundle.schemaVersion}`);
  }
  if (bundle.encryption?.enabled) {
    throw new Error('Encrypted share bundles are not supported by this Hydra version yet.');
  }
  if (!bundle.shareId) {
    throw new Error('Share bundle is missing shareId');
  }
  const agent = bundle.hydraSession?.agent;
  if (!agent || !isShareAgent(agent)) {
    throw new Error(`Unsupported share bundle agent: ${agent || 'missing'}`);
  }
  if (!bundle.hydraSession?.agentSessionId) {
    throw new Error('Share bundle is missing agentSessionId');
  }
  const payload = bundle.agents?.[agent];
  if (!payload || payload.adapter !== agent) {
    throw new Error(`Share bundle is missing ${agent} native session payload`);
  }
}
