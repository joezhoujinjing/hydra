/**
 * Smoke test: telemetry framework.
 *
 * Verifies:
 *   1. NullBackend is the default and `capture` never throws.
 *   2. ConsoleBackend appends a JSON line to telemetry.log.
 *   3. HYDRA_TELEMETRY=0 (and "off") forces NullBackend even with debug set.
 *   4. anonymous-id is generated when missing and reused when present.
 *   5. capture() returns synchronously (does not block on a slow backend).
 *
 * Run:  node out/smoke/telemetrySmoke.js
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function withTempHome(fn: (hydraHome: string) => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const previousHydraHome = process.env.HYDRA_HOME;
  const previousHydraConfig = process.env.HYDRA_CONFIG_PATH;
  const previousTelemetry = process.env.HYDRA_TELEMETRY;
  const previousTelemetryDebug = process.env.HYDRA_TELEMETRY_DEBUG;

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-telemetry-'));
  const hydraHome = path.join(tempHome, '.hydra');
  process.env.HOME = tempHome;
  process.env.HYDRA_HOME = hydraHome;
  delete process.env.HYDRA_CONFIG_PATH;
  delete process.env.HYDRA_TELEMETRY;
  delete process.env.HYDRA_TELEMETRY_DEBUG;

  try {
    await fn(hydraHome);
  } finally {
    process.env.HOME = previousHome;
    if (previousHydraHome === undefined) {
      delete process.env.HYDRA_HOME;
    } else {
      process.env.HYDRA_HOME = previousHydraHome;
    }
    if (previousHydraConfig === undefined) {
      delete process.env.HYDRA_CONFIG_PATH;
    } else {
      process.env.HYDRA_CONFIG_PATH = previousHydraConfig;
    }
    if (previousTelemetry === undefined) {
      delete process.env.HYDRA_TELEMETRY;
    } else {
      process.env.HYDRA_TELEMETRY = previousTelemetry;
    }
    if (previousTelemetryDebug === undefined) {
      delete process.env.HYDRA_TELEMETRY_DEBUG;
    } else {
      process.env.HYDRA_TELEMETRY_DEBUG = previousTelemetryDebug;
    }
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

function flushImmediates(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

async function testNullBackendDefault(): Promise<void> {
  await withTempHome(async hydraHome => {
    const telemetry = await import('../core/telemetry');
    telemetry.resetTelemetryForTesting();

    const backend = telemetry.selectBackend();
    assert.ok(backend instanceof telemetry.NullBackend, 'default backend should be NullBackend');

    const client = new telemetry.TelemetryClient();
    assert.doesNotThrow(() => client.capture('test_event', { foo: 'bar' }));

    await flushImmediates();
    assert.equal(
      fs.existsSync(path.join(hydraHome, 'telemetry.log')),
      false,
      'NullBackend must not write a telemetry.log',
    );
    assert.equal(
      fs.existsSync(path.join(hydraHome, 'anonymous-id')),
      false,
      'NullBackend must not generate an anonymous-id file',
    );
  });
}

async function testConsoleBackendWritesJsonLine(): Promise<void> {
  await withTempHome(async hydraHome => {
    process.env.HYDRA_TELEMETRY_DEBUG = '1';
    const telemetry = await import('../core/telemetry');
    telemetry.resetTelemetryForTesting();

    const backend = telemetry.selectBackend();
    assert.ok(
      backend instanceof telemetry.ConsoleBackend,
      'HYDRA_TELEMETRY_DEBUG=1 should select ConsoleBackend',
    );

    const client = new telemetry.TelemetryClient();
    client.capture('worker_created', { agent: 'claude' });
    await flushImmediates();
    await flushImmediates();

    const logPath = path.join(hydraHome, 'telemetry.log');
    assert.ok(fs.existsSync(logPath), 'telemetry.log must exist after capture()');

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'expected exactly one event line');

    const parsed = JSON.parse(lines[0]) as {
      event: string;
      properties: Record<string, unknown>;
      timestamp: string;
    };
    assert.equal(parsed.event, 'worker_created');
    assert.equal(parsed.properties.agent, 'claude');
    assert.equal(typeof parsed.properties.hydra_version, 'string');
    assert.equal(parsed.properties.platform, process.platform);
    assert.equal(parsed.properties.node_version, process.version);
    assert.equal(typeof parsed.properties.anonymous_id, 'string');
    assert.match(
      parsed.properties.anonymous_id as string,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      'anonymous_id must be a UUIDv4',
    );
    assert.match(parsed.timestamp, /\d{4}-\d{2}-\d{2}T/);
  });
}

async function testOptOutForcesNullBackend(): Promise<void> {
  for (const value of ['0', 'off', 'OFF', 'false']) {
    await withTempHome(async hydraHome => {
      process.env.HYDRA_TELEMETRY = value;
      process.env.HYDRA_TELEMETRY_DEBUG = '1';
      const telemetry = await import('../core/telemetry');
      telemetry.resetTelemetryForTesting();

      const backend = telemetry.selectBackend();
      assert.ok(
        backend instanceof telemetry.NullBackend,
        `HYDRA_TELEMETRY=${value} must force NullBackend even when DEBUG=1`,
      );

      const client = new telemetry.TelemetryClient();
      client.capture('worker_created', { agent: 'claude' });
      await flushImmediates();

      assert.equal(
        fs.existsSync(path.join(hydraHome, 'telemetry.log')),
        false,
        `opted-out telemetry must not write logs (value=${value})`,
      );
      assert.equal(
        fs.existsSync(path.join(hydraHome, 'anonymous-id')),
        false,
        `opted-out telemetry must not create anonymous-id (value=${value})`,
      );
    });
  }
}

async function testAnonymousIdLifecycle(): Promise<void> {
  await withTempHome(async hydraHome => {
    const telemetry = await import('../core/telemetry');
    telemetry.resetTelemetryForTesting();

    const idPath = path.join(hydraHome, 'anonymous-id');
    assert.equal(fs.existsSync(idPath), false, 'precondition: file should be missing');

    const first = telemetry.getAnonymousId();
    assert.match(
      first,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      'must return a UUIDv4',
    );
    assert.ok(fs.existsSync(idPath), 'file should be created after first call');

    const onDisk = fs.readFileSync(idPath, 'utf-8').trim();
    assert.equal(onDisk, first, 'on-disk content must match returned id');

    const second = telemetry.getAnonymousId();
    assert.equal(second, first, 'second call must reuse the persisted id');

    fs.writeFileSync(idPath, '   custom-marker-id   \n', 'utf-8');
    const third = telemetry.getAnonymousId();
    assert.equal(third, 'custom-marker-id', 'must trim and reuse the existing file');
  });
}

async function testCaptureIsNonBlocking(): Promise<void> {
  await withTempHome(async () => {
    const telemetry = await import('../core/telemetry');
    telemetry.resetTelemetryForTesting();

    const slowBackend: import('../core/telemetry').TelemetryBackend = {
      capture(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 60_000));
      },
    };

    const client = new telemetry.TelemetryClient({
      backend: slowBackend,
      anonymousId: 'fixed-test-id',
      hydraVersion: '0.0.0-test',
      timeoutMs: 50,
    });

    const start = process.hrtime.bigint();
    for (let i = 0; i < 10; i += 1) {
      client.capture('worker_created', { agent: 'claude' });
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    assert.ok(
      elapsedMs < 50,
      `capture() must return synchronously without awaiting backend (elapsed=${elapsedMs.toFixed(2)}ms)`,
    );

    const throwingBackend: import('../core/telemetry').TelemetryBackend = {
      capture(): never {
        throw new Error('intentional backend explosion');
      },
    };
    const safeClient = new telemetry.TelemetryClient({
      backend: throwingBackend,
      anonymousId: 'fixed-test-id',
      hydraVersion: '0.0.0-test',
    });
    assert.doesNotThrow(() => safeClient.capture('worker_deleted'));
    await flushImmediates();
    await flushImmediates();
  });
}

async function main(): Promise<void> {
  await testNullBackendDefault();
  await testConsoleBackendWritesJsonLine();
  await testOptOutForcesNullBackend();
  await testAnonymousIdLifecycle();
  await testCaptureIsNonBlocking();
  console.log('telemetrySmoke: ok');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
