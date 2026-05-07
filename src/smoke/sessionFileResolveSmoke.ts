/**
 * Smoke test: resolveAgentSessionFile resolves transcript paths for claude,
 * codex, and gemini against fixture homes laid out under a temp directory.
 *
 * Run:  node out/smoke/sessionFileResolveSmoke.js
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveAgentSessionFile } from '../core/path';

function withFakeHome<T>(fn: (home: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-session-resolve-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  try {
    return fn(dir);
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(p: string, contents = ''): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
}

function testClaude(): void {
  withFakeHome((home) => {
    const workdir = '/Users/dev/code/myproj/.hydra/worktrees/feat-x';
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const encoded = workdir.replace(/[/.]/g, '-');
    const expected = path.join(home, '.claude', 'projects', encoded, `${sessionId}.jsonl`);
    writeFile(expected, '{}\n');

    assert.equal(resolveAgentSessionFile('claude', workdir, sessionId), expected);
    assert.equal(resolveAgentSessionFile('claude', workdir, 'missing-id'), null);
    assert.equal(resolveAgentSessionFile('claude', workdir, null), null);
    assert.equal(resolveAgentSessionFile('claude', '', sessionId), null);
  });
}

function testCodex(): void {
  withFakeHome((home) => {
    const sessionId = '019deccc-251c-7192-bf0d-e8ff36a0bb5e';
    const expected = path.join(
      home, '.codex', 'sessions', '2026', '05', '03',
      `rollout-2026-05-03T00-44-55-${sessionId}.jsonl`,
    );
    writeFile(expected, '');
    // Decoy from a different day with a different sessionId.
    writeFile(path.join(
      home, '.codex', 'sessions', '2026', '05', '02',
      'rollout-2026-05-02T10-00-00-deadbeef-dead-beef-dead-beefdeadbeef.jsonl',
    ));

    assert.equal(resolveAgentSessionFile('codex', '/any/workdir', sessionId), expected);
    assert.equal(resolveAgentSessionFile('codex', '/any/workdir', 'no-such-id'), null);
    assert.equal(resolveAgentSessionFile('codex', '/any/workdir', null), null);
  });
}

function testGemini(): void {
  withFakeHome((home) => {
    const workdir = '/Users/dev/code/myproj';
    const projectName = 'myproj';
    writeFile(
      path.join(home, '.gemini', 'projects.json'),
      JSON.stringify({ projects: { [workdir]: projectName, '/other/path': 'other' } }),
    );
    const expected = path.join(home, '.gemini', 'tmp', projectName, 'logs.json');
    writeFile(expected, '[]');

    assert.equal(resolveAgentSessionFile('gemini', workdir, 'unused-session-id'), expected);
    assert.equal(resolveAgentSessionFile('gemini', workdir, null), expected);
    assert.equal(resolveAgentSessionFile('gemini', '/not/in/projects', 'x'), null);
    assert.equal(resolveAgentSessionFile('gemini', '', 'x'), null);
  });
}

function testGeminiMissingLogs(): void {
  withFakeHome((home) => {
    const workdir = '/Users/dev/code/myproj';
    writeFile(
      path.join(home, '.gemini', 'projects.json'),
      JSON.stringify({ projects: { [workdir]: 'myproj' } }),
    );
    // No logs.json on disk.
    assert.equal(resolveAgentSessionFile('gemini', workdir, null), null);
  });
}

function testUnknownAgent(): void {
  withFakeHome(() => {
    assert.equal(resolveAgentSessionFile('unknown', '/x', 'y'), null);
  });
}

function main(): void {
  testClaude();
  testCodex();
  testGemini();
  testGeminiMissingLogs();
  testUnknownAgent();
  console.log('sessionFileResolveSmoke: ok');
}

main();
