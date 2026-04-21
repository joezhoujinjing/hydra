import { Command } from 'commander';
import { TmuxBackendCore } from '../../core/tmux';
import { SessionManager } from '../../core/sessionManager';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List all Hydra copilots and workers')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const state = await sm.sync();

        if (opts.json) {
          console.log(JSON.stringify(state, null, 2));
          return;
        }

        // Pretty-print copilots
        const copilots = Object.values(state.copilots);
        if (copilots.length > 0) {
          console.log('\nCopilots:');
          console.log('─'.repeat(60));
          for (const c of copilots) {
            const statusIcon = c.status === 'running' ? '●' : '○';
            const attached = c.attached ? ' (attached)' : '';
            const name = c.sessionName || c.tmuxSession;
            console.log(`  ${statusIcon} ${name}  [${c.agent}]${attached}`);
            if (c.workdir) console.log(`    workdir: ${c.workdir}`);
          }
        } else {
          console.log('\nNo copilots running.');
        }

        // Pretty-print workers
        const workers = Object.values(state.workers);
        if (workers.length > 0) {
          console.log('\nWorkers:');
          console.log('─'.repeat(60));

          // Group by repo
          const byRepo = new Map<string, typeof workers>();
          for (const w of workers) {
            const key = w.repo || 'unknown';
            const group = byRepo.get(key) || [];
            group.push(w);
            byRepo.set(key, group);
          }

          for (const [repo, repoWorkers] of byRepo) {
            console.log(`  ${repo}:`);
            for (const w of repoWorkers) {
              const statusIcon = w.status === 'running' ? '●' : '○';
              const attached = w.attached ? ' (attached)' : '';
              const branch = w.branch ? ` (${w.branch})` : '';
              const name = w.sessionName || w.tmuxSession;
              console.log(`    ${statusIcon} ${name}${branch}  [${w.agent}]${attached}`);
              if (w.workdir) console.log(`      workdir: ${w.workdir}`);
            }
          }
        } else {
          console.log('\nNo workers.');
        }

        console.log('');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
