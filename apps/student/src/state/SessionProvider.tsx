import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { LIMITS, type ReactionType } from '@lr/shared';
import { SessionSocket, type ConnState } from '../lib/socket';
import { forgetCode, getAnonId, rememberCode } from '../lib/storage';
import { initialState, reducer, type SessionState } from './reducer';

/** How long an answered question lingers, tinted, before it leaves the list. */
const RESOLVED_LINGER_MS = 2500;

interface SessionApi {
  state: SessionState;
  conn: ConnState;
  join: (code: string) => void;
  leave: () => void;
  sendReaction: (type: ReactionType) => void;
  sendQuestion: (text: string) => void;
  voteQuestion: (questionId: string) => void;
  answerPoll: (optionId: string) => void;
  clearNotice: () => void;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [socket] = useState(() => new SessionSocket());
  const [state, dispatch] = useReducer(reducer, initialState);
  const conn = useSyncExternalStore(socket.subscribeState, socket.getConnState);

  useEffect(() => {
    const unsubscribe = socket.onMessage((msg) => dispatch({ type: 'server', msg, now: Date.now() }));
    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, [socket]);

  // A join attempt that can't even open a socket deserves an inline explanation.
  useEffect(() => {
    if (conn === 'reconnecting') dispatch({ type: 'join/unreachable' });
  }, [conn]);

  const phase = state.phase;
  const code = state.code;

  useEffect(() => {
    if (phase === 'joined' && code) rememberCode(code);
    if (phase === 'ended') {
      forgetCode();
      socket.disconnect();
    }
    // A bad or finished code would otherwise be retried forever by the backoff.
    if (phase === 'error') socket.disconnect();
  }, [phase, code, socket]);

  // Answered questions fade out on their own so the list stays short.
  const dropTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = dropTimers.current;
    for (const [questionId, at] of Object.entries(state.resolvedAt)) {
      if (timers.has(questionId)) continue;
      const delay = Math.max(0, at + RESOLVED_LINGER_MS - Date.now());
      timers.set(
        questionId,
        setTimeout(() => {
          timers.delete(questionId);
          dispatch({ type: 'questions/drop', questionId });
        }, delay),
      );
    }
  }, [state.resolvedAt]);

  useEffect(() => {
    const timers = dropTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const join = useCallback(
    (nextCode: string) => {
      dispatch({ type: 'join/start', code: nextCode });
      socket.connect({ code: nextCode, anonId: getAnonId() });
    },
    [socket],
  );

  const leave = useCallback(() => {
    socket.disconnect();
    dispatch({ type: 'leave' });
  }, [socket]);

  const sendReaction = useCallback(
    (type: ReactionType) => {
      if (Date.now() < state.nextReactionAt) return;
      if (socket.send({ t: 'reaction', type })) {
        dispatch({ type: 'local/reaction', now: Date.now() });
      }
    },
    [socket, state.nextReactionAt],
  );

  const sendQuestion = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, LIMITS.questionMaxChars);
      if (!trimmed || Date.now() < state.nextQuestionAt) return;
      if (socket.send({ t: 'question:create', text: trimmed })) {
        dispatch({ type: 'local/question', now: Date.now() });
      }
    },
    [socket, state.nextQuestionAt],
  );

  const voteQuestion = useCallback(
    (questionId: string) => {
      if (socket.send({ t: 'question:vote', questionId })) {
        dispatch({ type: 'local/vote', questionId });
      }
    },
    [socket],
  );

  const pollId = state.poll?.id ?? null;
  const answerPoll = useCallback(
    (optionId: string) => {
      if (!pollId) return;
      if (socket.send({ t: 'poll:answer', pollId, optionId })) {
        dispatch({ type: 'local/pollAnswer', optionId });
      }
    },
    [socket, pollId],
  );

  const clearNotice = useCallback(() => dispatch({ type: 'notice/clear' }), []);

  const api = useMemo<SessionApi>(
    () => ({ state, conn, join, leave, sendReaction, sendQuestion, voteQuestion, answerPoll, clearNotice }),
    [state, conn, join, leave, sendReaction, sendQuestion, voteQuestion, answerPoll, clearNotice],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error('useSession must be used inside <SessionProvider>');
  return api;
}
