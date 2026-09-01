/**
 * Where a floating reaction is allowed to appear.
 *
 * Two areas are permanently off-limits:
 *   - the right 30% of the screen  → reserved for the question stack
 *   - the middle 40% vertical band → where the professor's content lives
 *
 * Within what is left, the `ReactionZone` setting picks a column on the left
 * edge, a band along the bottom, or both.
 */

import type { ReactionZone } from '@lr/shared';

export interface Viewport {
  width: number;
  height: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  /** How far the item rises before it fades, in px (`--lr-rise`). */
  rise: number;
  /** Sideways drift, in px (`--lr-drift`). */
  drift: number;
}

/** Right edge reserved for questions. */
const RIGHT_RESERVED = 0.7;
/** Central vertical band reserved for slide content: 30%–70%. */
const BAND_TOP = 0.3;
const BAND_BOTTOM = 0.7;
/** Two items closer than this are considered a collision. */
const MIN_SEPARATION = 72;
const MAX_ATTEMPTS = 3;

const between = (min: number, max: number) => min + Math.random() * (max - min);

function leftZonePoint(vp: Viewport): { x: number; y: number } {
  const x = between(vp.width * 0.03, vp.width * 0.2);
  // Above or below the protected central band, never inside it.
  const y =
    Math.random() < 0.5
      ? between(vp.height * 0.08, vp.height * BAND_TOP)
      : between(vp.height * BAND_BOTTOM, vp.height * 0.9);
  return { x, y };
}

function bottomZonePoint(vp: Viewport): { x: number; y: number } {
  const x = between(vp.width * 0.06, vp.width * RIGHT_RESERVED - 80);
  const y = between(vp.height * 0.74, vp.height * 0.92);
  return { x, y };
}

function candidate(zone: ReactionZone, vp: Viewport): { x: number; y: number } {
  if (zone === 'left') return leftZonePoint(vp);
  if (zone === 'bottom') return bottomZonePoint(vp);
  return Math.random() < 0.45 ? leftZonePoint(vp) : bottomZonePoint(vp);
}

/**
 * Picks a spawn point, retrying a couple of times when it lands on top of a
 * recently used point. Light-touch on purpose: perfect packing would look
 * mechanical, and a near-miss reads as natural.
 */
export function pickSpawnPoint(
  zone: ReactionZone,
  vp: Viewport,
  recent: readonly { x: number; y: number }[] = [],
): SpawnPoint {
  let best = candidate(zone, vp);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const clash = recent.some(
      (p) => Math.hypot(p.x - best.x, p.y - best.y) < MIN_SEPARATION,
    );
    if (!clash) break;
    best = candidate(zone, vp);
  }

  // Never rise into the reserved band from below, and never off the top.
  const maxRise = Math.max(120, Math.min(best.y - 12, vp.height * 0.32));
  return {
    x: clamp(best.x, 8, vp.width * RIGHT_RESERVED - 40),
    y: clamp(best.y, 8, vp.height - 60),
    rise: between(maxRise * 0.65, maxRise),
    drift: between(-26, 26),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
