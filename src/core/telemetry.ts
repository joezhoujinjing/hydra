import * as crypto from 'crypto';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { getHydraHome } from './path';

type ErrnoLike = Error & { code?: string };

export type TelemetryProperties = Record<string, unknown>;

export interface TelemetryBackend {
  capture(
    event: string,
    properties: TelemetryProperties,
    signal?: AbortSignal,
  ): void | Promise<void>;
  flush?(): Promise<void>;
}

const ANONYMOUS_ID_FILENAME = 'anonymous-id';
const TELEMETRY_LOG_FILENAME = 'telemetry.log';
const DEFAULT_TIMEOUT_MS = 500;
const TELEMETRY_README_URL = 'https://github.com/joezhoujinjing/hydra#telemetry';

const FIRST_RUN_NOTICE =
  'Hydra collects anonymous usage stats to improve the tool. ' +
  `Set HYDRA_TELEMETRY=0 to opt out. See ${TELEMETRY_README_URL}.`;

// UUIDv4 only: position 14 must be `4`, position 19 must be 8/9/a/b.
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KNOWN_AGENTS = new Set(['claude', 'codex', 'gemini']);

export function normalizeAgentForTelemetry(agent: string | undefined | null): string {
  if (typeof agent !== 'string' || !agent.trim()) {
    return 'unknown';
  }
  return KNOWN_AGENTS.has(agent) ? agent : 'custom';
}

function readPersistedAnonymousId(idPath: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(idPath, 'utf-8');
  } catch (err) {
    if ((err as ErrnoLike).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  const trimmed = raw.trim();
  return UUID_V4_REGEX.test(trimmed) ? trimmed : null;
}

function ensureHydraDir(): string {
  const home = getHydraHome();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  // Tighten an already-existing directory too. Best-effort: chmod can fail
  // on shared/CI filesystems (EPERM), Windows (no POSIX modes), or when
  // we are not the owner — none of which should crash the CLI.
  try {
    fs.chmodSync(home, 0o700);
  } catch {
    // ignore — we will still return the directory and let downstream
    // writes fail loudly if the permissions actually prevent them.
  }
  return home;
}

export function getAnonymousId(): string {
  const home = ensureHydraDir();
  const idPath = path.join(home, ANONYMOUS_ID_FILENAME);

  const existing = readPersistedAnonymousId(idPath);
  if (existing) {
    return existing;
  }

  // Either missing or invalid. If a stale file exists, drop it so the
  // exclusive-create write below can succeed.
  if (fs.existsSync(idPath)) {
    try {
      fs.unlinkSync(idPath);
    } catch {
      // best-effort; the wx write below may still race a concurrent writer
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = crypto.randomUUID();
    try {
      fs.writeFileSync(idPath, `${candidate}\n`, { flag: 'wx', mode: 0o600 });
      try {
        process.stderr.write(`${FIRST_RUN_NOTICE}\n`);
      } catch {
        // never block the CLI on a failed stderr write
      }
      return candidate;
    } catch (err) {
      const code = (err as ErrnoLike).code;
      if (code !== 'EEXIST') {
        throw err;
      }
      // A concurrent process won the create race. Prefer their id if it is
      // valid; otherwise replace the bad file and retry once.
      const concurrent = readPersistedAnonymousId(idPath);
      if (concurrent) {
        return concurrent;
      }
      try {
        fs.unlinkSync(idPath);
      } catch {
        // best-effort
      }
    }
  }

  // Could not persist (filesystem hostile). Return an ephemeral id so the
  // caller is not blocked; next run will retry.
  return crypto.randomUUID();
}

function safeGetAnonymousId(): string {
  try {
    return getAnonymousId();
  } catch {
    return '';
  }
}

export class NullBackend implements TelemetryBackend {
  capture(_event: string, _properties: TelemetryProperties, _signal?: AbortSignal): void {
    // intentional no-op; ignores AbortSignal
    void _event;
    void _properties;
    void _signal;
  }

  async flush(): Promise<void> {
    // nothing buffered
  }
}

export class ConsoleBackend implements TelemetryBackend {
  private readonly logPath: string;

  constructor(logPath?: string) {
    this.logPath = logPath ?? path.join(getHydraHome(), TELEMETRY_LOG_FILENAME);
  }

  async capture(
    event: string,
    properties: TelemetryProperties,
    _signal?: AbortSignal,
  ): Promise<void> {
    void _signal; // local file write is fast; abort is best-effort and not honored
    const line = `${JSON.stringify({
      event,
      properties,
      timestamp: new Date().toISOString(),
    })}\n`;
    await fsPromises.mkdir(path.dirname(this.logPath), { recursive: true });
    await fsPromises.appendFile(this.logPath, line, 'utf-8');
  }

  async flush(): Promise<void> {
    // appendFile is awaited per-event; nothing additional to drain
  }
}

// TODO(telemetry-backend): swap this stub for a real implementation once we
// pick a provider in PR review (PostHog cloud / self-host / Mixpanel / ...).
// The real backend MUST honor the AbortSignal — abort outstanding HTTP
// requests when the dispatch timeout fires so we never keep the CLI alive.
// Do NOT add network code or install posthog-node here yet.
export class PostHogBackend implements TelemetryBackend {
  capture(_event: string, _properties: TelemetryProperties, _signal?: AbortSignal): void {
    void _event;
    void _properties;
    // TODO: when implementing, pass _signal through to the HTTP client so
    // that timeouts cancel in-flight requests instead of leaking.
    void _signal;
  }

  async flush(): Promise<void> {
    // TODO: drain the in-memory event queue when the real backend lands.
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
  private readonly inflight = new Set<Promise<void>>();

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
    // Auto-attached props win — callers cannot override hydra_version,
    // platform, node_version, or anonymous_id by passing them as props.
    const payload: TelemetryProperties = { ...properties, ...this.defaults };
    const tracker = this.scheduleDispatch(event, payload);
    this.inflight.add(tracker);
    void tracker.finally(() => this.inflight.delete(tracker));
  }

  async flush(): Promise<void> {
    const pending = Array.from(this.inflight);
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
    if (this.backend.flush) {
      try {
        await this.backend.flush();
      } catch {
        // never propagate — flush is best-effort
      }
    }
  }

  private scheduleDispatch(event: string, properties: TelemetryProperties): Promise<void> {
    return new Promise<void>(resolve => {
      // setImmediate so capture() always returns synchronously.
      setImmediate(() => {
        this.dispatch(event, properties).then(resolve, resolve);
      });
    });
  }

  private async dispatch(event: string, properties: TelemetryProperties): Promise<void> {
    const controller = new AbortController();
    // Keep the timer refed so it actually fires when a backend hangs and
    // there is no other refed work in the event loop. We always
    // clearTimeout in the finally block, so a fast backend never costs
    // the CLI extra wall-clock time.
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const result = this.backend.capture(event, properties, controller.signal);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        await new Promise<void>(resolve => {
          let settled = false;
          const settle = (): void => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          Promise.resolve(result).then(settle, settle);
          if (controller.signal.aborted) {
            settle();
          } else {
            controller.signal.addEventListener('abort', settle, { once: true });
          }
        });
      }
    } catch {
      // backends must not crash the CLI
    } finally {
      clearTimeout(timer);
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

/**
 * Returns the active client only if `getTelemetry()` has already been called
 * this process. Lets `beforeExit` skip the flush (and the implicit
 * anonymous-id creation) on commands that never captured an event — e.g.
 * `hydra --help`, `hydra list`, etc.
 */
export function peekTelemetry(): TelemetryClient | null {
  return sharedClient;
}

export function resetTelemetryForTesting(): void {
  sharedClient = null;
}
