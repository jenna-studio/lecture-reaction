/**
 * Reaction burst aggregation — the "? × 14" feature.
 *
 * Reactions are never stored. Instead, per session and per reaction type we
 * open a window on the FIRST reaction and flush a single
 * `reaction:burst { count }` frame LIMITS.burstWindowMs later. Thirty students
 * tapping "confused" at once produces one frame with count 30, not thirty.
 */

import { randomUUID } from 'node:crypto';
import { LIMITS, type ReactionType } from '@lr/shared';

export interface Burst {
  id: string;
  type: ReactionType;
  count: number;
  at: number;
}

type Window = { count: number; timer: NodeJS.Timeout };

export class BurstAggregator {
  /** sessionId -> reaction type -> open window. */
  private readonly windows = new Map<string, Map<ReactionType, Window>>();

  constructor(private readonly flush: (sessionId: string, burst: Burst) => void) {}

  /** Records one reaction, opening a window if this type has none in flight. */
  add(sessionId: string, type: ReactionType): void {
    let perSession = this.windows.get(sessionId);
    if (!perSession) {
      perSession = new Map();
      this.windows.set(sessionId, perSession);
    }

    const open = perSession.get(type);
    if (open) {
      open.count += 1;
      return;
    }

    const timer = setTimeout(() => this.flushType(sessionId, type), LIMITS.burstWindowMs);
    // Never hold the process open just for a pending burst.
    timer.unref?.();
    perSession.set(type, { count: 1, timer });
  }

  private flushType(sessionId: string, type: ReactionType): void {
    const perSession = this.windows.get(sessionId);
    const open = perSession?.get(type);
    if (!perSession || !open) return;

    perSession.delete(type);
    if (perSession.size === 0) this.windows.delete(sessionId);

    this.flush(sessionId, {
      id: randomUUID(),
      type,
      count: open.count,
      at: Date.now(),
    });
  }

  /** Drops every pending window for a session. Called when a session ends. */
  clearSession(sessionId: string): void {
    const perSession = this.windows.get(sessionId);
    if (!perSession) return;
    for (const w of perSession.values()) clearTimeout(w.timer);
    this.windows.delete(sessionId);
  }

  /** Drops everything (process shutdown / tests). */
  clearAll(): void {
    for (const sessionId of [...this.windows.keys()]) this.clearSession(sessionId);
  }
}
