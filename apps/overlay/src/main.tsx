import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import './index.css';
import { windowRole } from './lib/desktop';
import { App } from './App';

// We import the Font Awesome stylesheet ourselves; stop the runtime from
// injecting a second copy (which flickers on first paint).
config.autoAddCss = false;

const role = windowRole();
// Drives the transparent, pointer-events-none rules in index.css.
document.documentElement.classList.add(`lr-role-${role}`);

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App role={role} />
  </StrictMode>,
);
