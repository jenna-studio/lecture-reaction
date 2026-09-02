import { SessionProvider } from './lib/SessionContext';
import type { WindowRole } from './lib/desktop';
import { Launcher } from './windows/Launcher';
import { Overlay } from './windows/Overlay';

/**
 * Two windows, one bundle. The overlay connects immediately (resuming the
 * class if it is already running); the launcher waits for START CLASS.
 */
export function App({ role }: { role: WindowRole }) {
  if (role === 'overlay') {
    return (
      <SessionProvider connect="resume">
        <Overlay />
      </SessionProvider>
    );
  }
  return (
    <SessionProvider>
      <Launcher />
    </SessionProvider>
  );
}
