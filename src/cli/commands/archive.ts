import { Command } from 'commander';
import { TmuxBackendCore } from '../../core/tmux';
import { SessionManager } from '../../core/sessionManager';
import { outputResult, outputError, type OutputOpts } from '../output';

export function registerArchiveCommands(program: Command): void {
  const archive = program
    .command('archive')
    .description('View and manage archived (deleted) sessions');

  archive
    .command('list')
    .description('List all archived sessions')
    .action(async () => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const entries = sm.listArchived();

        const data = {
          entries: entries.map(e => ({
            sessionName: e.sessionName,
            type: e.type,
            agentSessionId: e.agentSessionId,
            archivedAt: e.archivedAt,
            agent: e.data.agent,
            branch: e.type === 'worker' ? (e.data as { branch?: string }).branch || null : null,
          })),
          count: entries.length,
        };

        outputResult(data, globalOpts, () => {
          if (entries.length === 0) {
            console.log('No archived sessions.');
            return;
          }

          console.log('\nArchived Sessions:');
          console.log('\u2500'.repeat(60));
          for (const entry of entries) {
            const branch = entry.type === 'worker'
              ? ` (${(entry.data as { branch?: string }).branch || 'unknown'})`
              : '';
            console.log(`  [${entry.type}] ${entry.sessionName}${branch}`);
            console.log(`    Agent:      ${entry.data.agent}`);
            console.log(`    Session ID: ${entry.agentSessionId || 'none'}`);
            console.log(`    Archived:   ${entry.archivedAt}`);
          }
          console.log('');
        });
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  archive
    .command('view <session>')
    .description('View full metadata for an archived session')
    .action(async (sessionName: string) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const entry = sm.getArchived(sessionName);

        if (!entry) {
          throw new Error(`Archived session "${sessionName}" not found`);
        }

        outputResult(entry as unknown as Record<string, unknown>, globalOpts, () => {
          console.log(`\nArchived ${entry.type}: ${entry.sessionName}`);
          console.log('\u2500'.repeat(60));
          console.log(`  Type:            ${entry.type}`);
          console.log(`  Agent Session ID: ${entry.agentSessionId || 'none'}`);
          console.log(`  Archived At:     ${entry.archivedAt}`);
          console.log('');
          console.log('  Metadata:');
          for (const [key, value] of Object.entries(entry.data)) {
            if (value != null) {
              console.log(`    ${key}: ${value}`);
            }
          }
          console.log('');
        });
      } catch (error) {
        outputError(error, globalOpts);
      }
    });

  archive
    .command('restore <session>')
    .description('Restore a worker or copilot from the archive')
    .action(async (sessionName: string) => {
      const globalOpts = program.opts() as OutputOpts;
      try {
        const backend = new TmuxBackendCore();
        const sm = new SessionManager(backend);
        const entry = sm.getArchived(sessionName);

        if (!entry) {
          throw new Error(`Archived session "${sessionName}" not found`);
        }

        if (entry.type === 'worker') {
          const { workerInfo, postCreatePromise } = await sm.restoreWorker(sessionName);
          outputResult(
            {
              status: 'restored',
              type: 'worker',
              session: workerInfo.sessionName,
              branch: workerInfo.branch,
              agent: workerInfo.agent,
              workdir: workerInfo.workdir,
            },
            globalOpts,
            () => {
              console.log(`Restored worker: ${workerInfo.sessionName}`);
              console.log(`  Branch:  ${workerInfo.branch}`);
              console.log(`  Agent:   ${workerInfo.agent}`);
              console.log(`  Workdir: ${workerInfo.workdir}`);
            },
          );
          await postCreatePromise;
        } else {
          const copilotInfo = await sm.restoreCopilot(sessionName);
          outputResult(
            {
              status: 'restored',
              type: 'copilot',
              session: copilotInfo.sessionName,
              agent: copilotInfo.agent,
              workdir: copilotInfo.workdir,
            },
            globalOpts,
            () => {
              console.log(`Restored copilot: ${copilotInfo.sessionName}`);
              console.log(`  Agent:   ${copilotInfo.agent}`);
              console.log(`  Workdir: ${copilotInfo.workdir}`);
            },
          );
        }
      } catch (error) {
        outputError(error, globalOpts);
      }
    });
}
