import * as path from 'path';
import * as os from 'os';

/**
 * Central source of truth for Hydra directory paths.
 *
 * Respects the HYDRA_HOME environment variable for overriding the default
 * ~/.hydra directory. This enables E2E tests (and other tooling) to run
 * in a fully isolated environment without touching user data.
 */
export function getHydraDir(): string {
  return process.env.HYDRA_HOME || path.join(os.homedir(), '.hydra');
}

export function getSessionsFile(): string {
  return path.join(getHydraDir(), 'sessions.json');
}

export function getArchiveFile(): string {
  return path.join(getHydraDir(), 'archive.json');
}

export function getManagedWorktreesRoot(): string {
  return path.join(getHydraDir(), 'worktrees');
}
