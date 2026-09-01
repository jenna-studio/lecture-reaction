/**
 * Lecture React realtime server.
 *
 * One process serves three things:
 *   - a tiny JSON API (`/health`, `/api/session/:code`, `/api/join-url`)
 *   - the built student web app (apps/student/dist) with SPA fallback
 *   - the websocket hub at `/ws?role=professor|student`
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { normalizeCode } from '@lr/shared';
import { Hub, type Role } from './hub.js';
import { StaticSite } from './static.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = '0.0.0.0';

const here = dirname(fileURLToPath(import.meta.url));
/** packages/server/src -> repo root -> apps/student/dist */
const STUDENT_DIST = resolve(here, '../../../apps/student/dist');

const hub = new Hub();
const site = new StaticSite(STUDENT_DIST);

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const httpServer = createServer((req, res) => {
  try {
    handleHttp(req, res);
  } catch (err) {
    console.error('[http] request failed:', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal error');
  }
});

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/health') {
    return json(res, 200, { ok: true, activeSessions: hub.store.activeSessionCount() });
  }

  if (pathname === '/api/join-url') {
    const lanIp = lanAddress();
    const host = lanIp ?? 'localhost';
    return json(res, 200, {
      url: `http://${host}:${PORT}/`,
      wsUrl: `ws://${host}:${PORT}/ws`,
      lanIp,
      port: PORT,
    });
  }

  if (pathname.startsWith('/api/session/')) {
    // Fast pre-check for the student page. Leaks nothing but existence/status.
    const code = normalizeCode(decodeURIComponent(pathname.slice('/api/session/'.length)));
    const session = code ? hub.store.getByCode(code) : undefined;
    if (!session) return json(res, 200, { exists: false, status: 'unknown' });
    return json(res, 200, { exists: session.status === 'active', status: session.status });
  }

  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });

  site.serve(req, res, pathname);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // The overlay and the student app may be served from a Vite dev origin.
    'access-control-allow-origin': '*',
  });
  res.end(payload);
}

/* ------------------------------------------------------------------ */
/* WebSocket upgrade                                                   */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const roleParam = url.searchParams.get('role');
  if (roleParam !== 'professor' && roleParam !== 'student') {
    socket.destroy();
    return;
  }
  const role: Role = roleParam;
  wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws, role));
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/** First non-internal IPv4 — the address phones on the LAN can reach. */
function lanAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

httpServer.listen(PORT, HOST, () => {
  const lan = lanAddress();
  console.log(`[lecture-react] listening on http://${HOST}:${PORT}`);
  console.log(`[lecture-react] local:    http://localhost:${PORT}`);
  if (lan) console.log(`[lecture-react] students open: http://${lan}:${PORT}`);
  else console.log('[lecture-react] no LAN address found — phones may not be able to connect.');
  console.log(
    site.available
      ? `[lecture-react] serving student app from ${STUDENT_DIST}`
      : '[lecture-react] student app not built yet (apps/student/dist missing)',
  );
});

process.on('unhandledRejection', (reason) => {
  console.error('[lecture-react] unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  // Log and keep serving: one bad frame must not end the class.
  console.error('[lecture-react] uncaught exception:', err);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[lecture-react] ${signal} — shutting down`);
    hub.dispose();
    wss.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
