/**
 * Adversarial smoke test for {@link posixQuote} in src/core/remoteTmux.ts.
 *
 * `posixQuote` is the single thin layer between user-supplied strings (branch
 * names, repo paths, agent commands, send-message payloads) and the remote
 * shell that ssh executes them in. A bug here is shell injection on every
 * remote box Hydra ever talks to — so this smoke runs a real `sh -c` over
 * each adversarial input and asserts the shell sees the bytes verbatim with
 * zero side effects.
 *
 * Each case writes the quoted value via `printf` into a tmpfile, then reads
 * the tmpfile back and asserts byte equality with the original. Tmpfiles are
 * compared instead of stdout because side-effect detection (e.g. `$(touch
 * /tmp/PWNED)` succeeding) only shows up on disk.
 *
 * Run:  node out/smoke/posixQuoteSmoke.js
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { posixQuote } from '../core/remoteTmux';

interface Case {
  name: string;
  input: string;
}

const CASES: Case[] = [
  { name: 'empty string', input: '' },
  { name: 'plain ascii', input: 'hello world' },
  { name: 'single quote', input: "It's a test" },
  { name: 'multiple single quotes', input: "''''" },
  { name: 'double quote', input: 'a "quoted" b' },
  { name: 'backtick', input: 'a `whoami` b' },
  { name: '$(...) command sub', input: 'before $(touch /tmp/HYDRA_PWN_DOLLAR_PAREN) after' },
  { name: '`...` command sub', input: 'before `touch /tmp/HYDRA_PWN_BACKTICK` after' },
  { name: '${VAR} expansion attempt', input: 'home=${HOME} path=$PATH' },
  { name: '; chaining attempt', input: 'a; rm -rf / ; b' },
  { name: '&& chaining attempt', input: 'a && rm -rf / && b' },
  { name: '| pipe attempt', input: 'a | tee /tmp/HYDRA_PWN_PIPE | b' },
  { name: 'redirect attempt', input: 'a > /tmp/HYDRA_PWN_REDIR' },
  { name: 'newline embedded', input: 'line1\nline2\nline3' },
  { name: 'CR embedded', input: 'line1\rline2' },
  { name: 'tab embedded', input: 'a\tb\tc' },
  { name: 'backslash literal', input: 'C:\\Users\\test\\path' },
  { name: 'mixed special chars', input: `"hello" 'world' \`cmd\` $HOME \\path (parens) {braces} [brackets] | & ; # ~ !` },
  { name: 'quote-break injection', input: `'; rm -rf /; '` },
  { name: 'escape attempt', input: `'\\''; rm -rf /; '\\''` },
  { name: 'unicode', input: '中文 emoji 🐉 ümlaut' },
  { name: 'long input', input: 'x'.repeat(8 * 1024) },
  { name: 'NUL not allowed in shell args', input: 'a' }, // sentinel: real NUL would crash sh; we don't try it
];

function shExec(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile('/bin/sh', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      if (err && code === 0) {
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}

async function runCase(tc: Case): Promise<{ pass: boolean; detail?: string }> {
  const tmpFile = path.join(
    os.tmpdir(),
    `hydra-posix-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  // Sentinel files we'll check for side effects from injection attempts.
  const sentinels = [
    '/tmp/HYDRA_PWN_DOLLAR_PAREN',
    '/tmp/HYDRA_PWN_BACKTICK',
    '/tmp/HYDRA_PWN_PIPE',
    '/tmp/HYDRA_PWN_REDIR',
  ];
  for (const f of sentinels) {
    try { fs.unlinkSync(f); } catch { /* ok */ }
  }

  try {
    const quoted = posixQuote(tc.input);

    // Two checks per case:
    //   (a) `printf %s <quoted> > tmp` writes input bytes verbatim
    //   (b) any sentinel file from an injection attempt does NOT exist after (a)
    const cmd = `printf %s ${quoted} > ${posixQuote(tmpFile)}`;
    const result = await shExec(['-c', cmd]);
    if (result.code !== 0) {
      return { pass: false, detail: `sh -c exited ${result.code}: ${result.stderr.trim()}` };
    }

    const wrote = fs.readFileSync(tmpFile, 'utf-8');
    if (wrote !== tc.input) {
      return {
        pass: false,
        detail: `roundtrip mismatch — input.length=${tc.input.length}, wrote.length=${wrote.length}`
              + (tc.input.length < 200 ? `\n            input:  ${JSON.stringify(tc.input)}\n            wrote:  ${JSON.stringify(wrote)}` : ''),
      };
    }

    for (const f of sentinels) {
      if (fs.existsSync(f)) {
        return { pass: false, detail: `INJECTION SUCCEEDED — sentinel created: ${f}` };
      }
    }

    return { pass: true };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
    for (const f of sentinels) {
      try { fs.unlinkSync(f); } catch { /* ok */ }
    }
  }
}

async function main(): Promise<void> {
  if (process.platform === 'win32') {
    console.log('posixQuoteSmoke: skipped on win32 (POSIX shell not available)');
    process.exit(0);
  }

  let failed = 0;
  for (const tc of CASES) {
    const r = await runCase(tc);
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${tc.name}`);
    if (!r.pass) {
      console.log(`         ${r.detail}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.log(`\nposixQuoteSmoke: ${failed}/${CASES.length} FAILED`);
    process.exit(1);
  }
  console.log(`\nposixQuoteSmoke: ok (${CASES.length}/${CASES.length})`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
