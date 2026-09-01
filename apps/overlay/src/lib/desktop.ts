/**
 * The one and only bridge to Tauri.
 *
 * Everything here feature-detects the desktop shell and degrades to a no-op in
 * a plain browser, so `pnpm dev` at :5174 renders the real UI for review
 * without building the desktop app. Nothing else in `src/` may import
 * `@tauri-apps/*` directly.
 */

export type WindowRole = 'launcher' | 'overlay';

type Unlisten = () => void;

const NOOP: Unlisten = () => {};

let hintedOnce = false;

/** True when running inside the Tauri webview. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function hint(what: string): void {
  if (hintedOnce) return;
  hintedOnce = true;
  console.info(
    `[lecture-react] browser mode — "${what}" and other desktop calls are no-ops. ` +
      'Run the Tauri shell for the real transparent overlay.',
  );
}

/**
 * Which window this document is. Both Tauri windows are opened with an
 * explicit `?window=` so the same check works on the desktop and in a browser
 * (the Tauri label is the authority, but it matches the query by construction).
 */
export function windowRole(): WindowRole {
  const q = new URLSearchParams(window.location.search).get('window');
  return q === 'overlay' ? 'overlay' : 'launcher';
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isDesktop()) {
    hint(cmd);
    return undefined;
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!isDesktop()) return NOOP;
  const { listen: tauriListen } = await import('@tauri-apps/api/event');
  return tauriListen<T>(event, (e) => handler(e.payload));
}

/* ---------------- window commands ---------------- */

export const showOverlay = () => invoke<void>('show_overlay');
export const hideOverlay = () => invoke<void>('hide_overlay');
export const closeOverlay = () => invoke<void>('close_overlay');
export const hideLauncher = () => invoke<void>('hide_launcher');
export const focusLauncher = () => invoke<void>('focus_launcher');
export const quitApp = () => invoke<void>('quit_app');

/** See the click-through notes in `src-tauri/src/lib.rs`. Call on CHANGE only. */
export const setClickThrough = (enabled: boolean) => invoke<void>('set_click_through', { enabled });

/** Full-interaction mode: the overlay stops ignoring cursor events entirely. */
export const setInteractionMode = (on: boolean) => invoke<void>('set_interaction_mode', { on });

/* ---------------- events from Rust ---------------- */

export interface CursorPoint {
  x: number;
  y: number;
}

/** ~20 Hz global cursor position in this window's logical (CSS px) space. */
export const onCursorMoved = (cb: (p: CursorPoint) => void) =>
  listen<CursorPoint>('cursor-moved', cb);

/** Emitted when Cmd/Ctrl+Shift+L (or a command) flips interaction mode. */
export const onInteractionMode = (cb: (enabled: boolean) => void) =>
  listen<{ enabled: boolean }>('interaction-mode', (p) => cb(p.enabled));

/** Emitted when Cmd/Ctrl+Shift+H flips quiet mode. */
export const onQuietMode = (cb: (enabled: boolean) => void) =>
  listen<{ enabled: boolean }>('quiet-mode', (p) => cb(p.enabled));
