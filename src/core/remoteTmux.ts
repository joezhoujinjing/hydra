import { execFile } from 'child_process';
import { ChildProcess } from 'child_process';

/**
 * RemoteTmuxBackend — runs tmux commands on a remote host over SSH.
 *
 * Surface mirrors the local TmuxBackendCore methods that worker lifecycle
 * needs (newSession, capturePane, sendKeys, sendMessage, killSession,
 * listSessions, hasSession). It is NOT a drop-in MultiplexerBackendCore
 * implementation — things like env scrubbing, role/agent metadata helpers,
 * and pane-pid introspection are local-tmux-specific and not used in the
 * remote MVP.
 *
 * SSH model:
 *   - Plain `ssh <host>` only — Hydra never invokes gcloud/cloud SDKs.
 *   - User configures their ~/.ssh/config (or runs `gcloud compute config-ssh`)
 *     so the alias resolves.
 *   - Connection options: BatchMode=yes (no password prompts) and
 *     ConnectTimeout=10 to fail fast on unreachable hosts.
 */

const SSH_DEFAULT_TIMEOUT_MS = 30000;
const SSH_PREFLIGHT_TIMEOUT_MS = 15000;

const SSH_BASE_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=10',
  '-o', 'ServerAliveCountMax=3',
];

export interface RemoteTmuxSession {
  name: string;
  windows: number;
  attached: boolean;
}

export class RemoteSshError extends Error {
  constructor(
    public readonly host: string,
    public readonly stderr: string,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteSshError';
  }
}

/** POSIX single-quote escape — for use in the remote shell. */
/**
 * POSIX single-quote escape for embedding arbitrary strings inside a remote
 * shell command. Wraps the value in single quotes and escapes any embedded
 * single quotes with the standard `'\''` close/escape/open sequence.
 *
 * Exported for {@link ../smoke/posixQuoteSmoke.ts} adversarial coverage.
 */
export function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Detect ssh's own transport-layer stderr signatures so we can surface a
 * clear error instead of letting `allowNonZeroExit` resolve the call as a
 * normal "remote command exited non-zero" outcome. ssh prefixes its own
 * messages with `ssh:` (or sometimes `ssh_exchange_identification:`); a few
 * classic auth / dns / config failures also show up unprefixed.
 */
function isSshTransportStderr(stderr: string): boolean {
  if (!stderr) return false;
  const lines = stderr.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
  return lines.some(line =>
    line.startsWith('ssh:') ||
    line.startsWith('ssh_exchange_identification:') ||
    line.includes('could not resolve hostname') ||
    line.includes('permission denied (publickey') ||
    line.includes('host key verification failed') ||
    line.includes('connection refused') ||
    line.includes('connection timed out') ||
    line.includes('connection closed by') ||
    line.includes('proxycommand') ||
    line.includes('kex_exchange_identification') ||
    line.includes('no route to host') ||
    line.includes('network is unreachable') ||
    line.includes('operation timed out') ||
    line.includes('lost connection') ||
    line.includes('broken pipe'),
  );
}

const SSH_CONFIG_HINT = 'Hydra speaks plain `ssh <host>` — make sure the alias works (`ssh <host> echo ok`). For GCP VMs, run `gcloud compute config-ssh` or add a ProxyCommand entry to ~/.ssh/config.';

/**
 * Detect benign `git worktree remove` failures — the worktree is already
 * gone, so the desired end state of `removeWorktree` is already achieved.
 * Anything else (locked, validation failure, ENOENT mid-removal, etc.) is
 * a real failure that should propagate so the caller can refuse to drop
 * its registry entry.
 */
function isBenignWorktreeRemoveStderr(stderr: string): boolean {
  if (!stderr) return false;
  const lower = stderr.toLowerCase();
  return (
    lower.includes('is not a working tree') ||
    lower.includes('is not a valid worktree') ||
    lower.includes('not a working tree')
  );
}

export class RemoteTmuxBackend {
  constructor(public readonly host: string) {}

  // ── Low-level SSH execution ─────────────────────────────────────────

  /**
   * Run a shell command on the remote host. The remote shell sees `remoteCmd`
   * as its full command line (the local OS does NOT re-interpret it — we pass
   * it as a single argv element after the host).
   */
  private runRemote(
    remoteCmd: string,
    opts: { input?: string; timeoutMs?: number; allowNonZeroExit?: boolean } = {},
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const args = [...SSH_BASE_OPTS, this.host, remoteCmd];
      let stdout = '';
      let stderr = '';
      const timeoutMs = opts.timeoutMs ?? SSH_DEFAULT_TIMEOUT_MS;

      const child: ChildProcess = execFile('ssh', args, {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf-8',
      }, (err, out, errOut) => {
        stdout = String(out ?? '');
        stderr = String(errOut ?? '');
        if (err) {
          const e = err as Error & { code?: number | string; signal?: string; killed?: boolean };
          // SSH transport failures (auth, ProxyCommand, unknown host, broken
          // connection) always come back as exit 255 OR with classic ssh
          // stderr signatures. Honor allowNonZeroExit ONLY for genuine remote
          // command exits, never for transport problems — otherwise an SSH
          // outage masquerades as "repo not found" / "no such session".
          if (e.signal === 'SIGTERM' || e.killed) {
            reject(this.translateSshError(e, stderr));
            return;
          }
          if (e.code === 255 || isSshTransportStderr(stderr)) {
            reject(this.translateSshError(e, stderr));
            return;
          }
          if (opts.allowNonZeroExit && typeof e.code === 'number') {
            resolve({ stdout, stderr, code: e.code });
            return;
          }
          reject(this.translateSshError(e, stderr));
          return;
        }
        resolve({ stdout, stderr, code: 0 });
      });

      if (opts.input != null) {
        child.stdin?.end(opts.input);
      }
    });
  }

  private translateSshError(
    err: Error & { code?: number | string; signal?: string; killed?: boolean },
    stderr: string,
  ): Error {
    const trimmed = stderr.trim();
    const lower = trimmed.toLowerCase();

    if (err.signal === 'SIGTERM' || (err as { killed?: boolean }).killed) {
      return new RemoteSshError(
        this.host,
        trimmed,
        `ssh ${this.host}: connection timed out (>10s) — is the host reachable? ${SSH_CONFIG_HINT}`,
      );
    }

    if (lower.includes('could not resolve hostname')) {
      return new RemoteSshError(
        this.host,
        trimmed,
        `ssh: could not resolve hostname "${this.host}". ${SSH_CONFIG_HINT}`,
      );
    }

    if (lower.includes('permission denied')) {
      return new RemoteSshError(
        this.host,
        trimmed,
        `ssh ${this.host}: permission denied (check SSH keys / agent / OS Login user). ${SSH_CONFIG_HINT}`,
      );
    }

    if (lower.includes('host key verification failed')) {
      return new RemoteSshError(
        this.host,
        trimmed,
        `ssh ${this.host}: host key verification failed — accept the host key once (\`ssh ${this.host}\`) and retry. ${SSH_CONFIG_HINT}`,
      );
    }

    if (lower.includes('proxycommand') || lower.includes('kex_exchange_identification')) {
      return new RemoteSshError(
        this.host,
        trimmed,
        `ssh ${this.host}: proxy/transport failure — ${trimmed || 'see stderr'}. ${SSH_CONFIG_HINT}`,
      );
    }

    if (
      lower.includes('connection refused') ||
      lower.includes('connection timed out') ||
      lower.includes('connection closed by') ||
      lower.includes('no route to host') ||
      lower.includes('network is unreachable') ||
      lower.includes('operation timed out') ||
      lower.includes('lost connection') ||
      lower.includes('broken pipe')
    ) {
      return new RemoteSshError(
        this.host,
        trimmed,
        `ssh ${this.host}: cannot connect — ${trimmed || 'host unreachable'}. ${SSH_CONFIG_HINT}`,
      );
    }

    // Exit 255 or any other un-categorized transport noise — surface stderr
    // verbatim plus the SSH config hint so users can self-diagnose.
    if (err.code === 255) {
      return new RemoteSshError(
        this.host,
        trimmed,
        `ssh ${this.host}: transport failure (exit 255) — ${trimmed || 'no stderr'}. ${SSH_CONFIG_HINT}`,
      );
    }

    const baseMsg = err.message || String(err);
    return new RemoteSshError(
      this.host,
      trimmed,
      trimmed
        ? `ssh ${this.host} failed: ${trimmed}`
        : `ssh ${this.host} failed: ${baseMsg}`,
    );
  }

  // ── Preflight ──────────────────────────────────────────────────────

  /**
   * Verify the remote has tmux and the requested agent binary. Throws with
   * a clear message if either is missing.
   */
  async preflight(agentBinary: string): Promise<void> {
    const cmd = `command -v tmux >/dev/null 2>&1 && command -v ${posixQuote(agentBinary)} >/dev/null 2>&1`;
    const { code, stderr } = await this.runRemote(cmd, {
      timeoutMs: SSH_PREFLIGHT_TIMEOUT_MS,
      allowNonZeroExit: true,
    });
    if (code !== 0) {
      throw new RemoteSshError(
        this.host,
        stderr,
        `Remote preflight failed on ${this.host}: tmux or agent "${agentBinary}" not found on PATH. Install both on the remote and retry.`,
      );
    }
  }

  /** Return true if `<repoPath>/.git` exists on the remote. */
  async repoExists(repoPath: string): Promise<boolean> {
    const cmd = `test -d ${posixQuote(`${repoPath}/.git`)} || test -f ${posixQuote(`${repoPath}/.git`)}`;
    const { code } = await this.runRemote(cmd, {
      timeoutMs: SSH_PREFLIGHT_TIMEOUT_MS,
      allowNonZeroExit: true,
    });
    return code === 0;
  }

  // ── Worktree management on the remote ──────────────────────────────

  /**
   * `git -C <repoPath> worktree add <worktreePath> -b <branch>` (or attach to
   * an existing branch via `--checkout`). Returns the absolute worktree path.
   */
  async addWorktree(
    repoPath: string,
    branch: string,
    worktreePath: string,
    baseBranch?: string,
  ): Promise<void> {
    const args = [
      'worktree', 'add',
      posixQuote(worktreePath),
      '-b', posixQuote(branch),
    ];
    if (baseBranch) {
      args.push(posixQuote(baseBranch));
    }
    const cmd = `git -C ${posixQuote(repoPath)} ${args.join(' ')}`;
    const { code, stderr } = await this.runRemote(cmd, { allowNonZeroExit: true });
    if (code !== 0) {
      throw new RemoteSshError(
        this.host,
        stderr,
        `Remote git worktree add failed on ${this.host}: ${stderr.trim() || 'unknown error'}`,
      );
    }
  }

  /**
   * Remove a remote worktree with `git worktree remove --force`.
   *
   * Inspects the command result rather than swallowing non-zero exits — the
   * caller (`SessionManager.deleteRemoteWorker`) relies on this throwing to
   * surface its manual-cleanup warning and refuse to drop the registry entry
   * when cleanup actually failed.
   *
   * Tolerates the one benign non-zero case: "is not a working tree" — that
   * means the worktree is already gone, which is the desired end state of
   * this operation. Anything else (locked, validation failure, partial fs
   * removal, etc.) throws with stderr attached so the caller can show it.
   */
  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    const cmd = `git -C ${posixQuote(repoPath)} worktree remove --force ${posixQuote(worktreePath)}`;
    const { code, stderr } = await this.runRemote(cmd, { allowNonZeroExit: true });
    if (code === 0) return;
    if (isBenignWorktreeRemoveStderr(stderr)) {
      // Worktree already gone on the remote — desired state already achieved.
      return;
    }
    const trimmed = stderr.trim();
    throw new Error(
      `git worktree remove --force ${worktreePath} failed on ${this.host} (exit ${code}): ${trimmed || '(no stderr)'}`,
    );
  }

  async deleteBranch(repoPath: string, branch: string): Promise<void> {
    const cmd = `git -C ${posixQuote(repoPath)} branch -D ${posixQuote(branch)}`;
    await this.runRemote(cmd, { allowNonZeroExit: true });
  }

  // ── tmux session management on the remote ─────────────────────────

  /**
   * `tmux new-session -d -s <name> -c <cwd> <command>`. The agent command is
   * passed positionally so tmux invokes it as the pane's main process.
   */
  async newSession(sessionName: string, workdir: string, command: string): Promise<void> {
    const remoteCmd = [
      'tmux', 'new-session', '-d',
      '-s', posixQuote(sessionName),
      '-c', posixQuote(workdir),
      posixQuote(command),
    ].join(' ');
    await this.runRemote(remoteCmd);
  }

  async killSession(sessionName: string): Promise<void> {
    const cmd = `tmux kill-session -t ${posixQuote(sessionName)}`;
    await this.runRemote(cmd, { allowNonZeroExit: true });
  }

  async hasSession(sessionName: string): Promise<boolean> {
    const cmd = `tmux has-session -t ${posixQuote(sessionName)}`;
    const { code } = await this.runRemote(cmd, { allowNonZeroExit: true });
    return code === 0;
  }

  async listSessions(): Promise<RemoteTmuxSession[]> {
    const cmd = `tmux list-sessions -F '#{session_name}|||#{session_windows}|||#{session_attached}'`;
    const { code, stdout, stderr } = await this.runRemote(cmd, { allowNonZeroExit: true });
    if (code !== 0) {
      // No tmux server → empty list. Anything else bubbles up.
      if (/no server running|no such file/i.test(stderr)) return [];
      throw new RemoteSshError(this.host, stderr, `Remote tmux list-sessions failed: ${stderr.trim()}`);
    }
    return stdout.split('\n').filter(l => l.trim()).map(line => {
      const [name, windows, attached] = line.split('|||');
      return {
        name,
        windows: parseInt(windows, 10) || 1,
        attached: attached === '1',
      };
    });
  }

  async capturePane(sessionName: string, lines?: number): Promise<string> {
    const startArg = lines && lines > 0 ? `-S -${lines}` : '';
    const cmd = `tmux capture-pane -t ${posixQuote(sessionName)} -p ${startArg}`.trim();
    const { stdout } = await this.runRemote(cmd);
    return stdout;
  }

  async sendKeys(sessionName: string, keys: string): Promise<void> {
    const cmd = `tmux send-keys -t ${posixQuote(sessionName)} ${posixQuote(keys)} Enter`;
    await this.runRemote(cmd);
  }

  /**
   * Send a message to the agent prompt safely:
   *   1. base64-encode locally
   *   2. ship via the remote command string (single-quoted, base64 charset is safe)
   *   3. decode + tmux load-buffer + paste-buffer + Enter on the remote
   *
   * This mirrors PR #122's local behaviour (load-buffer/paste-buffer + separate
   * Enter) so long or special-character messages don't lose their trailing Enter.
   */
  async sendMessage(sessionName: string, message: string): Promise<void> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bufferName = `hydra-send-${suffix}`;
    const tmpFile = `/tmp/hydra-send-${suffix}`;
    const b64 = Buffer.from(message, 'utf-8').toString('base64');

    // The remote command is a heredoc-free shell pipeline. base64 chars are
    // [A-Za-z0-9+/=], so embedding them in single quotes is shell-safe.
    const remoteCmd = [
      `set -e`,
      `printf %s ${posixQuote(b64)} | base64 -d > ${posixQuote(tmpFile)}`,
      `tmux load-buffer -b ${posixQuote(bufferName)} ${posixQuote(tmpFile)}`,
      `rm -f ${posixQuote(tmpFile)}`,
      `tmux paste-buffer -b ${posixQuote(bufferName)} -t ${posixQuote(sessionName)} -d`,
      `sleep 0.1`,
      `tmux send-keys -t ${posixQuote(sessionName)} Enter`,
    ].join('; ');

    await this.runRemote(remoteCmd);
  }

  /**
   * Run an arbitrary shell command on the remote with a SHORT timeout, used
   * by callers who need a "live data probe" (e.g. the VS Code panel render
   * loop that wants to show actual git status / tmux liveness without
   * blocking the UI on a slow ssh).
   *
   * Returns the raw command result on success, or `null` on ANY failure
   * (timeout, transport error, command exit error). The caller is expected
   * to fall back to last-known data on `null` — no exception ever escapes.
   *
   * NOTE on cost: every call pays one full SSH handshake (~500ms typical,
   * worse on cold IAP tunnels). User-configured ControlMaster brings this
   * down to ~10ms but Hydra deliberately doesn't auto-configure it (out of
   * scope for #129 phase 1; tracked as a phase-2 follow-up).
   */
  async probe(
    remoteCmd: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ stdout: string; stderr: string; code: number } | null> {
    const timeoutMs = opts.timeoutMs ?? 1500;
    try {
      return await this.runRemote(remoteCmd, { timeoutMs, allowNonZeroExit: true });
    } catch {
      return null;
    }
  }

  /**
   * Build the local shell command that, when exec'd, attaches to the remote
   * tmux session interactively. Returns argv for `child_process.spawn`.
   *
   * Caller must spawn this with stdio: 'inherit' and pass the user's TTY.
   */
  buildAttachArgv(sessionName: string): { command: string; args: string[] } {
    return {
      command: 'ssh',
      args: [
        '-t',
        '-o', 'ServerAliveInterval=10',
        '-o', 'ServerAliveCountMax=3',
        this.host,
        `tmux attach -t ${posixQuote(sessionName)}`,
      ],
    };
  }
}
