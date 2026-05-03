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
    .action(async (opts: {
      repo: string;
      branch: string;
      agent: string;
      base?: string;
      task?: string;
      taskFile?: string;
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
}
