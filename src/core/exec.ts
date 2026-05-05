import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(execCallback);

export interface ExecOptions {
  cwd?: string;
}

// VS Code is a GUI app and doesn't inherit shell PATH.
// Add common binary locations (Homebrew, etc.) to PATH.
function getEnhancedPath(): string {
  const currentPath = process.env.PATH || '';
  const additionalPaths = [
    '/Applications/Codex.app/Contents/Resources',
    '/opt/homebrew/bin',      // Apple Silicon Homebrew
    '/usr/local/bin',         // Intel Mac Homebrew / common location
    '/opt/homebrew/sbin',
    '/usr/local/sbin',
  ];

  const pathSet = new Set(currentPath.split(':'));
  const newPaths = additionalPaths.filter(p => !pathSet.has(p));

  return newPaths.length > 0
    ? `${newPaths.join(':')}:${currentPath}`
    : currentPath;
}

export async function exec(command: string, options?: ExecOptions): Promise<string> {
  const { stdout } = await execPromise(command, {
    cwd: options?.cwd,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
    }
  });
  return stdout.trim();
}
