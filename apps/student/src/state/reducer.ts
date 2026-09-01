import {
  LIMITS,
  type ErrorCode,
  type PollView,
  type QuestionView,
  type ServerMsg,
} from '@lr/shared';

export type Phase = 'idle' | 'joining' | 'joined' | 'ended' | 'error';

export interface Notice {
  tone: 'error' | 'info';
  text: string;
}

/** Which cooldown-bearing action we last sent, so a bare `rate_limited` can be
 *  attributed to the right control. The protocol's error carries no scope. */
type LimitScope = 'reaction' | 'question';

export interface SessionState {
  phase: Phase;
  code: string | null;
  sessionId: string | null;
  notice: Notice | null;
  questions: QuestionView[];
  /** questionId -> when the professor marked it answered, drives the exit animation */
  resolvedAt: Record<string, number>;
  poll: PollView | null;
  pollAnswer: string | null;
  nextReactionAt: number;
  nextQuestionAt: number;
  pendingLimit: LimitScope | null;
}

export const initialState: SessionState = {
  phase: 'idle',
  code: null,
  sessionId: null,
  notice: null,
  questions: [],
  resolvedAt: {},
  poll: null,
  pollAnswer: null,
  nextReactionAt: 0,
  nextQuestionAt: 0,
  pendingLimit: null,
};

export type Action =
  | { type: 'join/start'; code: string }
  | { type: 'join/unreachable' }
  | { type: 'leave' }
  | { type: 'server'; msg: ServerMsg; now: number }
  | { type: 'local/reaction'; now: number }
  | { type: 'local/question'; now: number }
  | { type: 'local/vote'; questionId: string }
  | { type: 'local/pollAnswer'; optionId: string }
  | { type: 'questions/drop'; questionId: string }
  | { type: 'notice/clear' };

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  invalid_code: "That code doesn't match a class right now.",
  session_ended: 'That class has already ended.',
  not_joined: 'You were disconnected from the class.',
  too_long: 'That question is a little too long.',
  empty: 'Type a question first.',
  duplicate_vote: 'You already voted for that question.',
};

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'join/start':
      return { ...initialState, phase: 'joining', code: action.code };

    case 'join/unreachable':
      return state.phase === 'joining'
        ? { ...state, notice: { tone: 'error', text: "Can't reach the server. Still trying…" } }
        : state;

    case 'leave':
      return initialState;

    case 'notice/clear':
      return state.notice ? { ...state, notice: null } : state;

    case 'local/reaction':
      return {
        ...state,
        pendingLimit: 'reaction',
        nextReactionAt: action.now + LIMITS.reactionCooldownMs,
      };

    case 'local/question':
      return {
        ...state,
        pendingLimit: 'question',
        notice: null,
        nextQuestionAt: action.now + LIMITS.questionCooldownMs,
      };

    case 'local/vote':
      return {
        ...state,
        questions: state.questions.map((q) =>
          q.id === action.questionId && !q.voted ? { ...q, voted: true, votes: q.votes + 1 } : q,
        ),
      };

    case 'local/pollAnswer':
      return { ...state, pollAnswer: action.optionId };

    case 'questions/drop': {
      const { [action.questionId]: _dropped, ...resolvedAt } = state.resolvedAt;
      return {
        ...state,
        resolvedAt,
        questions: state.questions.filter((q) => q.id !== action.questionId),
      };
    }

    case 'server':
      return applyServerMsg(state, action.msg, action.now);
  }
}

function applyServerMsg(state: SessionState, msg: ServerMsg, now: number): SessionState {
  switch (msg.t) {
    case 'joined':
      return {
        ...state,
        phase: 'joined',
        code: msg.code,
        sessionId: msg.sessionId,
        notice: null,
      };

    case 'session:ended':
      return { ...state, phase: 'ended', poll: null, pollAnswer: null, notice: null };

    case 'error':
      return applyError(state, msg.code, msg.message, now);

    case 'questions:sync':
      return { ...state, questions: msg.questions };

    case 'question:upsert': {
      const exists = state.questions.some((q) => q.id === msg.question.id);
      return {
        ...state,
        questions: exists
          ? state.questions.map((q) => (q.id === msg.question.id ? msg.question : q))
          : [...state.questions, msg.question],
      };
    }

    case 'question:resolved':
      if (!state.questions.some((q) => q.id === msg.questionId)) return state;
      return {
        ...state,
        resolvedAt: { ...state.resolvedAt, [msg.questionId]: msg.at },
        questions: state.questions.map((q) =>
          q.id === msg.questionId ? { ...q, status: 'resolved' } : q,
        ),
      };

    case 'reaction:ack':
      // The server is authoritative about when we may react again.
      return { ...state, nextReactionAt: msg.nextAllowedAt, pendingLimit: null };

    case 'poll:open':
      return {
        ...state,
        poll: msg.poll,
        pollAnswer: state.poll?.id === msg.poll.id ? state.pollAnswer : null,
      };

    case 'poll:closed':
      return state.poll?.id === msg.pollId ? { ...state, poll: null, pollAnswer: null } : state;

    /* Professor-facing frames and heartbeats: nothing for a student to render. */
    case 'pong':
    case 'presence':
    case 'reaction:burst':
    case 'poll:results':
    case 'session:created':
      return state;
  }
}

function applyError(
  state: SessionState,
  code: ErrorCode,
  message: string,
  now: number,
): SessionState {
  const text = ERROR_TEXT[code] ?? message;

  if (code === 'rate_limited') {
    // Reactions sync silently from `reaction:ack`; only the question composer
    // needs its quiet "you can ask again" line nudged forward.
    if (state.pendingLimit === 'question') {
      return {
        ...state,
        pendingLimit: null,
        nextQuestionAt: Math.max(state.nextQuestionAt, now + LIMITS.questionCooldownMs),
      };
    }
    return { ...state, pendingLimit: null };
  }

  if (code === 'duplicate_vote') return state; // the row already reads as voted

  if (state.phase === 'joining' && (code === 'invalid_code' || code === 'session_ended')) {
    return { ...state, phase: 'error', notice: { tone: 'error', text } };
  }

  return { ...state, notice: { tone: 'error', text } };
}

/** Highest voted first, newest first within a tie. */
export function sortQuestions(questions: QuestionView[]): QuestionView[] {
  return [...questions].sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
}
