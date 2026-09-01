/** Tiny typed localStorage helpers. Never throws (private mode, quota, SSR). */

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore — persistence is a convenience, never a requirement */
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const STORAGE_KEYS = {
  /** { sessionId, token, code } — lets a crashed overlay resume its class. */
  session: 'lr.session',
  stripPosition: 'lr.strip.position',
  stripCollapsed: 'lr.strip.collapsed',
  settings: 'lr.settings',
} as const;
