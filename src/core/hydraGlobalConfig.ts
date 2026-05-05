import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HYDRA_DIR = path.join(os.homedir(), '.hydra');

/** Ensure ~/.hydra/ directory exists. */
export function ensureHydraGlobalConfig(): void {
  if (!fs.existsSync(HYDRA_DIR)) {
    fs.mkdirSync(HYDRA_DIR, { recursive: true });
  }
}
