import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS, type ReactionType } from '@lr/shared';
import { useSession } from '../lib/SessionContext';
import { useClickThrough } from '../lib/clickThrough';
import {
  focusLauncher,
  hideOverlay,
  isDesktop,
  onInteractionMode,
  onQuietMode,
  setInteractionMode,
} from '../lib/desktop';
import { loadSettings, saveSettings, type OverlaySettings } from '../lib/settings';
import { fetchJoinBase, joinUrl } from '../lib/server';
import { ControlStrip } from '../components/ControlStrip';
import { FloatingReactions } from '../components/FloatingReactions';
import { PollPanel } from '../components/PollPanel';
import { QuestionStack } from '../components/QuestionStack';
import { SlidesBackdrop } from '../components/SlidesBackdrop';

/**
 * The professor interface. There is no dashboard: this window, floating over
 * the presentation, is all of it.
 */
export function Overlay() {
  const { state, endClass, startPoll, endPoll, subscribeBursts } = useSession();

  const [settings, setSettings] = useState<OverlaySettings>(loadSettings);
  const [fullInteraction, setFullInteraction] = useState(false);
  const [pollExpanded, setPollExpanded] = useState(true);
  // True while a control-strip popover is open; the poll panel lifts clear of it.
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [joinBase, setJoinBase] = useState<string | null>(null);
  /** The reaction type that just surged, highlighted briefly on the strip. */
  const [surge, setSurge] = useState<ReactionType | null>(null);

  // Same continuous check as the launcher: the address students need can change
  // mid-lecture if the professor's network does.
  useEffect(() => {
    let controller = new AbortController();
    const refresh = () => {
      controller.abort();
      controller = new AbortController();
      void fetchJoinBase(controller.signal).then(setJoinBase);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener('online', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
    };
  }, []);

  // Click-through hit-testing lives here; see lib/clickThrough.ts.
  useClickThrough(fullInteraction);

  /* ---------------- global shortcuts ---------------- */

  useEffect(() => {
    let offInteraction: (() => void) | undefined;
    let offQuiet: (() => void) | undefined;
    let disposed = false;

    // A reloaded overlay must not inherit a stale interaction mode.
    void setInteractionMode(false);

    void onInteractionMode(setFullInteraction).then((off) => {
      if (disposed) off();
      else offInteraction = off;
    });
    void onQuietMode((enabled) =>
      setSettings((prev) => {
        const next = { ...prev, quiet: enabled };
        saveSettings(next);
        return next;
      }),
    ).then((off) => {
      if (disposed) off();
      else offQuiet = off;
    });

    return () => {
      disposed = true;
      offInteraction?.();
      offQuiet?.();
    };
  }, []);

  const updateSettings = useCallback((next: OverlaySettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  /* ---------------- quiet-mode counter ---------------- */

  // Counts reactions received *since Quiet Mode was switched on*, so the strip
  // reads "reactions hidden · 34" rather than a total from the whole lecture.
  const quietBaseline = useRef(0);
  const wasQuiet = useRef(settings.quiet);
  if (settings.quiet && !wasQuiet.current) quietBaseline.current = state.reactionTotal;
  wasQuiet.current = settings.quiet;
  const hiddenReactionCount = Math.max(0, state.reactionTotal - quietBaseline.current);

  /* ---------------- poll lifecycle ---------------- */

  const pollId = state.poll?.pollId ?? null;

  useEffect(() => {
    if (!pollId) return;
    setPollExpanded(true);
    // After a while the panel gets out of the way on its own; the professor
    // can bring it back from the strip.
    const timer = window.setTimeout(() => setPollExpanded(false), LIMITS.pollResultVisibleMs);
    return () => window.clearTimeout(timer);
  }, [pollId]);

  /*
   * Surge nudge.
   *
   * The professor is talking, not watching floaters. When a burst reaches a
   * meaningful share of the class, the control strip highlights so the signal
   * is caught peripherally — no sound, no popup, nothing to dismiss.
   */
  const presenceRef = useRef(state.presence);
  presenceRef.current = state.presence;

  useEffect(
    () =>
      subscribeBursts((burst) => {
        const threshold = Math.max(
          LIMITS.surgeMinCount,
          Math.ceil(presenceRef.current * LIMITS.surgeShareOfClass),
        );
        // A fault report is worth surfacing even from a couple of students:
        // if two people cannot hear, nobody at the back can.
        const floor = burst.type === 'blocked' ? 2 : threshold;
        if (burst.count < floor) return;
        setSurge(burst.type);
      }),
    [subscribeBursts],
  );

  // Clear the highlight a while after the most recent surge.
  useEffect(() => {
    if (!surge) return;
    const timer = window.setTimeout(() => setSurge(null), LIMITS.surgeHighlightMs);
    return () => window.clearTimeout(timer);
  }, [surge]);

  const onEndClass = useCallback(() => {
    endClass();
    void hideOverlay();
    void focusLauncher();
  }, [endClass]);

  return (
    <>
      {!isDesktop() && <SlidesBackdrop />}

      <FloatingReactions zone={settings.zone} quiet={settings.quiet} />
      <QuestionStack />

      {state.poll && pollExpanded && (
        <PollPanel
          results={state.poll}
          raised={popoverOpen}
          onMinimize={() => setPollExpanded(false)}
          onClose={() => {
            setPollExpanded(false);
            endPoll();
          }}
        />
      )}

      <ControlStrip
        code={state.code}
        connection={state.connection}
        settings={settings}
        onSettingsChange={updateSettings}
        hiddenReactionCount={hiddenReactionCount}
        onAskClass={() => startPoll('understanding')}
        onCustomPoll={(question, options) => startPoll('custom', question, options)}
        pollMinimized={Boolean(state.poll) && !pollExpanded}
        onExpandPoll={() => setPollExpanded(true)}
        shareUrl={joinBase && state.code ? joinUrl(joinBase, state.code) : null}
        surge={surge}
        onPopoverToggle={setPopoverOpen}
        onEndClass={onEndClass}
      />
    </>
  );
}
