/**
 * Frontend half of the click-through mechanic (Rust half: `src-tauri/src/lib.rs`).
 *
 * The overlay window ignores cursor events by default, so it receives no DOM
 * mouse events at all. Rust therefore feeds us the global cursor position in
 * this window's logical coordinate space ~20x/second; we hit-test it against
 * every element tagged `data-lr-interactive` and flip the window's
 * ignore-cursor-events flag ONLY when the answer changes.
 *
 * Anything the professor must be able to click carries both the
 * `data-lr-interactive` attribute (this hit-test) and the `.lr-interactive`
 * class (`pointer-events: auto`, since the overlay root disables them).
 */

import { useEffect, useRef } from 'react';
import { onCursorMoved, setClickThrough } from './desktop';

export const INTERACTIVE_ATTR = 'data-lr-interactive';

/**
 * A little slack around each target: the professor is aiming at a small chip
 * while talking, and 20 Hz sampling can skip a few pixels.
 */
const HIT_PADDING = 6;

function pointHitsInteractive(x: number, y: number): boolean {
  // Recomputed per tick on purpose: cards slide, the strip is draggable, and
  // there are only ever a handful of tagged nodes, so the layout read is cheap.
  const nodes = document.querySelectorAll<HTMLElement>(`[${INTERACTIVE_ATTR}]`);
  for (const node of nodes) {
    if (node.offsetParent === null && node.style.position !== 'fixed') continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (
      x >= r.left - HIT_PADDING &&
      x <= r.right + HIT_PADDING &&
      y >= r.top - HIT_PADDING &&
      y <= r.bottom + HIT_PADDING
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param fullInteraction when true the window never ignores cursor events, so
 *   hit-testing is suspended (Rust enforces the same rule).
 */
export function useClickThrough(fullInteraction: boolean): void {
  // `null` = unknown, forcing the first decision to be pushed to Rust.
  const clickThroughRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (fullInteraction) {
      clickThroughRef.current = null;
      return;
    }
    // Presentation mode is the default: swallow nothing.
    clickThroughRef.current = true;
    void setClickThrough(true);

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void onCursorMoved(({ x, y }) => {
      const shouldClickThrough = !pointHitsInteractive(x, y);
      if (shouldClickThrough === clickThroughRef.current) return; // no IPC on a normal tick
      clickThroughRef.current = shouldClickThrough;
      void setClickThrough(shouldClickThrough);
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [fullInteraction]);
}
