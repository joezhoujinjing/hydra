import { Command } from 'commander';
import { resolve } from 'path';
import { type OutputOpts, outputResult } from '../output';
import { SessionManager, type WorkerInfo, type CopilotInfo } from '../../core/sessionManager';
import { TmuxBackendCore } from '../../core/tmux';

interface WhoamiResult {
  role: 'worker' | 'copilot';
  sessionName: string;
  displayName: string;
  agent: string;
  sessionId: string | null;
  workdir: string;
  status: string;
  // Worker-specific
  workerId?: number;
  branch?: string;
  repo?: string;
  copilotSessionName?: string | null;
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Report the copilot/worker/worktree context of the current working directory')
    .action(async () => {
      const globalOpts = program.opts() as OutputOpts;
      const cwd = resolve(process.cwd());

      const backend = new TmuxBackendCore();
      const sm = new SessionManager(backend);
      const state = await sm.sync();

      // Match cwd against worker workdirs
      for (const worker of Object.values(state.workers)) {
        if (cwd === resolve(worker.workdir) || cwd.startsWith(resolve(worker.workdir) + '/')) {
          const data: WhoamiResult = {
            role: 'worker',
            sessionName: worker.sessionName,
            displayName: worker.displayName,
            agent: worker.agent,
            sessionId: worker.sessionId,
            workdir: worker.workdir,
            status: worker.status,
            workerId: worker.workerId,
            branch: worker.branch,
            repo: worker.repo,
            copilotSessionName: worker.copilotSessionName,
          };

          outputResult(data as unknown as Record<string, unknown>, globalOpts, () => {
            prettyPrintWorker(worker);
          });
          return;
        }
      }

      // Match cwd against copilot workdirs
      for (const copilot of Object.values(state.copilots)) {
        if (cwd === resolve(copilot.workdir) || cwd.startsWith(resolve(copilot.workdir) + '/')) {
          const data: WhoamiResult = {
            role: 'copilot',
            sessionName: copilot.sessionName,
            displayName: copilot.displayName,
            agent: copilot.agent,
            sessionId: copilot.sessionId,
            workdir: copilot.workdir,
            status: copilot.status,
          };

          outputResult(data as unknown as Record<string, unknown>, globalOpts, () => {
            prettyPrintCopilot(copilot);
          });
          return;
        }
      }

      // Not in a hydra session
      if (globalOpts.json) {
        console.log(JSON.stringify({ role: null, message: 'Not running inside a Hydra session.' }));
      } else if (!globalOpts.quiet) {
        console.log('Not running inside a Hydra session.');
      }
    });
}

function prettyPrintWorker(worker: WorkerInfo): void {
  console.log('');
  console.log(`  Role:        worker`);
  console.log(`  Session:     ${worker.sessionName}`);
  console.log(`  Worker #:    ${worker.workerId}`);
  console.log(`  Branch:      ${worker.branch}`);
  console.log(`  Repo:        ${worker.repo}`);
  console.log(`  Agent:       ${worker.agent}`);
  console.log(`  Session ID:  ${worker.sessionId ?? '(none)'}`);
  console.log(`  Copilot:     ${worker.copilotSessionName ?? '(none)'}`);
  console.log(`  Workdir:     ${worker.workdir}`);
  console.log(`  Status:      ${worker.status}`);
  console.log('');
}

function prettyPrintCopilot(copilot: CopilotInfo): void {
  console.log('');
  console.log(`  Role:        copilot`);
  console.log(`  Session:     ${copilot.sessionName}`);
  console.log(`  Agent:       ${copilot.agent}`);
  console.log(`  Session ID:  ${copilot.sessionId ?? '(none)'}`);
  console.log(`  Workdir:     ${copilot.workdir}`);
  console.log(`  Status:      ${copilot.status}`);
  console.log('');
}
