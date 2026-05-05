import * as fs from 'fs';
import { getHydraDir } from './paths';

/** Ensure the Hydra home directory exists. */
export function ensureHydraGlobalConfig(): void {
  const hydraDir = getHydraDir();
  if (!fs.existsSync(hydraDir)) {
    fs.mkdirSync(hydraDir, { recursive: true });
  }
}
