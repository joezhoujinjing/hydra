import * as vscode from 'vscode';
import { exec } from './exec';
import { TmuxBackendCore, buildStoredTmuxEnvScrubCommand } from '../core/tmux';
import { MultiplexerBackend } from './multiplexer';

function getShortName(sessionName: string): string {
  const parts = sessionName.split('_');
  if (parts.length > 1) {
    return parts.slice(1).join('_');
  }
  return sessionName;
}

export class TmuxBackend extends TmuxBackendCore implements MultiplexerBackend {
  attachSession(
    sessionName: string,
    cwd?: string,
    location: vscode.TerminalLocation = vscode.TerminalLocation.Editor
  ): vscode.Terminal {
    const shortName = getShortName(sessionName);
    const terminalName = shortName;

    const oldName = `tmux: ${sessionName}`;
    const existing = vscode.window.terminals.find(t => t.name === terminalName || t.name === oldName);

    if (existing) {
      void exec(`tmux set-window-option -t "${sessionName}":. window-size latest`).catch(() => {});
      const options = existing.creationOptions as vscode.TerminalOptions;
      if (options && options.location === location) {
        existing.show();
        return existing;
      }
      existing.dispose();
    }

    const escapedName = sessionName.replace(/'/g, "'\\''");
    const attachCommand = [
      buildStoredTmuxEnvScrubCommand(sessionName),
      "tmux set-option -gq set-clipboard on >/dev/null 2>&1 || true",
      "tmux set-option -agq terminal-features ',xterm-256color:clipboard' >/dev/null 2>&1 || true",
      "tmux set-option -agq terminal-overrides ',*:clipboard' >/dev/null 2>&1 || true",
      "tmux set-option -gwq allow-passthrough on >/dev/null 2>&1 || true",
      "rows=''; cols=''",
      "for _ in 1 2 3 4 5; do",
      "size=$(stty size 2>/dev/null || true)",
      "candidate_rows=${size%% *}",
      "candidate_cols=${size##* }",
      "if [ -n \"$candidate_rows\" ] && [ -n \"$candidate_cols\" ] && [ \"$candidate_rows\" -gt 0 ] && [ \"$candidate_cols\" -gt 0 ]; then rows=\"$candidate_rows\"; cols=\"$candidate_cols\"; fi",
      "if [ -n \"$rows\" ] && [ \"$rows\" -ge 30 ] && [ \"$cols\" -ge 100 ]; then break; fi",
      "sleep 0.04",
      "done",
      "if [ -n \"$rows\" ] && [ -n \"$cols\" ]; then tmux set-option -t '" + escapedName + "' default-size \"${cols}x${rows}\" >/dev/null 2>&1 || true; fi",
      "if [ -n \"$rows\" ] && [ -n \"$cols\" ]; then tmux resize-window -t '" + escapedName + "':. -x \"$cols\" -y \"$rows\" >/dev/null 2>&1 || true; fi",
      "tmux set-window-option -t '" + escapedName + "':. window-size latest >/dev/null 2>&1 || true",
      "sleep 0.08",
      `exec tmux attach -t '${escapedName}'`
    ].join('\n');

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      shellPath: '/bin/sh',
      shellArgs: ['-c', attachCommand],
      cwd: cwd,
      env: {
        'TERM': 'xterm-256color',
        'TERM_PROGRAM': null,
        'TERM_PROGRAM_VERSION': null,
        'VSCODE_SHELL_INTEGRATION': null,
        'VSCODE_INJECTION': null,
      },
      location,
      iconPath: new vscode.ThemeIcon('server')
    });
    terminal.show();
    return terminal;
  }
}
