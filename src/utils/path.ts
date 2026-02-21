import * as os from 'os';
import * as path from 'path';

function expandHomeDir(targetPath: string): string {
  if (targetPath === '~') return os.homedir();
  if (targetPath.startsWith('~/') || targetPath.startsWith('~\\')) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return targetPath;
}

export function toCanonicalPath(targetPath?: string): string | undefined {
  if (!targetPath) return undefined;

  const expanded = expandHomeDir(targetPath.trim());
  return path.normalize(path.resolve(expanded));
}
