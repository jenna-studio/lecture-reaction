/**
 * The single reducer behind the whole professor client. No external store
 * library: one shape, one transition function, easy to reason about.
 */

import { LIMITS, type PollResultsView, type QuestionView, type ServerMsg } from '@lr/shared';
import type { ConnectionState } from './socket';

export type ClassStatus = 'idle' | 'active' | 'ended';

export interface SessionState {
  connection: ConnectionState;
  status: ClassStatus;
  sessionId: string | null;
  code: string | null;
  token: string | null;
  startedAt: number | null;
  /** Aggregate count only — never anything identifying a student. */
  presence: number;
  questions: Record<string, QuestionView>;
  /** id -> timestamp the resolve animation began. Used for the exit fade. */
  exiting: Record<string, number>;
  poll: PollResultsView | null;
  /** Running total of reaction *instances* seen this class (for Quiet Mode). */
  reactionTotal: number;
  lastError: string | null;
}

export const initialSessionState: SessionState = {
  connection: 'connecting',
  status: 'idle',
  sessionId: null,
  code: null,
  token: null,
  startedAt: null,
  presence: 0,
  questions: {},
  exiting: {},
  poll: null,
  reactionTotal: 0,
  lastError: null,
};

export type SessionAction =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'server'; msg: ServerMsg }
  /** Optimistic: the card starts leaving before the server confirms. */
  | { type: 'resolve-optimistic'; questionId: string; at: number }
  | { type: 'drop-question'; questionId: string }
  | { type: 'reset' };

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'connection':
      return { ...state, connection: action.state };

    case 'resolve-optimistic': {
      const question = state.questions[action.questionId];
      if (!question || question.status === 'resolved') return state;
      return {
        ...state,
        questions: {
          ...state.questions,
          [action.questionId]: { ...question, status: 'resolved' },
        },
        exiting: { ...state.exiting, [action.questionId]: action.at },
      };
    }

    case 'drop-question':
      return {
        ...state,
        questions: withoutKey(state.questions, action.questionId),
        exiting: withoutKey(state.exiting, action.questionId),
      };

    case 'reset':
      return { ...initialSessionState, connection: state.connection };

    case 'server':
      return applyServerMsg(state, action.msg);

    default:
      return state;
  }
}

function applyServerMsg(state: SessionState, msg: ServerMsg): SessionState {
  switch (msg.t) {
    case 'session:created':
      return {
        ...state,
        status: 'active',
        sessionId: msg.sessionId,
        code: msg.code,
        token: msg.token,
        startedAt: msg.startedAt,
        lastError: null,
      };

    case 'session:ended':
      return { ...state, status: 'ended', presence: 0, poll: null };

    case 'presence':
      return { ...state, presence: msg.count };

    case 'reaction:burst':
      // The floating layer consumes the burst itself (see SessionContext);
      // the reducer only keeps the aggregate for Quiet Mode's counter.
      return { ...state, reactionTotal: state.reactionTotal + msg.count };

    case 'questions:sync': {
      const questions: Record<string, QuestionView> = {};
      for (const q of msg.questions) questions[q.id] = q;
      return { ...state, questions, exiting: {} };
    }

    case 'question:upsert': {
      // Do not resurrect a card that is mid-exit.
      if (state.exiting[msg.question.id] !== undefined) return state;
      return { ...state, questions: { ...state.questions, [msg.question.id]: msg.question } };
    }

    case 'question:resolved': {
      const question = state.questions[msg.questionId];
      if (!question) return state;
      if (state.exiting[msg.questionId] !== undefined) return state; // already leaving
      return {
        ...state,
        questions: { ...state.questions, [msg.questionId]: { ...question, status: 'resolved' } },
        exiting: { ...state.exiting, [msg.questionId]: msg.at },
      };
    }

    case 'poll:results':
      return { ...state, poll: msg.results };

    case 'poll:closed':
      return state.poll?.pollId === msg.pollId ? { ...state, poll: null } : state;

    case 'error':
      return { ...state, lastError: msg.message };

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export interface QuestionCard extends QuestionView {
  /** Playing the resolve exit animation. */
  exiting: boolean;
}

export interface QuestionStackView {
  /** Oldest first — the stack renders newest at the bottom. */
  cards: QuestionCard[];
  /** How many open questions did not make the cut. */
  overflow: number;
}

/**
 * Priority: highest votes first, then most recent. The chosen cards are then
 * re-sorted by age so the newest sits at the bottom, where the professor's eye
 * naturally rests. Cards that are mid-exit keep their slot until they finish.
 */
export function selectQuestionStack(
  state: SessionState,
  max: number = LIMITS.overlayMaxQuestions,
): QuestionStackView {
  const all = Object.values(state.questions);
  const open = all.filter((q) => q.status === 'open');
  const leaving = all.filter((q) => state.exiting[q.id] !== undefined);

  const ranked = [...open].sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
  const kept = ranked.slice(0, max);
  const overflow = Math.max(0, open.length - kept.length);

  const cards: QuestionCard[] = [...kept, ...leaving]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((q) => ({ ...q, exiting: state.exiting[q.id] !== undefined }));

  return { cards, overflow };
}
