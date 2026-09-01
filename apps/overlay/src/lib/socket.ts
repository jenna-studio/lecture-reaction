/**
 * Typed professor websocket: auto-reconnect with exponential backoff + jitter,
 * and — crucially — a `resume` handshake so an overlay crash or a flaky wifi
 * hiccup does NOT end the class. The session id/token pair is persisted by the
 * caller; we just replay it on every (re)connect.
 */

import { LIMITS, type ProfessorMsg, type ServerMsg } from '@lr/shared';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ResumeToken {
  sessionId: string;
  token: string;
}

export interface SocketOptions {
  url: string;
  /** Read at connect time so it always reflects the newest session:created. */
  getResume: () => ResumeToken | null;
  onMessage: (msg: ServerMsg) => void;
  onState: (state: ConnectionState) => void;
}

export interface ProfessorSocket {
  send: (msg: ProfessorMsg) => void;
  /** Closes for good — no reconnect. */
  dispose: () => void;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 10_000;

/** Full jitter: spreads reconnects and avoids a thundering herd on restart. */
function backoffDelay(attempt: number): number {
  const capped = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.random() * capped;
}

export function connectProfessor(opts: SocketOptions): ProfessorSocket {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let disposed = false;
  let reconnectTimer: number | undefined;
  let heartbeat: number | undefined;
  /** Queued while the socket is down; flushed on the next open. */
  const outbox: ProfessorMsg[] = [];

  const setState = (s: ConnectionState) => {
    if (!disposed) opts.onState(s);
  };

  const raw = (msg: ProfessorMsg) => {
    ws?.send(JSON.stringify(msg));
  };

  const send = (msg: ProfessorMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) raw(msg);
    else outbox.push(msg);
  };

  const stopHeartbeat = () => {
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const open = () => {
    if (disposed) return;
    setState(attempt === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(opts.url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      attempt = 0;
      setState('open');

      // The handshake. `resume` is what keeps the class alive across drops.
      const resume = opts.getResume();
      raw(resume ? { t: 'session:create', resume } : { t: 'session:create' });

      while (outbox.length > 0) raw(outbox.shift() as ProfessorMsg);

      stopHeartbeat();
      heartbeat = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) raw({ t: 'ping' });
      }, LIMITS.heartbeatMs);
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return; // a malformed frame must never take the overlay down
      }
      if (typeof parsed === 'object' && parsed !== null && 't' in parsed) {
        opts.onMessage(parsed as ServerMsg);
      }
    };

    socket.onerror = () => {
      /* `onclose` always follows; reconnection is handled there. */
    };

    socket.onclose = () => {
      stopHeartbeat();
      ws = null;
      if (disposed) return;
      setState('reconnecting');
      scheduleReconnect();
    };
  };

  function scheduleReconnect() {
    if (disposed) return;
    const delay = backoffDelay(attempt);
    attempt += 1;
    reconnectTimer = window.setTimeout(open, delay);
  }

  open();

  return {
    send,
    dispose: () => {
      disposed = true;
      stopHeartbeat();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      const socket = ws;
      ws = null;
      socket?.close();
      // `setState` is muted once disposed, so report the final state directly.
      opts.onState('closed');
    },
  };
}
