import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LIMITS, isFaultType, type ReactionType, type ReactionZone } from '@lr/shared';
import { useBursts } from '../lib/SessionContext';
import { reactionAccent, reactionIcon } from '../lib/icons';
import { pickSpawnPoint } from '../lib/spawn';

/**
 * Floating reaction layer.
 *
 * Two rules keep it calm during a surge:
 *  - at most MAX_ALIVE items exist at once;
 *  - a burst arriving at the cap is MERGED into the newest item of the same
 *    type (its count goes up and it re-pops) instead of adding clutter. A
 *    surge should read as a bigger number, not as more confetti.
 */

const MAX_ALIVE = 12;
/** How many recent spawn points to consider for collision avoidance. */
const RECENT_POINTS = 6;

interface FloatItem {
  key: string;
  type: ReactionType;
  count: number;
  /** Incremented on every merge; remounts the chip so the pop animation replays. */
  bumps: number;
  x: number;
  y: number;
  rise: number;
  drift: number;
  lifeMs: number;
}

let seq = 0;
const nextKey = () => `float-${++seq}`;

export function FloatingReactions({ zone, quiet }: { zone: ReactionZone; quiet: boolean }) {
  const [items, setItems] = useState<FloatItem[]>([]);
  const recentPoints = useRef<{ x: number; y: number }[]>([]);
  const timers = useRef(new Map<string, number>());

  const remove = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(key);
    setItems((prev) => prev.filter((item) => item.key !== key));
  }, []);

  useBursts((burst) => {
    // Quiet Mode hides sentiment, but a fault report is the one signal the
    // professor must act on, so it still shows.
    if (quiet && !isFaultType(burst.type)) return; // still counted by the reducer

    // Built outside the updater so React's double-invocation in StrictMode
    // cannot spawn two items for one burst.
    const fresh = spawn(burst.type, burst.count, recentPoints, zone);

    setItems((prev) => {
      if (prev.length >= MAX_ALIVE) {
        // Newest same-type item absorbs the burst.
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].type === burst.type) {
            const merged = [...prev];
            merged[i] = {
              ...merged[i],
              count: merged[i].count + burst.count,
              bumps: merged[i].bumps + 1,
            };
            return merged;
          }
        }
        // No same-type item to absorb it: retire the oldest to make room.
        const [oldest, ...rest] = prev;
        window.setTimeout(() => remove(oldest.key), 0);
        return [...rest, fresh];
      }
      return [...prev, fresh];
    });
  });

  // Safety net: if `animationend` never fires (window hidden, reduced motion),
  // the node still leaves. The layer must never leak DOM.
  useEffect(() => {
    for (const item of items) {
      if (timers.current.has(item.key)) continue;
      const timer = window.setTimeout(() => remove(item.key), item.lifeMs + 400);
      timers.current.set(item.key, timer);
    }
  }, [items, remove]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // In Quiet Mode only the fault reports above are ever queued, so the layer
  // stays mounted rather than being dropped wholesale.

  return (
    <div className="fixed inset-0 overflow-hidden" aria-hidden="true">
      {items.map((item) => (
        <div
          key={item.key}
          className="lr-float"
          style={
            {
              left: `${item.x}px`,
              top: `${item.y}px`,
              '--lr-rise': `${item.rise}px`,
              '--lr-drift': `${item.drift}px`,
              '--lr-life': `${item.lifeMs}ms`,
            } as CSSProperties
          }
          onAnimationEnd={() => remove(item.key)}
        >
          <span
            key={`${item.key}:${item.bumps}`}
            className={`lr-chip${item.bumps > 0 ? ' lr-pop' : ''}`}
            style={{ '--lr-chip-accent': reactionAccent(item.type) } as CSSProperties}
          >
            <FontAwesomeIcon icon={reactionIcon(item.type)} />
            {item.count > 1 && (
              <span className="lr-pixel text-[11px]">×&nbsp;{item.count}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function spawn(
  type: ReactionType,
  count: number,
  recentPoints: RefObject<{ x: number; y: number }[]>,
  zone: ReactionZone,
): FloatItem {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const point = pickSpawnPoint(zone, viewport, recentPoints.current);

  recentPoints.current.push({ x: point.x, y: point.y });
  if (recentPoints.current.length > RECENT_POINTS) recentPoints.current.shift();

  const lifeMs =
    LIMITS.reactionFloatMinMs +
    Math.random() * (LIMITS.reactionFloatMaxMs - LIMITS.reactionFloatMinMs);

  return {
    key: nextKey(),
    type,
    count,
    bumps: 0,
    x: point.x,
    y: point.y,
    rise: point.rise,
    drift: point.drift,
    lifeMs,
  };
}
