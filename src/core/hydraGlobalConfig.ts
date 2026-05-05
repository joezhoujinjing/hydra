import * as fs from 'fs';
import * as path from 'path';
import { getHydraConfigPath, getHydraHome } from './path';

/** Ensure Hydra data/config directories exist. */
export function ensureHydraGlobalConfig(): void {
  const hydraHome = getHydraHome();
  const hydraConfigDir = path.dirname(getHydraConfigPath());

  if (!fs.existsSync(hydraHome)) {
    fs.mkdirSync(hydraHome, { recursive: true });
  }
  if (!fs.existsSync(hydraConfigDir)) {
    fs.mkdirSync(hydraConfigDir, { recursive: true });
  }
}
