import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HYDRA_DIR = path.join(os.homedir(), '.hydra');

const COPILOT_AGENTS_MD = fs.readFileSync(path.join(__dirname, '..', 'resources', 'COPILOT_AGENTS.md'), 'utf-8');
const WORKER_AGENTS_MD = fs.readFileSync(path.join(__dirname, '..', 'resources', 'WORKER_AGENTS.md'), 'utf-8');

/** Ensure ~/.hydra/ exists and write default instruction files if missing. */
export function ensureHydraGlobalConfig(): void {
  if (!fs.existsSync(HYDRA_DIR)) {
    fs.mkdirSync(HYDRA_DIR, { recursive: true });
  }

  const copilotPath = path.join(HYDRA_DIR, 'COPILOT_AGENTS.md');
  if (!fs.existsSync(copilotPath)) {
    fs.writeFileSync(copilotPath, COPILOT_AGENTS_MD, 'utf-8');
  }

  const workerPath = path.join(HYDRA_DIR, 'WORKER_AGENTS.md');
  if (!fs.existsSync(workerPath)) {
    fs.writeFileSync(workerPath, WORKER_AGENTS_MD, 'utf-8');
  }
}

/**
 * Inject worker instructions into the worktree's agent instruction file.
 * Wraps content in <hydra> tags; skips if already present.
 * Returns the target file path if injected, or undefined if skipped.
 */
export function injectWorkerInstructions(worktreePath: string, agentType: string, taskFilename?: string): string | undefined {
  const workerPath = path.join(HYDRA_DIR, 'WORKER_AGENTS.md');
  if (!fs.existsSync(workerPath)) { return undefined; }

  let targetFilename: string;
  switch (agentType) {
    case 'codex': targetFilename = 'AGENTS.md'; break;
    case 'gemini': targetFilename = 'GEMINI.md'; break;
    default: targetFilename = 'CLAUDE.md'; break;
  }
  const targetFile = path.join(worktreePath, targetFilename);

  // Duplicate check
  if (fs.existsSync(targetFile)) {
    const existing = fs.readFileSync(targetFile, 'utf-8');
    if (existing.includes('<hydra>')) { return undefined; }
  }

  let content = fs.readFileSync(workerPath, 'utf-8');
  
  // Replace placeholder
  const taskRef = taskFilename ? `in \`${taskFilename}\`` : "as your initial prompt";
  content = content.replace('{{TASK_REFERENCE}}', taskRef);

  const block = `\n<hydra>\n${content}</hydra>\n`;
  fs.appendFileSync(targetFile, block, 'utf-8');
  return targetFile;
}
