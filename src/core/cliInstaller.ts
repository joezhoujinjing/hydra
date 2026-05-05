import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getHydraDir } from './paths';

function getCliPaths() {
  const hydraDir = getHydraDir();
  return {
    hydraDir,
    binDir: path.join(hydraDir, 'bin'),
    wrapperPath: path.join(hydraDir, 'bin', 'hydra'),
    extPathFile: path.join(hydraDir, 'ext-path'),
    versionFile: path.join(hydraDir, 'cli-version'),
  };
}

const WRAPPER_SCRIPT = `#!/bin/sh
EXT_PATH=$(cat "$HOME/.hydra/ext-path" 2>/dev/null)
if [ -z "$EXT_PATH" ] || [ ! -f "$EXT_PATH/out/cli/index.js" ]; then
  echo "Error: Hydra VS Code extension not found. Open VS Code with Hydra installed." >&2
  exit 1
fi
exec node "$EXT_PATH/out/cli/index.js" "$@"
`;

export function installCli(extensionPath: string, version: string): { installed: boolean; updated: boolean } {
  const { binDir, wrapperPath, extPathFile, versionFile } = getCliPaths();

  // Create ~/.hydra/bin/ directory
  fs.mkdirSync(binDir, { recursive: true });

  // Always write ext-path to handle extension updates
  fs.writeFileSync(extPathFile, extensionPath, 'utf-8');

  // Write wrapper script
  fs.writeFileSync(wrapperPath, WRAPPER_SCRIPT, { encoding: 'utf-8', mode: 0o755 });

  // Determine install vs update by comparing cli-version
  let previousVersion: string | undefined;
  try {
    previousVersion = fs.readFileSync(versionFile, 'utf-8').trim();
  } catch {
    // File doesn't exist — fresh install
  }

  fs.writeFileSync(versionFile, version, 'utf-8');

  if (!previousVersion) {
    return { installed: true, updated: false };
  }
  if (previousVersion !== version) {
    return { installed: false, updated: true };
  }
  // Same version, no change
  return { installed: false, updated: false };
}

export function ensurePathInShellProfile(): void {
  const snippet = 'export PATH="$HOME/.hydra/bin:$PATH"';
  const marker = '.hydra/bin';
  const candidates = [
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bashrc'),
  ];
  for (const rc of candidates) {
    if (!fs.existsSync(rc)) continue;
    const content = fs.readFileSync(rc, 'utf-8');
    if (content.includes(marker)) return;
    fs.appendFileSync(rc, `\n# Hydra CLI\n${snippet}\n`);
    return;
  }
  // No rc file found — create ~/.zshrc (macOS default)
  fs.writeFileSync(candidates[0], `# Hydra CLI\n${snippet}\n`, 'utf-8');
}

export function isCliOnPath(): boolean {
  const { binDir } = getCliPaths();
  const envPath = process.env.PATH || '';
  return envPath.split(path.delimiter).some(p => {
    try {
      return fs.realpathSync(p) === fs.realpathSync(binDir);
    } catch {
      return p === binDir || p === '$HOME/.hydra/bin' || p.endsWith('/.hydra/bin');
    }
  });
}

export function getShellConfigSnippet(): string {
  return 'export PATH="$HOME/.hydra/bin:$PATH"';
}
