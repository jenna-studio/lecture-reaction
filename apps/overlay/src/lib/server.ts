/** Where the realtime server lives, and how students reach it. */

const DEFAULT_ORIGIN = 'http://localhost:8787';

export function serverOrigin(): string {
  const raw = import.meta.env.VITE_SERVER_URL ?? DEFAULT_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** `http(s)://host` -> `ws(s)://host/ws?role=professor`. */
export function professorSocketUrl(origin = serverOrigin()): string {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '?role=professor';
  return url.toString();
}

/** The URL a student types or scans. `?c=` prefills the join code. */
export function joinUrl(base: string, code: string): string {
  const url = new URL(base);
  url.searchParams.set('c', code);
  return url.toString();
}

interface JoinUrlResponse {
  url: string;
  wsUrl: string;
  lanIp: string | null;
  port: number;
}

/**
 * The server knows its own LAN address, which is what the QR code must encode —
 * `localhost` is useless on a student's phone. If the endpoint is missing or
 * unreachable we fall back to the configured origin, which is still correct
 * when everyone is on the same machine.
 */
export async function fetchJoinBase(signal?: AbortSignal): Promise<string> {
  const origin = serverOrigin();
  try {
    const res = await fetch(`${origin}/api/join-url`, { signal });
    if (!res.ok) return origin;
    const data = (await res.json()) as Partial<JoinUrlResponse>;
    return typeof data.url === 'string' && data.url.length > 0 ? data.url : origin;
  } catch {
    return origin;
  }
}

interface SessionLookup {
  exists: boolean;
  status: 'active' | 'ended';
}

/**
 * Used by the launcher after it hands the class to the overlay: it has no
 * socket any more, so it asks the server whether the class is still running.
 */
export async function fetchSessionStatus(code: string): Promise<SessionLookup | null> {
  try {
    const res = await fetch(`${serverOrigin()}/api/session/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<SessionLookup>;
    if (typeof data.exists !== 'boolean') return null;
    return { exists: data.exists, status: data.status === 'ended' ? 'ended' : 'active' };
  } catch {
    return null;
  }
}
