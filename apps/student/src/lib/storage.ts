/**
 * The only thing we ever persist is an opaque anonymous id and the last class
 * code. Neither is shown in the UI; the id exists so a student who reloads or
 * loses signal keeps their votes and questions.
 */

const ANON_KEY = 'lr.anonId';
const CODE_KEY = 'lr.lastCode';

/** localStorage throws in Safari private mode and when storage is disabled. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* best effort: the session still works, it just won't survive a reload */
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Returns the persisted anonymous id, minting one on first use. */
export function getAnonId(): string {
  const existing = read(ANON_KEY);
  if (existing) return existing;
  const fresh = randomId();
  write(ANON_KEY, fresh);
  return fresh;
}

export function getRememberedCode(): string | null {
  return read(CODE_KEY);
}

export function rememberCode(code: string): void {
  write(CODE_KEY, code);
}

export function forgetCode(): void {
  remove(CODE_KEY);
}
