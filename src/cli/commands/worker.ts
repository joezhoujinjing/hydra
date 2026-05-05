import * as path from 'path';
import { Command } from 'commander';
import { TmuxBackendCore } from '../../core/tmux';
import { SessionManager } from '../../core/sessionManager';
import { getRepoRootFromPath, localBranchExists } from '../../core/git';
import { toCanonicalPath } from '../../core/path';
import { outputResult, outputError, type OutputOpts } from '../output';

function expandPath(p: string): string {
  return toCanonicalPath(p) || path.resolve(p);
}

export function registerWorkerCommands(program: Command): void {
  const worker = program
    .command('worker')
    .description('Manage Hydra workers');

  worker
    .command('create')
    .description('Create a new worker')
    .requiredOption('--repo <path>', 'Path to the repository')
    .requiredOption('--branch <name>', 'Branch name')
    .option('--agent <type>', 'Agent type (claude, codex, gemini)', 'claude')
    .option('--base <branch>', 'Base branch override')
    .option('--task <prompt>', 'Task prompt for the agent')
    .option('--task-file <path>', 'Path to a file containing the task description')
    .option('--copilot <session>', 'Session ID of the parent copilot')
    .action(async (opts: {
      repo: string;
      branch: string;
      agent: string;
      base?: string;
      task?: string;
      taskFile?: string;
      copilot?: string;
    }) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const repoPath = expandPath(opts.repo);
        const repoRoot = await getRepoRootFromPath(repoPath);

        // Check if branch exists before create to detect resume
        const branchExisted = await localBranchExists(repoRoot, opts.branch);

        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);

        const { workerInfo, postCreatePromise } = await sm.createWorker({
          repoRoot,
          branchName: opts.branch,
          agentType: opts.agent,
          baseBranchOverride: opts.base,
          task: opts.task,
          taskFile: opts.taskFile,
          copilotSessionName: opts.copilot,
        });

        const status = branchExisted ? 'exists' : 'created';

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
        const output = await backend.capturePane(sessionName, lines);

        outputResult(
          { session: sessionName, lines, output },
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
            await backend.sendMessage(worker.sessionName, message);
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
          await backend.sendMessage(session, message);

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
}
