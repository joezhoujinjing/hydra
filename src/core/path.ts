import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { shellQuote } from './shell';

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

export interface HydraCliConfig {
  extensionPath?: string;
  version?: string;
}

export interface HydraGlobalConfig {
  hydraHome?: string;
  hydraConfigPath?: string;
  HYDRA_HOME?: string;
  HYDRA_CONFIG_PATH?: string;
  cli?: HydraCliConfig;
}

export interface HydraResolvedPaths {
  hydraHome: string;
  hydraConfigPath: string;
  hydraConfig: HydraGlobalConfig;
  hydraBinDir: string;
  hydraSessionsFile: string;
  hydraArchiveFile: string;
  hydraWorktreesRoot: string;
}

export function getDefaultHydraHome(): string {
  return path.join(os.homedir(), '.hydra');
}

function resolveConfigPathValue(value: unknown, configPath: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const expanded = expandHomeDir(value.trim());
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(path.dirname(configPath), expanded);
  return path.normalize(absolute);
}

function getConfigHydraHome(config: HydraGlobalConfig): string | undefined {
  return config.hydraHome || config.HYDRA_HOME;
}

function getConfigHydraConfigPath(config: HydraGlobalConfig): string | undefined {
  return config.hydraConfigPath || config.HYDRA_CONFIG_PATH;
}

function readHydraConfigFile(configPath: string): HydraGlobalConfig {
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return raw && typeof raw === 'object' ? raw as HydraGlobalConfig : {};
  } catch {
    return {};
  }
}

export function getHydraPaths(): HydraResolvedPaths {
  const defaultHydraHome = getDefaultHydraHome();
  const envHydraHome = toCanonicalPath(process.env.HYDRA_HOME);
  const envHydraConfigPath = toCanonicalPath(process.env.HYDRA_CONFIG_PATH);

  const bootstrapConfigPath = envHydraConfigPath
    || path.join(envHydraHome || defaultHydraHome, 'config.json');

  let hydraConfig = readHydraConfigFile(bootstrapConfigPath);
  let hydraHome = envHydraHome
    || resolveConfigPathValue(getConfigHydraHome(hydraConfig), bootstrapConfigPath)
    || defaultHydraHome;
  let hydraConfigPath = envHydraConfigPath
    || resolveConfigPathValue(getConfigHydraConfigPath(hydraConfig), bootstrapConfigPath)
    || path.join(hydraHome, 'config.json');

  if (!envHydraConfigPath && hydraConfigPath !== bootstrapConfigPath && fs.existsSync(hydraConfigPath)) {
    hydraConfig = readHydraConfigFile(hydraConfigPath);
    hydraHome = envHydraHome
      || resolveConfigPathValue(getConfigHydraHome(hydraConfig), hydraConfigPath)
      || hydraHome;
    hydraConfigPath = envHydraConfigPath
      || resolveConfigPathValue(getConfigHydraConfigPath(hydraConfig), hydraConfigPath)
      || hydraConfigPath;
  }

  return {
    hydraHome,
    hydraConfigPath,
    hydraConfig,
    hydraBinDir: path.join(hydraHome, 'bin'),
    hydraSessionsFile: path.join(hydraHome, 'sessions.json'),
    hydraArchiveFile: path.join(hydraHome, 'archive.json'),
    hydraWorktreesRoot: path.join(hydraHome, 'worktrees'),
  };
}

export function getHydraHome(): string {
  return getHydraPaths().hydraHome;
}

export function getHydraConfigPath(): string {
  return getHydraPaths().hydraConfigPath;
}

export function getHydraConfig(): HydraGlobalConfig {
  return getHydraPaths().hydraConfig;
}

export function writeHydraConfig(config: HydraGlobalConfig): void {
  const { hydraConfigPath } = getHydraPaths();
  fs.mkdirSync(path.dirname(hydraConfigPath), { recursive: true });
  fs.writeFileSync(hydraConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function getHydraBinDir(): string {
  return getHydraPaths().hydraBinDir;
}

export function getHydraSessionsFile(): string {
  return getHydraPaths().hydraSessionsFile;
}

export function getHydraArchiveFile(): string {
  return getHydraPaths().hydraArchiveFile;
}

export function getHydraWorktreesRoot(): string {
  return getHydraPaths().hydraWorktreesRoot;
}

export function getIsolatedEnv(): Record<string, string | undefined> {
  const { hydraHome, hydraConfigPath } = getHydraPaths();
  const env: Record<string, string | undefined> = { ...process.env };
  env.HYDRA_HOME = hydraHome;
  env.HYDRA_CONFIG_PATH = hydraConfigPath;
  if (process.env.HYDRA_TMUX_SOCKET) {
    env.HYDRA_TMUX_SOCKET = process.env.HYDRA_TMUX_SOCKET;
  }
  return env;
}

export function getTmuxSocketArgs(): string[] {
  const socket = process.env.HYDRA_TMUX_SOCKET;
  if (!socket) {
    return [];
  }

  if (socket.startsWith('/') || socket.startsWith('./') || socket.startsWith('../')) {
    return ['-S', socket];
  }

  return ['-L', socket];
}

export function getTmuxCommand(): string {
  const socketArgs = getTmuxSocketArgs();
  if (socketArgs.length === 0) {
    return 'tmux';
  }

  return `tmux ${socketArgs.map(arg => shellQuote(arg)).join(' ')}`;
}
