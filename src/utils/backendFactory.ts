import { MultiplexerBackend, getConfiguredMultiplexerType } from './multiplexer';
import { TmuxBackend } from './tmuxBackend';
import { ZellijBackend } from './zellijBackend';

export function createBackendFromConfig(): MultiplexerBackend {
  const type = getConfiguredMultiplexerType();
  switch (type) {
    case 'zellij':
      return new ZellijBackend();
    case 'tmux':
    default:
      return new TmuxBackend();
  }
}
