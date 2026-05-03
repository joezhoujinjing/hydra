import * as vscode from 'vscode';
import { CopilotProvider, WorkerProvider } from './providers/tmuxSessionProvider';
import { getActiveBackend, refreshBackendFromConfig } from './utils/multiplexer';
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
import { createCopilot, createCopilotWithAgent } from './commands/createCopilot';
import { createWorker } from './commands/createWorker';
import { ensureHydraGlobalConfig } from './utils/hydraGlobalConfig';
import { installCli, isCliOnPath, getShellConfigSnippet, ensurePathInShellProfile } from './core/cliInstaller';
import { detectAvailableAgents } from './utils/agentConfig';

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
    vscode.commands.registerCommand('tmux.switchBackend', () => {
      vscode.window.showInformationMessage('Only tmux backend is supported.');
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
    vscode.commands.registerCommand('hydra.setupCli', () => setupCli(context)),
    vscode.commands.registerCommand('hydra.startCopilotClaude', () => createCopilotWithAgent('claude')),
    vscode.commands.registerCommand('hydra.startCopilotCodex', () => createCopilotWithAgent('codex')),
    vscode.commands.registerCommand('hydra.startCopilotGemini', () => createCopilotWithAgent('gemini')),
  );

  ensureHydraGlobalConfig();
  silentInstallCli(context);
  autoAttachOnStartup();
  detectAndSetAgentContext();

  const refreshAll = () => { copilotProvider.refresh(); workerProvider.refresh(); };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tmuxWorktree.multiplexer')) {
        refreshBackendFromConfig();
        updateViewDescriptions(copilotView, workerView);
        refreshAll();
      }
      if (e.affectsConfiguration('hydra.agentCommands')) {
        detectAndSetAgentContext();
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

async function detectAndSetAgentContext(): Promise<void> {
  try {
    const available = await detectAvailableAgents();
    vscode.commands.executeCommand('setContext', 'hydra.claudeAvailable', available.includes('claude'));
    vscode.commands.executeCommand('setContext', 'hydra.codexAvailable', available.includes('codex'));
    vscode.commands.executeCommand('setContext', 'hydra.geminiAvailable', available.includes('gemini'));
    vscode.commands.executeCommand('setContext', 'hydra.noAgentsAvailable', available.length === 0);
  } catch {
    // Best-effort — don't block activation
  }
}

function silentInstallCli(context: vscode.ExtensionContext): void {
  try {
    const version = (context.extension.packageJSON as { version: string }).version;
    const result = installCli(context.extensionPath, version);
    if (result.installed) {
      ensurePathInShellProfile();
      vscode.window.showInformationMessage(
        'Hydra CLI installed. PATH configured automatically — restart your shell or open a new terminal to use `hydra`.'
      );
    }
  } catch (err) {
    // CLI install is best-effort — don't block activation
    console.error('Hydra CLI install failed:', err);
  }
}

function setupCli(context: vscode.ExtensionContext): void {
  try {
    const version = (context.extension.packageJSON as { version: string }).version;
    installCli(context.extensionPath, version);
    const snippet = getShellConfigSnippet();
    if (isCliOnPath()) {
      vscode.window.showInformationMessage(
        'Hydra CLI is installed and on PATH. Run `hydra list --json` to verify.'
      );
    } else {
      vscode.window.showInformationMessage(
        `Hydra CLI installed at ~/.hydra/bin/hydra. Add to your shell profile: \`${snippet}\` — then run \`hydra list --json\` to verify.`,
        'Copy to Clipboard'
      ).then(choice => {
        if (choice === 'Copy to Clipboard') {
          vscode.env.clipboard.writeText(snippet);
        }
      });
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to setup Hydra CLI: ${err}`);
  }
}

export function deactivate() {
  cleanupTempImages();
}
