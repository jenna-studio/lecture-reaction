import { LIMITS, type ServerMsg, type StudentMsg } from '@lr/shared';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface Credentials {
  code: string;
  anonId: string;
}

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;

/**
 * In production the server hosts this bundle, so same-origin is correct.
 * In dev, Vite proxies /ws to the server; VITE_SERVER_URL overrides both when
 * the student app is served from somewhere else entirely.
 */
export function resolveSocketUrl(): string {
  const override = import.meta.env.VITE_SERVER_URL;
  const base = new URL(override ?? window.location.href, window.location.href);
  const secure = base.protocol === 'https:' || base.protocol === 'wss:';
  // The server rejects any upgrade without a valid role, so it is part of the
  // URL, not something the first frame can carry.
  return `${secure ? 'wss:' : 'ws:'}//${base.host}/ws?role=student`;
}

type MessageListener = (msg: ServerMsg) => void;

/**
 * A small typed WebSocket wrapper: auto-reconnect with jittered exponential
 * backoff, an app-level heartbeat, and a silent re-`join` on every reconnect so
 * a student who walks behind a pillar simply resumes.
 */
export class SessionSocket {
  readonly #url: string;
  #ws: WebSocket | null = null;
  #creds: Credentials | null = null;
  #state: ConnState = 'closed';
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #messageListeners = new Set<MessageListener>();
  #stateListeners = new Set<() => void>();

  constructor(url: string = resolveSocketUrl()) {
    this.#url = url;
  }

  /* ---------------- connection lifecycle ---------------- */

  connect(creds: Credentials): void {
    this.#creds = creds;
    this.#attempt = 0;
    this.#open('connecting');
  }

  disconnect(): void {
    this.#creds = null;
    this.#clearTimers();
    this.#detach();
    this.#setState('closed');
  }

  #open(nextState: Extract<ConnState, 'connecting' | 'reconnecting'>): void {
    if (!this.#creds) return;
    this.#clearTimers();
    this.#detach();
    this.#setState(nextState);

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.#url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;

    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#attempt = 0;
      this.#setState('open');
      // Re-announce ourselves on every connection, first or fiftieth.
      if (this.#creds) {
        this.send({ t: 'join', code: this.#creds.code, anonId: this.#creds.anonId });
      }
      this.#heartbeatTimer = setInterval(() => this.send({ t: 'ping' }), LIMITS.heartbeatMs);
    };

    ws.onmessage = (event) => {
      if (this.#ws !== ws || typeof event.data !== 'string') return;
      const msg = parseServerMsg(event.data);
      if (msg) for (const listener of this.#messageListeners) listener(msg);
    };

    ws.onclose = () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#scheduleReconnect();
    };

    // `error` is always followed by `close`; letting close drive reconnect
    // keeps a single path.
    ws.onerror = () => {};
  }

  /** Drops any socket still around so a re-`connect` never leaves two open. */
  #detach(): void {
    const previous = this.#ws;
    if (!previous) return;
    this.#ws = null;
    previous.onopen = previous.onmessage = previous.onerror = previous.onclose = null;
    previous.close();
  }

  #scheduleReconnect(): void {
    this.#clearTimers();
    if (!this.#creds) {
      this.#setState('closed');
      return;
    }
    this.#setState('reconnecting');
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.#attempt);
    this.#attempt += 1;
    // ±25% jitter so a whole lecture hall doesn't retry in lockstep.
    const delay = base * (0.75 + Math.random() * 0.5);
    this.#reconnectTimer = setTimeout(() => this.#open('reconnecting'), delay);
  }

  #clearTimers(): void {
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    if (this.#heartbeatTimer !== null) clearInterval(this.#heartbeatTimer);
    this.#reconnectTimer = null;
    this.#heartbeatTimer = null;
  }

  /* ---------------- messaging ---------------- */

  send(msg: StudentMsg): boolean {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  onMessage(listener: MessageListener): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  /* ---------------- state, shaped for useSyncExternalStore ---------------- */

  subscribeState = (onChange: () => void): (() => void) => {
    this.#stateListeners.add(onChange);
    return () => this.#stateListeners.delete(onChange);
  };

  getConnState = (): ConnState => this.#state;

  #setState(next: ConnState): void {
    if (this.#state === next) return;
    this.#state = next;
    for (const listener of this.#stateListeners) listener();
  }
}

function parseServerMsg(raw: string): ServerMsg | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && typeof (value as { t?: unknown }).t === 'string') {
      return value as ServerMsg;
    }
  } catch {
    /* a malformed frame is never worth crashing a lecture over */
  }
  return null;
}
