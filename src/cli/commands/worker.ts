import { spawn } from 'child_process';
import { Command } from 'commander';
import { TmuxBackendCore } from '../../core/tmux';
import { SessionManager } from '../../core/sessionManager';
import { getRepoRootFromPath, localBranchExists } from '../../core/git';
import { resolveAgentSessionFile } from '../../core/path';
import { resolveRepoInput } from '../../core/repoRegistry';
import { RemoteTmuxBackend } from '../../core/remoteTmux';
import { DEFAULT_AGENT_COMMANDS } from '../../core/agentConfig';
import { outputResult, outputError, type OutputOpts } from '../output';
import { detectCurrentTmuxIdentity, detectIdentity, getWorkerCreationBlockedMessage } from '../identity';
import { getTelemetry, normalizeAgentForTelemetry } from '../../core/telemetry';

/**
 * Resolve a worker by session name. Returns whether it's remote and (if so)
 * a backend handle bound to its host.
 */
async function resolveWorker(sm: SessionManager, sessionName: string): Promise<{
  isRemote: boolean;
  remote?: RemoteTmuxBackend;
  host?: string;
}> {
  const worker = await sm.getWorker(sessionName);
  if (worker?.remote) {
    return { isRemote: true, remote: new RemoteTmuxBackend(worker.remote.host), host: worker.remote.host };
  }
  return { isRemote: false };
}

export function registerWorkerCommands(program: Command): void {
  const worker = program
    .command('worker')
    .description('Manage Hydra workers');

  worker
    .command('create')
    .description('Create a new worker')
    .requiredOption('--repo <path>', 'Path to the repository (local; or remote path on the SSH host when --remote is set)')
    .requiredOption('--branch <name>', 'Branch name')
    .option('--agent <type>', 'Agent type (claude, codex, gemini)', 'claude')
    .option('--base <branch>', 'Base branch override')
    .option('--task <prompt>', 'Task prompt for the agent')
    .option('--task-file <path>', 'Path to a file containing the task description')
    .option('--copilot <session>', 'Session name of the parent copilot (auto-detected if inside a copilot)')
    .option('--notify-copilot', 'Notify parent copilot when worker completes (default: true)', true)
    .option('--no-notify-copilot', 'Disable completion notification to parent copilot')
    .option('--remote <ssh-host>', 'SSH alias of a remote host to run the worker on. The repo at --repo must already exist on that host.')
    .action(async (opts: {
      repo: string;
      branch: string;
      agent: string;
      base?: string;
      task?: string;
      taskFile?: string;
      copilot?: string;
      notifyCopilot: boolean;
      remote?: string;
    }) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const identity = await detectCurrentTmuxIdentity() || detectIdentity();
        if (identity?.role === 'worker') {
          throw new Error(getWorkerCreationBlockedMessage(identity));
        }

        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);

        // Auto-detect parent copilot if --copilot not explicitly set
        let copilotSessionName = opts.copilot;
        if (!copilotSessionName) {
          if (identity?.role === 'copilot') {
            copilotSessionName = identity.sessionName;
          }
        }

        // ── Remote dispatch ──
        if (opts.remote) {
          if (opts.task || opts.taskFile) {
            // Initial task injection on remote isn't part of the MVP — Phase 2
            // (sendInitialPrompt) requires the local lifecycle wait+capture, which
            // we don't replicate over SSH. User can `hydra worker send <session> ...`
            // after creation to send a follow-up prompt.
            throw new Error('--task and --task-file are not supported with --remote in the MVP. Send the prompt with `hydra worker send <session>` after create.');
          }
          // Reject ~ — it's not shell-expanded on the remote (the path goes
          // through posixQuote and lands inside single quotes), so a literal
          // `~` directory would silently appear under the remote cwd. Force
          // users to give an absolute path so the failure is loud, not weird.
          if (opts.repo.startsWith('~')) {
            throw new Error(
              `--repo with --remote must be an absolute path on the remote host. ` +
              `\`~\` is not shell-expanded over SSH (Hydra single-quotes the path), so \`${opts.repo}\` would create a literal "~" directory. ` +
              `Use the absolute form, e.g. /home/<user>/${opts.repo.replace(/^~\/?/, '')}.`,
            );
          }
          if (!opts.repo.startsWith('/')) {
            throw new Error(
              `--repo with --remote must be an absolute path on the remote host (got "${opts.repo}"). ` +
              `Relative paths can't be resolved without knowing the remote cwd.`,
            );
          }

          // --notify-copilot is intentionally NOT forwarded to createRemoteWorker:
          // the completion-hook system writes hook scripts into the worktree's
          // settings dir (claude/codex/gemini) and arms via a local tmux pane
          // event. Both pieces are local-only — cross-host hook delivery is
          // deferred to #129 phase 2. We silently ignore the flag for remote
          // workers (default is true; throwing on the default would be hostile).
          const agentBinary = DEFAULT_AGENT_COMMANDS[opts.agent] || opts.agent;
          const workerInfo = await sm.createRemoteWorker({
            host: opts.remote,
            remoteRepoPath: opts.repo,
            branchName: opts.branch,
            agentType: opts.agent,
            agentBinary,
            baseBranch: opts.base,
            copilotSessionName,
          });

          getTelemetry().capture('worker_created', {
            agent: normalizeAgentForTelemetry(workerInfo.agent),
            is_remote: true,
          });

          outputResult(
            {
              status: 'created',
              session: workerInfo.sessionName,
              branch: workerInfo.branch,
              agent: workerInfo.agent,
              workdir: workerInfo.workdir,
              remote: { host: opts.remote },
            },
            globalOpts,
            () => {
              console.log(`Worker created (remote): ${workerInfo.sessionName}`);
              console.log(`  Host:     ${opts.remote}`);
              console.log(`  Branch:   ${workerInfo.branch}`);
              console.log(`  Agent:    ${workerInfo.agent}`);
              console.log(`  Workdir:  ${workerInfo.workdir}`);
              console.log(`  Session:  ${workerInfo.tmuxSession}`);
            },
          );
          return;
        }

        // ── Local dispatch ──
        // resolveRepoInput handles short-form (<owner>/<name>), absolute paths,
        // and explicit relative paths (`.`, `./foo`, `../foo`). Decides
        // managed-ness against the resolved (pre-rev-parse) path so the macOS
        // /var → /private/var realpath flip in `git rev-parse --show-toplevel`
        // doesn't defeat the comparison against ~/.hydra/repos/.
        const { path: repoPath, isManaged: isManagedRepo } = resolveRepoInput(opts.repo);
        const repoRoot = await getRepoRootFromPath(repoPath);

        // Check if branch exists before create to detect resume
        const branchExisted = await localBranchExists(repoRoot, opts.branch);

        const { workerInfo, postCreatePromise } = await sm.createWorker({
          repoRoot,
          branchName: opts.branch,
          agentType: opts.agent,
          baseBranchOverride: opts.base,
          task: opts.task,
          taskFile: opts.taskFile,
          copilotSessionName,
          notifyCopilot: opts.notifyCopilot,
          fetchMode: isManagedRepo ? 'required' : 'best-effort',
        });

        const status = branchExisted ? 'exists' : 'created';

        getTelemetry().capture(
          branchExisted ? 'worker_resumed' : 'worker_created',
          { agent: normalizeAgentForTelemetry(workerInfo.agent) },
        );

        outputResult(
          {
            status,
            session: workerInfo.sessionName,
            branch: workerInfo.branch,
            agent: workerInfo.agent,
            workdir: workerInfo.workdir,
          },
          globalOpts,
          () => {
            const label = branchExisted ? 'Worker resumed' : 'Worker created';
            console.log(`${label}: ${workerInfo.sessionName}`);
            console.log(`  Branch:   ${workerInfo.branch}`);
            console.log(`  Agent:    ${workerInfo.agent}`);
            console.log(`  Workdir:  ${workerInfo.workdir}`);
            console.log(`  Session:  ${workerInfo.tmuxSession}`);
          },
        );

        // Wait for delayed Enter (Claude trust prompt) before exiting
        await postCreatePromise;
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  worker
    .command('delete <session>')
    .description('Delete a worker (kill session + remove worktree + delete branch)')
    .action(async (sessionName: string) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        await sm.deleteWorker(sessionName);

        getTelemetry().capture('worker_deleted');

        outputResult(
          { status: 'deleted', session: sessionName },
          globalOpts,
          () => console.log(`Deleted worker: ${sessionName}`),
        );
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  worker
    .command('stop <session>')
    .description('Stop a worker (kill tmux session, keep worktree)')
    .action(async (sessionName: string) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        await sm.stopWorker(sessionName);

        outputResult(
          { status: 'stopped', session: sessionName },
          globalOpts,
          () => console.log(`Stopped worker: ${sessionName}`),
        );
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  worker
    .command('start <session>')
    .description('Start a stopped worker')
    .option('--agent <type>', 'Agent type override')
    .action(async (sessionName: string, opts: { agent?: string }) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const { workerInfo, postCreatePromise } = await sm.startWorker(sessionName, opts.agent);

        outputResult(
          {
            status: 'started',
            session: workerInfo.sessionName,
            agent: workerInfo.agent,
            workdir: workerInfo.workdir,
          },
          globalOpts,
          () => {
            console.log(`Started worker: ${workerInfo.sessionName}`);
            console.log(`  Agent:  ${workerInfo.agent}`);
            console.log(`  Workdir: ${workerInfo.workdir}`);
          },
        );

        await postCreatePromise;
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  worker
    .command('rename <session> <new-branch>')
    .description('Rename a worker (branch, worktree, and session)')
    .action(async (sessionName: string, newBranch: string) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const worker = await sm.renameWorker(sessionName, newBranch);

        outputResult(
          {
            status: 'renamed',
            oldSession: sessionName,
            session: worker.sessionName,
            branch: worker.branch,
            workdir: worker.workdir,
          },
          globalOpts,
          () => {
            console.log(`Renamed worker: ${sessionName} -> ${worker.sessionName}`);
            console.log(`  Branch:   ${worker.branch}`);
            console.log(`  Workdir:  ${worker.workdir}`);
          },
        );
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  worker
    .command('logs <session>')
    .description('Read worker terminal output')
    .option('--lines <n>', 'Number of lines to capture', '50')
    .action(async (sessionName: string, opts: { lines: string }) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const lines = parseInt(opts.lines, 10);
        if (isNaN(lines) || lines <= 0) {
          throw new Error('Invalid --lines value: must be a positive integer');
        }

        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const worker = await sm.getWorker(sessionName);
        const remote = worker?.remote ? new RemoteTmuxBackend(worker.remote.host) : undefined;

        const output = remote
          ? await remote.capturePane(sessionName, lines)
          : await backend.capturePane(sessionName, lines);

        // sessionFile resolves a LOCAL agent transcript (e.g. ~/.claude/projects/...).
        // For remote workers the transcript lives on the remote host, so we surface
        // null — exposing a non-existent local path would only mislead callers.
        const sessionFile = worker && !worker.remote
          ? resolveAgentSessionFile(worker.agent, worker.workdir, worker.sessionId)
          : null;

        outputResult(
          { session: sessionName, lines, output, sessionId: worker?.sessionId ?? null, sessionFile },
          globalOpts,
          () => process.stdout.write(output),
        );
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  worker
    .command('send <session> <message>')
    .description('Send a message to a worker')
    .option('--all', 'Broadcast to all running workers (session arg is the message)')
    .action(async (sessionOrMessage: string, messageOrUndefined: string, opts: { all?: boolean }) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const identity = detectIdentity();

        if (opts.all) {
          // When --all, first positional is the message, second is undefined/empty
          const message = sessionOrMessage;
          const sm = new SessionManager(backend);
          const state = await sm.sync();
          const running = Object.values(state.workers).filter(w => w.status === 'running');

          if (running.length === 0) {
            throw new Error('No running workers found');
          }

          const sent: string[] = [];
          for (const worker of running) {
            if (worker.remote) {
              // Remote workers: skip completion-hook arm. Hook delivery
              // assumes a local tmux socket, which we don't have for remote
              // sessions — cross-host hook is phase-2 (#129).
              const remote = new RemoteTmuxBackend(worker.remote.host);
              await remote.sendMessage(worker.sessionName, message);
            } else {
              if (identity?.role === 'copilot' && worker.copilotSessionName === identity.sessionName) {
                sm.armCompletionNotification(worker.sessionName);
              }
              await backend.sendMessage(worker.sessionName, message);
            }
            sent.push(worker.sessionName);
          }

          outputResult(
            { status: 'sent', sessions: sent, message },
            globalOpts,
            () => {
              const truncated = message.length > 60 ? message.substring(0, 60) + '...' : message;
              for (const s of sent) {
                console.log(`Sent to ${s}: ${truncated}`);
              }
            },
          );
        } else {
          const session = sessionOrMessage;
          const message = messageOrUndefined;
          const sm = new SessionManager(backend);
          const worker = await sm.getWorker(session);
          if (worker?.remote) {
            // Remote: skip completion-hook arm; route through SSH.
            const remote = new RemoteTmuxBackend(worker.remote.host);
            await remote.sendMessage(session, message);
          } else {
            if (identity?.role === 'copilot' && worker?.copilotSessionName === identity.sessionName) {
              sm.armCompletionNotification(session);
            }
            await backend.sendMessage(session, message);
          }

          outputResult(
            { status: 'sent', session, message },
            globalOpts,
            () => {
              const truncated = message.length > 60 ? message.substring(0, 60) + '...' : message;
              console.log(`Sent to ${session}: ${truncated}`);
            },
          );
        }
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  worker
    .command('attach <session>')
    .description('Attach to a worker tmux session in the foreground (interactive). For remote workers, runs `ssh -t <host> tmux attach`.')
    .action(async (sessionName: string) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const { isRemote, remote, host } = await resolveWorker(sm, sessionName);

        if (isRemote) {
          const { command, args } = remote!.buildAttachArgv(sessionName);
          if (!process.stdout.isTTY) {
            throw new Error(`worker attach requires a TTY (cannot pipe). For remote logs, use \`hydra worker logs ${sessionName}\` instead.`);
          }
          if (globalOpts.json) {
            // For --json callers we don't actually attach (can't), just describe
            // the command they'd need to run.
            outputResult(
              { status: 'attach', session: sessionName, remote: { host }, command: [command, ...args].join(' ') },
              globalOpts,
              () => undefined,
            );
            return;
          }
          const child = spawn(command, args, { stdio: 'inherit' });
          await new Promise<void>((resolve, reject) => {
            child.on('error', reject);
            child.on('exit', code => {
              process.exit(code ?? 0);
              resolve();
            });
          });
          return;
        }

        // Local: spawn `tmux attach -t <session>`
        if (!process.stdout.isTTY) {
          throw new Error(`worker attach requires a TTY (cannot pipe). Use \`hydra worker logs ${sessionName}\` for non-interactive output.`);
        }
        const child = spawn('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
        await new Promise<void>((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', code => {
            process.exit(code ?? 0);
            resolve();
          });
        });
      } catch (error) {
        outputError(error, globalOpts);
      }
    });
}
