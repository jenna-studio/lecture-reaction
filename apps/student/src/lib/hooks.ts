import { useEffect, useState } from 'react';

/**
 * True while `until` (an epoch ms deadline) is in the future. One timeout, no
 * animation loop — the visual progress is done in CSS so reduced-motion users
 * are not driven by JS.
 */
export function useCooldown(until: number): boolean {
  const [active, setActive] = useState(() => Date.now() < until);

  useEffect(() => {
    const remaining = until - Date.now();
    if (remaining <= 0) {
      setActive(false);
      return;
    }
    setActive(true);
    const id = setTimeout(() => setActive(false), remaining);
    return () => clearTimeout(id);
  }, [until]);

  return active;
}

/** Whole seconds left before `until`, ticking down to 0. */
export function useSecondsLeft(until: number): number {
  const [seconds, setSeconds] = useState(() => secondsUntil(until));

  useEffect(() => {
    setSeconds(secondsUntil(until));
    if (until <= Date.now()) return;
    const id = setInterval(() => {
      const next = secondsUntil(until);
      setSeconds(next);
      if (next <= 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [until]);

  return seconds;
}

function secondsUntil(until: number): number {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
