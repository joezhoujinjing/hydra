/**
 * Smoke test for the agent completion hook injection.
 *
 * Part 1: Verifies that injectCompletionHook writes the correct hook
 *          config files and notification script for each agent type.
 *
 * Part 2: Runs the generated notification script against real tmux
 *          sessions and verifies the copilot receives the message.
 */

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const COPILOT_SESSION = 'hydra-smoke-hook-copilot';

function sq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function killSession(name: string): void {
  try { execSync(`tmux kill-session -t ${sq(name)}`, { stdio: 'ignore', timeout: 5000 }); } catch { /* */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main(): Promise<void> {
  // Redirect Hydra state to a temp directory so we don't pollute the real one
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-smoke-hook-'));
  const origHome = process.env.HOME;
  process.env.HOME = tempHome;

  const hydraDir = path.join(tempHome, '.hydra');
  const sessionsFile = path.join(hydraDir, 'sessions.json');

  // Seed a minimal sessions.json so readSessionState doesn't fail
  fs.mkdirSync(hydraDir, { recursive: true });
  fs.writeFileSync(sessionsFile, JSON.stringify({
    copilots: {}, workers: {}, nextWorkerId: 7, updatedAt: new Date().toISOString(),
  }));

  // Dynamic import so HOME override is in effect when modules resolve paths
  const { SessionManager } = await import('../core/sessionManager');
  const { TmuxBackendCore } = await import('../core/tmux');

  const backend = new TmuxBackendCore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sm = new SessionManager(backend) as any;

  const fakeWorktree = path.join(tempHome, 'worktree');
  fs.mkdirSync(fakeWorktree, { recursive: true });

  const hookInfo = {
    copilotSessionName: 'repo_my-copilot',
    sessionName: 'repo_feat-auth',
    workerId: 7,
    displayName: 'feat-auth',
    branch: 'feat/auth',
  };

  // ── Part 1: Verify hook config files for each agent ──

  // Claude
  sm['injectCompletionHook'](fakeWorktree, 'claude', hookInfo);
  const claudeConfig = JSON.parse(fs.readFileSync(path.join(fakeWorktree, '.claude', 'settings.json'), 'utf-8'));
  assert.ok(claudeConfig.hooks?.Stop, 'Claude config should have Stop hook');
  assert.equal(claudeConfig.hooks.Stop.length, 1);
  assert.equal(claudeConfig.hooks.Stop[0].hooks[0].type, 'command');
  assert.equal(claudeConfig.hooks.Stop[0].hooks[0].async, true, 'Claude hook should be async');
  const claudeCmd: string = claudeConfig.hooks.Stop[0].hooks[0].command;
  assert.ok(claudeCmd.includes('notify-repo_feat-auth.sh'), `Hook command should reference script, got: ${claudeCmd}`);

  // Codex
  sm['injectCompletionHook'](fakeWorktree, 'codex', hookInfo);
  const codexConfig = JSON.parse(fs.readFileSync(path.join(fakeWorktree, '.codex', 'hooks.json'), 'utf-8'));
  assert.ok(codexConfig.hooks?.Stop, 'Codex config should have Stop hook');
  assert.equal(codexConfig.hooks.Stop[0].hooks[0].type, 'command');
  // Verify codex_hooks feature flag is enabled in config.toml
  const codexToml = fs.readFileSync(path.join(fakeWorktree, '.codex', 'config.toml'), 'utf-8');
  assert.ok(codexToml.includes('codex_hooks = true'), 'Codex config.toml should enable hooks feature flag');

  // Gemini
  sm['injectCompletionHook'](fakeWorktree, 'gemini', hookInfo);
  const geminiConfig = JSON.parse(fs.readFileSync(path.join(fakeWorktree, '.gemini', 'settings.json'), 'utf-8'));
  assert.ok(geminiConfig.hooks?.AfterAgent, 'Gemini config should have AfterAgent hook');
  assert.equal(geminiConfig.hooks.AfterAgent[0].matcher, '*', 'Gemini hook should have matcher: "*"');
  assert.equal(geminiConfig.hooks.AfterAgent[0].hooks[0].type, 'command');

  // Custom (should produce no config)
  sm['injectCompletionHook'](fakeWorktree, 'custom', hookInfo);
  assert.ok(!fs.existsSync(path.join(fakeWorktree, '.custom')), 'Custom agent should not produce config');

  // Verify notification script exists and is executable
  const scriptPath = path.join(hydraDir, 'hooks', `notify-${hookInfo.sessionName}.sh`);
  assert.ok(fs.existsSync(scriptPath), 'Notification script should exist');
  const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  assert.ok(scriptContent.includes('load-buffer'), 'Script should use load-buffer');
  assert.ok(scriptContent.includes('paste-buffer'), 'Script should use paste-buffer');
  assert.ok(scriptContent.includes(hookInfo.copilotSessionName), 'Script should reference copilot session');
  assert.ok(scriptContent.includes('HYDRA_TMUX_SOCKET'), 'Script should handle custom tmux socket');

  // Verify merge behavior: inject again and check Claude has 2 Stop entries
  sm['injectCompletionHook'](fakeWorktree, 'claude', hookInfo);
  const claudeConfig2 = JSON.parse(fs.readFileSync(path.join(fakeWorktree, '.claude', 'settings.json'), 'utf-8'));
  assert.equal(claudeConfig2.hooks.Stop.length, 2, 'Merge should append, not overwrite');

  console.log('  Part 1 (config injection): ok');

  // ── Part 2: Run the notification script against real tmux ──

  try {
    execSync('which tmux', { stdio: 'ignore' });
  } catch {
    console.log('  Part 2: SKIP (tmux not available)');
    console.log('completionHookSmoke: ok');
    return;
  }

  killSession(COPILOT_SESSION);

  try {
    // Create a copilot session running cat (to receive the notification)
    execSync(
      `tmux new-session -d -s ${sq(COPILOT_SESSION)} -x 80 -y 24 -- cat`,
      { timeout: 5000 },
    );
    await sleep(500);

    // Write a test-specific script that targets our test copilot
    const testInfo = { ...hookInfo, copilotSessionName: COPILOT_SESSION };
    sm['injectCompletionHook'](fakeWorktree, 'claude', testInfo);
    const testScriptPath = path.join(hydraDir, 'hooks', `notify-${testInfo.sessionName}.sh`);

    // Execute the notification script directly
    execSync(`sh ${sq(testScriptPath)}`, { timeout: 5000, env: { ...process.env, HOME: tempHome } });

    await sleep(1000);

    // Capture the copilot pane and verify notification arrived
    const paneOutput = execSync(
      `tmux capture-pane -p -t ${sq(COPILOT_SESSION)}`,
      { encoding: 'utf-8', timeout: 5000 },
    );

    assert.ok(
      paneOutput.includes('has completed'),
      `Copilot pane should contain notification, got:\n${paneOutput}`,
    );
    assert.ok(
      paneOutput.includes('feat-auth'),
      `Notification should mention worker name, got:\n${paneOutput}`,
    );

    console.log('  Part 2 (live tmux notification): ok');
  } finally {
    killSession(COPILOT_SESSION);
  }

  // Restore HOME
  if (origHome) process.env.HOME = origHome;
  fs.rmSync(tempHome, { recursive: true, force: true });

  console.log('completionHookSmoke: ok');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
