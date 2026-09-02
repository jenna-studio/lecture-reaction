/**
 * React binding for the professor socket: one reducer, one websocket, exposed
 * through a context so the launcher and the overlay share identical semantics.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type { PollKind, ReactionType, ServerMsg } from '@lr/shared';
import { connectProfessor, type ProfessorSocket, type ResumeToken } from './socket';
import { professorSocketUrl } from './server';
import {
  initialSessionState,
  sessionReducer,
  type SessionState,
} from './sessionState';
import { readJson, removeKey, STORAGE_KEYS, writeJson } from './storage';

export interface Burst {
  id: string;
  type: ReactionType;
  count: number;
  at: number;
}

type BurstListener = (burst: Burst) => void;

interface PersistedSession extends ResumeToken {
  code: string;
}

export interface SessionApi {
  state: SessionState;
  /** Opens the socket (idempotent). The handshake resumes an existing class. */
  startClass: () => void;
  /**
   * Drops this window's socket WITHOUT ending the class. The launcher calls it
   * when it hands the class over to the overlay, so the server only ever sees
   * one professor connection per session.
   */
  disconnect: () => void;
  endClass: () => void;
  /** Forgets the class entirely, so START CLASS opens a fresh one. */
  reset: () => void;
  resolveQuestion: (questionId: string) => void;
  /** Removes a card once its exit animation has finished. */
  dropQuestion: (questionId: string) => void;
  startPoll: (kind: PollKind, question?: string, options?: string[]) => void;
  endPoll: () => void;
  /** Reaction bursts are transient, so they are pushed, not stored. */
  subscribeBursts: (listener: BurstListener) => () => void;
}

const SessionCtx = createContext<SessionApi | null>(null);

export type ConnectMode =
  /** Wait for an explicit `startClass()` — the launcher's START CLASS button. */
  | 'manual'
  /**
   * Wait until the launcher has persisted a session, then attach to THAT class
   * with a resume handshake. The overlay window exists (hidden) from app start,
   * so connecting eagerly would open a second, empty session.
   */
  | 'resume';

/** How often the overlay checks whether a class has been started. */
const RESUME_POLL_MS = 400;

export function SessionProvider({
  children,
  connect = 'manual',
}: {
  children: ReactNode;
  connect?: ConnectMode;
}) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const socketRef = useRef<ProfessorSocket | null>(null);
  const burstListeners = useRef(new Set<BurstListener>());
  /**
   * The session this window is currently attached to (or is mid-handshake for).
   * The resume watcher compares it against what the launcher has persisted, so
   * a *second* class started after the first one ends is picked up instead of
   * leaving the overlay showing a dead code.
   */
  const attachedSessionId = useRef<string | null>(null);

  const handleMessage = useCallback((msg: ServerMsg) => {
    if (msg.t === 'reaction:burst') {
      for (const listener of burstListeners.current) {
        listener({ id: msg.id, type: msg.type, count: msg.count, at: msg.at });
      }
    }
    if (msg.t === 'session:created') {
      attachedSessionId.current = msg.sessionId;
      const persisted: PersistedSession = {
        sessionId: msg.sessionId,
        token: msg.token,
        code: msg.code,
      };
      writeJson(STORAGE_KEYS.session, persisted);
    }
    if (msg.t === 'session:ended') {
      attachedSessionId.current = null;
      removeKey(STORAGE_KEYS.session);
    }
    if (msg.t === 'error' && (msg.code === 'unauthorized' || msg.code === 'session_ended')) {
      // A stale resume token would otherwise be replayed forever.
      attachedSessionId.current = null;
      removeKey(STORAGE_KEYS.session);
    }
    dispatch({ type: 'server', msg });
  }, []);

  const startClass = useCallback(() => {
    if (socketRef.current) return;
    socketRef.current = connectProfessor({
      url: professorSocketUrl(),
      getResume: () => {
        const saved = readJson<PersistedSession | null>(STORAGE_KEYS.session, null);
        return saved && saved.sessionId && saved.token
          ? { sessionId: saved.sessionId, token: saved.token }
          : null;
      },
      onMessage: handleMessage,
      onState: (connection) => dispatch({ type: 'connection', state: connection }),
    });
  }, [handleMessage]);

  useEffect(() => {
    let poll: number | undefined;

    if (connect === 'resume') {
      const attach = () => {
        const saved = readJson<PersistedSession | null>(STORAGE_KEYS.session, null);
        if (!saved?.sessionId || !saved.token) return;
        // Already on this class (or handshaking for it) — nothing to do.
        if (attachedSessionId.current === saved.sessionId) return;
        // A different class than the one we hold: drop the old socket first so
        // the server never sees two professor connections for one session.
        socketRef.current?.dispose();
        socketRef.current = null;
        attachedSessionId.current = saved.sessionId;
        startClass();
      };
      attach();
      // Deliberately never cleared: the professor may end a class and start
      // another one without the overlay window ever being torn down.
      poll = window.setInterval(attach, RESUME_POLL_MS);
    }

    return () => {
      if (poll !== undefined) window.clearInterval(poll);
      socketRef.current?.dispose();
      socketRef.current = null;
      attachedSessionId.current = null;
    };
  }, [connect, startClass]);

  const disconnect = useCallback(() => {
    socketRef.current?.dispose();
    socketRef.current = null;
  }, []);

  const endClass = useCallback(() => {
    socketRef.current?.send({ t: 'session:end' });
    removeKey(STORAGE_KEYS.session);
  }, []);

  const reset = useCallback(() => {
    socketRef.current?.dispose();
    socketRef.current = null;
    removeKey(STORAGE_KEYS.session);
    dispatch({ type: 'reset' });
  }, []);

  const resolveQuestion = useCallback((questionId: string) => {
    // Optimistic: the animation starts now, the server round-trip is noise.
    socketRef.current?.send({ t: 'question:resolve', questionId });
    dispatch({ type: 'resolve-optimistic', questionId, at: Date.now() });
  }, []);

  const dropQuestion = useCallback((questionId: string) => {
    dispatch({ type: 'drop-question', questionId });
  }, []);

  const startPoll = useCallback((kind: PollKind, question?: string, options?: string[]) => {
    socketRef.current?.send({ t: 'poll:start', kind, question, options });
  }, []);

  const pollIdRef = useRef<string | null>(null);
  pollIdRef.current = state.poll?.pollId ?? null;

  const endPoll = useCallback(() => {
    const pollId = pollIdRef.current;
    if (pollId) socketRef.current?.send({ t: 'poll:end', pollId });
  }, []);

  const subscribeBursts = useCallback((listener: BurstListener) => {
    burstListeners.current.add(listener);
    return () => {
      burstListeners.current.delete(listener);
    };
  }, []);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      startClass,
      disconnect,
      endClass,
      reset,
      resolveQuestion,
      dropQuestion,
      startPoll,
      endPoll,
      subscribeBursts,
    }),
    [state, startClass, disconnect, endClass, reset, resolveQuestion, dropQuestion, startPoll, endPoll, subscribeBursts],
  );

  return <SessionCtx.Provider value={api}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** Subscribe a stable handler to reaction bursts. */
export function useBursts(handler: BurstListener): void {
  const { subscribeBursts } = useSession();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeBursts((burst) => ref.current(burst)), [subscribeBursts]);
}
