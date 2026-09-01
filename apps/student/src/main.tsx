import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { config } from '@fortawesome/fontawesome-svg-core';

import '@fontsource/silkscreen/400.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fortawesome/fontawesome-svg-core/styles.css';
import './index.css';

import { App } from './App';
import { SessionProvider } from './state/SessionProvider';

// The Font Awesome stylesheet is imported above, so the runtime must not inject
// a second copy (which causes oversized icons on first paint).
config.autoAddCss = false;

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
