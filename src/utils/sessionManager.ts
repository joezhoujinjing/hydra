import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CopilotEntry {
  status: 'running' | 'stopped';
  agent: string;
  workdir: string;
  tmuxSession: string;
  lastSeenAt: string;
}

export interface WorkerEntry {
  repo: string;
  branch: string;
  slug: string;
  status: 'running' | 'stopped';
  agent: string;
  workdir: string;
  tmuxSession: string;
  lastSeenAt: string;
}

export interface SessionsData {
  copilots: Record<string, CopilotEntry>;
  workers: Record<string, WorkerEntry>;
  updatedAt: string;
}

const SESSIONS_DIR = path.join(os.homedir(), '.hydra');
const SESSIONS_FILE = path.join(SESSIONS_DIR, 'sessions.json');

function emptyData(): SessionsData {
  return { copilots: {}, workers: {}, updatedAt: new Date().toISOString() };
}

export function readSessions(): SessionsData {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      return emptyData();
    }
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    const data = JSON.parse(raw) as SessionsData;
    return {
      copilots: data.copilots || {},
      workers: data.workers || {},
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  } catch {
    return emptyData();
  }
}

export function writeSessions(data: SessionsData): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  data.updatedAt = new Date().toISOString();
  const tmpFile = SESSIONS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpFile, SESSIONS_FILE);
}

export function addCopilot(sessionName: string, data: Omit<CopilotEntry, 'lastSeenAt'>): void {
  const sessions = readSessions();
  sessions.copilots[sessionName] = {
    ...data,
    lastSeenAt: new Date().toISOString(),
  };
  writeSessions(sessions);
}

export function removeCopilot(sessionName: string): void {
  const sessions = readSessions();
  delete sessions.copilots[sessionName];
  writeSessions(sessions);
}

export function addWorker(sessionName: string, data: Omit<WorkerEntry, 'lastSeenAt'>): void {
  const sessions = readSessions();
  sessions.workers[sessionName] = {
    ...data,
    lastSeenAt: new Date().toISOString(),
  };
  writeSessions(sessions);
}

export function removeWorker(sessionName: string): void {
  const sessions = readSessions();
  delete sessions.workers[sessionName];
  writeSessions(sessions);
}

export function updateStatus(sessionName: string, status: 'running' | 'stopped'): void {
  const sessions = readSessions();
  if (sessions.copilots[sessionName]) {
    sessions.copilots[sessionName].status = status;
    sessions.copilots[sessionName].lastSeenAt = new Date().toISOString();
  } else if (sessions.workers[sessionName]) {
    sessions.workers[sessionName].status = status;
    sessions.workers[sessionName].lastSeenAt = new Date().toISOString();
  }
  writeSessions(sessions);
}

export function listAll(): { copilots: Record<string, CopilotEntry>; workers: Record<string, WorkerEntry> } {
  const sessions = readSessions();
  return { copilots: sessions.copilots, workers: sessions.workers };
}
