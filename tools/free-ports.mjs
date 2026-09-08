#!/usr/bin/env node
/**
 * Frees the dev ports before a run, but only from *this repo's* processes.
 *
 * Two traps this avoids:
 *   - `lsof -ti:5174` lists established connections as well as listeners, so
 *     naively killing everything it returns also kills the Tauri webview's
 *     WebKit networking helpers that are merely *connected* to the port.
 *     Hence `-sTCP:LISTEN`.
 *   - A port might be held by something unrelated (another project, a system
 *     service). Killing that would be rude and confusing, so anything whose
 *     command line does not point back into this repo is reported, not killed.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * `--quiet`: report foreign processes but exit 0. Used by `pnpm desktop`, which
 * resolves a different port instead of demanding the other project stop.
 */
const QUIET = process.argv.includes('--quiet');
const PORTS = process.argv.slice(2).map(Number).filter(Boolean);
if (PORTS.length === 0) PORTS.push(5174, 8787, 5173);

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

let blocked = false;

/**
 * Stale desktop app instances.
 *
 * Killing the dev servers does not stop an already-running Tauri binary, so
 * repeated `pnpm desktop` runs pile up overlay windows on screen. Only this
 * repo's build path is matched, so another Tauri project is never touched.
 */
function stopStaleApps() {
  const pids = sh('pgrep', ['-f', 'target/debug/lecture-react']).split('\n').filter(Boolean);

  for (const pid of pids) {
    const cmd = sh('ps', ['-o', 'command=', '-p', pid]);
    // pgrep also matches the shell that launched it.
    if (!cmd || !cmd.includes('target/debug/lecture-react')) continue;
    // cargo launches the binary by a RELATIVE path, so the command line alone
    // cannot prove which checkout it belongs to — ask the kernel for its cwd.
    const cwd = sh('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'])
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
    if (!cwd || !cwd.startsWith(REPO)) continue;
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`[free-ports] stopped stale overlay app (pid ${pid})`);
    } catch {
      /* already gone */
    }
  }
}

stopStaleApps();

for (const port of PORTS) {
  const pids = sh('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN']).split('\n').filter(Boolean);

  for (const pid of pids) {
    const cmd = sh('ps', ['-o', 'command=', '-p', pid]);
    if (!cmd) continue;

    if (cmd.includes(REPO)) {
      try {
        process.kill(Number(pid), 'SIGTERM');
        console.log(`[free-ports] freed :${port} (pid ${pid}, stale dev server from this repo)`);
      } catch (err) {
        console.error(`[free-ports] could not stop pid ${pid} on :${port}:`, err.message);
        blocked = true;
      }
    } else {
      const project = /\/([^/]+)\/node_modules\//.exec(cmd)?.[1];
      console.error(
        `[free-ports] :${port} is held by another project${project ? ` (${project})` : ''}, pid ${pid}:\n` +
        `             ${cmd.slice(0, 110)}`,
      );
      if (QUIET) {
        console.error(`             Leaving it alone; a different port will be used.`);
      } else {
        console.error(
          `             Leave it running and start with a different port, e.g.\n` +
          `               PORT=8788 pnpm dev:web        (realtime server)\n` +
          `               LR_OVERLAY_PORT=5175 pnpm dev (overlay webview)\n` +
          `             or stop it with:  kill ${pid}`,
        );
        blocked = true;
      }
    }
  }
}

if (blocked) process.exit(1);
