import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HYDRA_DIR = path.join(os.homedir(), '.hydra');
const BIN_DIR = path.join(HYDRA_DIR, 'bin');
const WRAPPER_PATH = path.join(BIN_DIR, 'hydra');
const EXT_PATH_FILE = path.join(HYDRA_DIR, 'ext-path');
const VERSION_FILE = path.join(HYDRA_DIR, 'cli-version');

const WRAPPER_SCRIPT = `#!/bin/sh
EXT_PATH=$(cat "$HOME/.hydra/ext-path" 2>/dev/null)
if [ -z "$EXT_PATH" ] || [ ! -f "$EXT_PATH/out/cli/index.js" ]; then
  echo "Error: Hydra VS Code extension not found. Open VS Code with Hydra installed." >&2
  exit 1
fi
exec node "$EXT_PATH/out/cli/index.js" "$@"
`;

export function installCli(extensionPath: string, version: string): { installed: boolean; updated: boolean } {
  // Create ~/.hydra/bin/ directory
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // Always write ext-path to handle extension updates
  fs.writeFileSync(EXT_PATH_FILE, extensionPath, 'utf-8');

  // Write wrapper script
  fs.writeFileSync(WRAPPER_PATH, WRAPPER_SCRIPT, { encoding: 'utf-8', mode: 0o755 });

  // Determine install vs update by comparing cli-version
  let previousVersion: string | undefined;
  try {
    previousVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
  } catch {
    // File doesn't exist — fresh install
  }

  fs.writeFileSync(VERSION_FILE, version, 'utf-8');

  if (!previousVersion) {
    return { installed: true, updated: false };
  }
  if (previousVersion !== version) {
    return { installed: false, updated: true };
  }
  // Same version, no change
  return { installed: false, updated: false };
}

export function isCliOnPath(): boolean {
  const envPath = process.env.PATH || '';
  return envPath.split(path.delimiter).some(p => {
    try {
      return fs.realpathSync(p) === fs.realpathSync(BIN_DIR);
    } catch {
      return p === BIN_DIR || p === '$HOME/.hydra/bin' || p.endsWith('/.hydra/bin');
    }
  });
}

export function getShellConfigSnippet(): string {
  return 'export PATH="$HOME/.hydra/bin:$PATH"';
}
