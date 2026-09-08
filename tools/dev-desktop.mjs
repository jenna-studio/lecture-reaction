#!/usr/bin/env node
/**
 * Starts the realtime server and the Tauri desktop app together.
 *
 * Ports are *resolved*, not assumed. Another project may already own 8787 or
 * 5174 — vite in particular auto-increments into a neighbouring port when its
 * own is taken — and killing someone else's dev server is not acceptable. So
 * anything occupied by a foreign process is stepped over, and the chosen ports
 * are threaded through to both children:
 *
 *   PORT             -> the realtime server
 *   LR_OVERLAY_PORT  -> the overlay's vite dev server
 *   VITE_SERVER_URL  -> tells the overlay where the server actually landed
 *   --config devUrl  -> tells Tauri which vite to load
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const REPO = new URL('..', import.meta.url).pathname;

/** True when `port` can be bound on `host`. */
function canBind(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/**
 * True when nothing is listening on `port` on EITHER IP stack.
 *
 * Checking only IPv4 is a trap: another project's vite bound to `[::1]:5174`
 * leaves `0.0.0.0:5174` bindable, so the port looks free, both servers come
 * up on the same number, and `localhost` (which resolves to ::1 first on
 * macOS) then sends the Tauri webview to the wrong project.
 */
async function isFree(port) {
  return (await canBind(port, '127.0.0.1')) && (await canBind(port, '::1'));
}

/** The preferred port, or the next free one after it. */
async function pickPort(preferred, label) {
  for (let port = preferred; port < preferred + 25; port++) {
    if (await isFree(port)) {
      if (port !== preferred) {
        console.log(`[dev] ${label}: ${preferred} is taken, using ${port}`);
      }
      return port;
    }
  }
  throw new Error(`no free port for ${label} near ${preferred}`);
}

const serverPort = Number(process.env.PORT) || (await pickPort(8787, 'server'));
const overlayPort = Number(process.env.LR_OVERLAY_PORT) || (await pickPort(5174, 'overlay'));
// Numeric loopback on purpose: `localhost` may resolve to ::1 or 127.0.0.1
// depending on the machine, and the two need not be the same server.
const serverUrl = `http://127.0.0.1:${serverPort}`;

console.log(`[dev] server  ${serverUrl}`);
console.log(`[dev] overlay http://127.0.0.1:${overlayPort} (webview)`);

const env = {
  ...process.env,
  PORT: String(serverPort),
  LR_OVERLAY_PORT: String(overlayPort),
  VITE_SERVER_URL: serverUrl,
};

const children = [];

function run(name, args) {
  const child = spawn('pnpm', args, { cwd: REPO, env, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    // Always say why: a silent exit here cascades into shutting everything down.
    console.error(`[dev] ${name} exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  // The Tauri binary can outlive its parent; give it a moment, then leave.
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', ['-F', '@lr/server', 'dev']);
run('tauri', [
  '-F', '@lr/overlay', 'tauri', 'dev',
  // Tauri hardcodes devUrl in tauri.conf.json; override it for this run only.
  '--config', JSON.stringify({ build: { devUrl: `http://127.0.0.1:${overlayPort}` } }),
]);
