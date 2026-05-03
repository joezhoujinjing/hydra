#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import { registerListCommand } from './commands/list';
import { registerWorkerCommands } from './commands/worker';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();
program
  .name('hydra')
  .description('CLI for managing Hydra copilots and workers')
  .version(pkg.version)
  .option('--json', 'Output results as JSON')
  .option('--quiet', 'Suppress non-essential output');

// Auto-enable --json when stdout is not a TTY (piped output)
if (!process.stdout.isTTY) {
  program.setOptionValue('json', true);
}

registerListCommand(program);
registerWorkerCommands(program);

program.parse();
