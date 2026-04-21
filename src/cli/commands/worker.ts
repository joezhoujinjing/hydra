import * as path from 'path';
import { Command } from 'commander';
import { TmuxBackendCore } from '../../core/tmux';
import { SessionManager } from '../../core/sessionManager';
import { getRepoRootFromPath } from '../../core/git';
import { toCanonicalPath } from '../../core/path';

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
    .option('--agent <type>', 'Agent type (claude, codex, gemini, aider)', 'claude')
    .option('--base <branch>', 'Base branch override')
    .option('--task <prompt>', 'Task prompt for the agent')
    .action(async (opts: {
      repo: string;
      branch: string;
      agent: string;
      base?: string;
      task?: string;
    }) => {
      try {
        const repoPath = expandPath(opts.repo);
        const repoRoot = await getRepoRootFromPath(repoPath);

        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);

        const { workerInfo, postCreatePromise } = await sm.createWorker({
          repoRoot,
          branchName: opts.branch,
          agentType: opts.agent,
          baseBranchOverride: opts.base,
          task: opts.task,
        });

        console.log(`Worker created: ${workerInfo.sessionName}`);
        console.log(`  Branch:   ${workerInfo.branch}`);
        console.log(`  Agent:    ${workerInfo.agent}`);
        console.log(`  Workdir:  ${workerInfo.workdir}`);
        console.log(`  Session:  ${workerInfo.tmuxSession}`);

        // Wait for delayed Enter (Claude trust prompt) before exiting
        await postCreatePromise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  worker
    .command('delete <session>')
    .description('Delete a worker (kill session + remove worktree + delete branch)')
    .action(async (sessionName: string) => {
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        await sm.deleteWorker(sessionName);
        console.log(`Deleted worker: ${sessionName}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  worker
    .command('stop <session>')
    .description('Stop a worker (kill tmux session, keep worktree)')
    .action(async (sessionName: string) => {
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        await sm.stopWorker(sessionName);
        console.log(`Stopped worker: ${sessionName}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  worker
    .command('start <session>')
    .description('Start a stopped worker')
    .option('--agent <type>', 'Agent type override')
    .action(async (sessionName: string, opts: { agent?: string }) => {
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const { workerInfo, postCreatePromise } = await sm.startWorker(sessionName, opts.agent);
        console.log(`Started worker: ${workerInfo.sessionName}`);
        console.log(`  Agent:  ${workerInfo.agent}`);
        console.log(`  Workdir: ${workerInfo.workdir}`);

        await postCreatePromise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
