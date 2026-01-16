import * as vscode from 'vscode';
import { CopilotProvider, WorkerProvider } from './providers/tmuxSessionProvider';
import { getActiveBackend, refreshBackendFromConfig, getConfiguredMultiplexerType, MultiplexerType } from './utils/multiplexer';
import { attachCreate } from './commands/attachCreate';
// newTask is now an alias for createWorker
import { removeTask } from './commands/removeTask';
import { cleanupOrphans } from './commands/orphanCleanup';
import { autoAttachOnStartup } from './commands/autoAttach';
import {
  attach,
  attachInEditor,
  openWorktree,
  copyPath,
  newPane,
  newWindow
} from './commands/contextMenu';
import { terminalSmartPaste, pasteImageForce, cleanupTempImages } from './commands/pasteImage';
import { createWorktreeFromBranch } from './commands/createWorktreeFromBranch';
import { createCopilot } from './commands/createCopilot';
import { createWorker } from './commands/createWorker';
import { ensureHydraGlobalConfig } from './utils/hydraGlobalConfig';

function updateViewDescriptions(...views: vscode.TreeView<unknown>[]): void {
  const backend = getActiveBackend();
  for (const v of views) v.description = `[${backend.displayName}]`;
}

export function activate(context: vscode.ExtensionContext) {
  const copilotProvider = new CopilotProvider();
  copilotProvider.setExtensionUri(context.extensionUri);
  const workerProvider = new WorkerProvider();
  workerProvider.setExtensionUri(context.extensionUri);

  const copilotView = vscode.window.createTreeView('hydraCopilots', { treeDataProvider: copilotProvider });
  const workerView = vscode.window.createTreeView('hydraWorkers', { treeDataProvider: workerProvider });
  updateViewDescriptions(copilotView, workerView);

  context.subscriptions.push(
    copilotView,
    workerView,
    vscode.commands.registerCommand('tmux.attachCreate', attachCreate),
    vscode.commands.registerCommand('tmux.newTask', createWorker),
    vscode.commands.registerCommand('tmux.removeTask', (item) => removeTask(item)),
    vscode.commands.registerCommand('tmux.cleanupOrphans', cleanupOrphans),
    vscode.commands.registerCommand('tmux.refresh', () => { copilotProvider.refresh(); workerProvider.refresh(); }),
    vscode.commands.registerCommand('tmux.filter', async () => {
      const choice = await vscode.window.showQuickPick(
        ['All', 'Attached', 'Alive', 'Idle', 'Orphans'],
        { placeHolder: 'Filter sessions by status' }
      );
      if (choice) {
        workerProvider.setFilter(choice.toLowerCase());
        workerProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('tmux.switchBackend', async () => {
      const current = getConfiguredMultiplexerType();
      const options: { label: string; value: MultiplexerType }[] = [
        { label: 'tmux', value: 'tmux' },
        { label: 'Zellij', value: 'zellij' },
      ];
      const picked = await vscode.window.showQuickPick(
        options.map(o => ({
          label: o.label,
          description: o.value === current ? '(current)' : '',
          value: o.value,
        })),
        { placeHolder: `Current: ${current}` }
      );
      if (!picked || (picked as { value: MultiplexerType }).value === current) return;
      await vscode.workspace.getConfiguration('tmuxWorktree')
        .update('multiplexer', (picked as { value: MultiplexerType }).value, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('tmux.attach', attach),
    vscode.commands.registerCommand('tmux.attachInEditor', attachInEditor),
    vscode.commands.registerCommand('tmux.openWorktree', openWorktree),
    vscode.commands.registerCommand('tmux.copyPath', copyPath),
    vscode.commands.registerCommand('tmux.newPane', newPane),
    vscode.commands.registerCommand('tmux.newWindow', newWindow),
    vscode.commands.registerCommand('tmux.terminalPaste', terminalSmartPaste),
    vscode.commands.registerCommand('tmux.pasteImage', pasteImageForce),
    vscode.commands.registerCommand('tmux.createWorktreeFromBranch', (item) => createWorktreeFromBranch(item)),
    vscode.commands.registerCommand('hydra.createCopilot', createCopilot),
    vscode.commands.registerCommand('hydra.createWorker', createWorker),
  );

  ensureHydraGlobalConfig();
  autoAttachOnStartup();

  const refreshAll = () => { copilotProvider.refresh(); workerProvider.refresh(); };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tmuxWorktree.multiplexer')) {
        refreshBackendFromConfig();
        updateViewDescriptions(copilotView, workerView);
        refreshAll();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => refreshAll()),
    vscode.window.onDidCloseTerminal(() => refreshAll()),
    vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) refreshAll();
    })
  );

  const intervalId = setInterval(() => {
      refreshAll();
  }, 30000);

  context.subscriptions.push({
      dispose: () => clearInterval(intervalId)
  });
}

export function deactivate() {
  cleanupTempImages();
}
