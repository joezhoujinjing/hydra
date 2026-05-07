import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getHydraHome } from './path';

export type TelemetryProperties = Record<string, unknown>;

export interface TelemetryBackend {
  capture(event: string, properties: TelemetryProperties): void | Promise<void>;
}

const ANONYMOUS_ID_FILENAME = 'anonymous-id';
const TELEMETRY_LOG_FILENAME = 'telemetry.log';
const DEFAULT_TIMEOUT_MS = 500;

const FIRST_RUN_NOTICE =
  'Hydra collects anonymous usage stats to improve the tool. ' +
  'Set HYDRA_TELEMETRY=0 to opt out. See <link to README>.';

export function getAnonymousId(): string {
  const idPath = path.join(getHydraHome(), ANONYMOUS_ID_FILENAME);

  try {
    const existing = fs.readFileSync(idPath, 'utf-8').trim();
    if (existing) {
      return existing;
    }
  } catch {
    // file missing or unreadable — fall through to generation
  }

  const id = crypto.randomUUID();
  try {
    fs.mkdirSync(path.dirname(idPath), { recursive: true });
    fs.writeFileSync(idPath, `${id}\n`, 'utf-8');
    try {
      process.stderr.write(`${FIRST_RUN_NOTICE}\n`);
    } catch {
      // never block the CLI on a failed stderr write
    }
  } catch {
    // best-effort: even if we cannot persist, return an in-memory id so
    // downstream callers do not crash. The next run will try again.
  }
  return id;
}

export class NullBackend implements TelemetryBackend {
  capture(): void {
    // intentional no-op
  }
}

export class ConsoleBackend implements TelemetryBackend {
  private readonly logPath: string;

  constructor(logPath?: string) {
    this.logPath = logPath ?? path.join(getHydraHome(), TELEMETRY_LOG_FILENAME);
  }

  capture(event: string, properties: TelemetryProperties): void {
    const line = `${JSON.stringify({
      event,
      properties,
      timestamp: new Date().toISOString(),
    })}\n`;
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    fs.appendFileSync(this.logPath, line, 'utf-8');
  }
}

// TODO(telemetry-backend): swap this stub for a real implementation once we
// pick a provider in PR review (PostHog cloud / self-host / Mixpanel / ...).
// Do NOT add network code or install posthog-node here yet.
export class PostHogBackend implements TelemetryBackend {
  capture(): void {
    // stub — intentionally no network calls
  }
}

export interface TelemetryClientOptions {
  backend?: TelemetryBackend;
  hydraVersion?: string;
  anonymousId?: string;
  timeoutMs?: number;
}

function loadPackageVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function safeGetAnonymousId(): string {
  try {
    return getAnonymousId();
  } catch {
    return '';
  }
}

export function selectBackend(): TelemetryBackend {
  const optOut = (process.env.HYDRA_TELEMETRY ?? '').trim().toLowerCase();
  if (optOut === '0' || optOut === 'off' || optOut === 'false') {
    return new NullBackend();
  }
  if (process.env.HYDRA_TELEMETRY_DEBUG === '1') {
    return new ConsoleBackend();
  }
  // No real backend wired up yet — default to NullBackend until a provider
  // is chosen in PR review. After that lands, switch this to PostHogBackend.
  return new NullBackend();
}

export class TelemetryClient {
  private readonly backend: TelemetryBackend;
  private readonly timeoutMs: number;
  private readonly defaults: TelemetryProperties;

  constructor(options: TelemetryClientOptions = {}) {
    this.backend = options.backend ?? selectBackend();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const isNoOp = this.backend instanceof NullBackend;
    this.defaults = {
      hydra_version: options.hydraVersion ?? loadPackageVersion(),
      platform: process.platform,
      node_version: process.version,
      anonymous_id: options.anonymousId ?? (isNoOp ? '' : safeGetAnonymousId()),
    };
  }

  capture(event: string, properties: TelemetryProperties = {}): void {
    const payload: TelemetryProperties = { ...this.defaults, ...properties };
    // Schedule on the next tick so capture() always returns synchronously.
    setImmediate(() => {
      this.dispatch(event, payload);
    });
  }

  private dispatch(event: string, properties: TelemetryProperties): void {
    let resolved = false;
    const timer = setTimeout(() => {
      resolved = true;
    }, this.timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    const finalize = (): void => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
      }
    };

    try {
      const result = this.backend.capture(event, properties);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(finalize, finalize);
      } else {
        finalize();
      }
    } catch {
      finalize();
    }
  }
}

let sharedClient: TelemetryClient | null = null;

export function getTelemetry(): TelemetryClient {
  if (!sharedClient) {
    sharedClient = new TelemetryClient();
  }
  return sharedClient;
}

export function resetTelemetryForTesting(): void {
  sharedClient = null;
}
