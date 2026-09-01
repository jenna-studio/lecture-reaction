import { EndedScreen } from './screens/EndedScreen';
import { JoinScreen } from './screens/JoinScreen';
import { ReactScreen } from './screens/ReactScreen';
import { useSession } from './state/SessionProvider';

export function App() {
  const { state } = useSession();

  switch (state.phase) {
    case 'joined':
      return <ReactScreen />;
    case 'ended':
      return <EndedScreen />;
    case 'idle':
    case 'joining':
    case 'error':
      return <JoinScreen />;
  }
}
