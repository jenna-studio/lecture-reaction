/**
 * Wire protocol shared by the professor overlay, the student web app and the
 * realtime server. Every websocket frame is JSON: { t: <type>, ...payload }.
 *
 * Design rules:
 *  - The server is the single source of truth. Clients never invent ids.
 *  - Nothing that identifies a student ever travels toward a professor client.
 *  - Reactions are ephemeral: broadcast as pre-grouped bursts, never stored.
 */

export const PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

export const REACTION_TYPES = [
  'understand',
  'confused',
  'too_fast',
  'too_slow',
  'again',
  'interesting',
] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export type PaletteKey = 'sky' | 'pink' | 'lavender' | 'mint' | 'yellow';

/** Font Awesome free-solid icon names, matching the product spec. */
export const REACTION_META: Record<
  ReactionType,
  { label: string; meaning: string; icon: string; accent: PaletteKey }
> = {
  understand:  { label: 'Understand',  meaning: 'I understand this.',         icon: 'check',       accent: 'mint' },
  confused:    { label: 'Confused',    meaning: "I'm confused.",              icon: 'question',    accent: 'pink' },
  too_fast:    { label: 'Too Fast',    meaning: "You're going too fast.",     icon: 'forward',     accent: 'sky' },
  too_slow:    { label: 'Too Slow',    meaning: "You're going too slowly.",   icon: 'backward',    accent: 'lavender' },
  again:       { label: 'Again',       meaning: 'Please explain that again.', icon: 'rotate-left', accent: 'sky' },
  interesting: { label: 'Interesting', meaning: 'This is interesting.',       icon: 'lightbulb',   accent: 'yellow' },
};

export function isReactionType(v: unknown): v is ReactionType {
  return typeof v === 'string' && (REACTION_TYPES as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Domain objects (the shapes clients actually render)                 */
/* ------------------------------------------------------------------ */

export type SessionStatus = 'active' | 'ended';

/** Public question shape. Deliberately carries no participant identity. */
export interface QuestionView {
  id: string;
  text: string;
  votes: number;
  createdAt: number;
  status: 'open' | 'resolved';
  /** Student-only hints about the current viewer. Never sent to professors. */
  mine?: boolean;
  voted?: boolean;
}

export type PollKind = 'understanding' | 'custom';

export interface PollOptionView {
  id: string;
  label: string;
}

/** Sent to students when a check/poll opens. */
export interface PollView {
  id: string;
  kind: PollKind;
  question: string;
  options: PollOptionView[];
  createdAt: number;
}

/** Sent to the professor as answers arrive. Counts only, never identities. */
export interface PollResultsView {
  pollId: string;
  kind: PollKind;
  question: string;
  total: number;
  results: { optionId: string; label: string; count: number; pct: number }[];
  endedAt?: number;
}

export const UNDERSTANDING_OPTIONS = [
  { id: 'got_it', label: 'Got it' },
  { id: 'almost', label: 'Almost' },
  { id: 'lost',   label: 'Lost' },
] as const;

/* ------------------------------------------------------------------ */
/* Client -> Server                                                    */
/* ------------------------------------------------------------------ */

export type ProfessorMsg =
  | { t: 'session:create'; resume?: { sessionId: string; token: string } }
  | { t: 'session:end' }
  | { t: 'question:resolve'; questionId: string }
  | { t: 'poll:start'; kind: PollKind; question?: string; options?: string[] }
  | { t: 'poll:end'; pollId: string }
  | { t: 'ping' };

export type StudentMsg =
  | { t: 'join'; code: string; anonId?: string }
  | { t: 'reaction'; type: ReactionType }
  | { t: 'question:create'; text: string }
  | { t: 'question:vote'; questionId: string }
  | { t: 'poll:answer'; pollId: string; optionId: string }
  | { t: 'ping' };

export type ClientMsg = ProfessorMsg | StudentMsg;

/* ------------------------------------------------------------------ */
/* Server -> Client                                                    */
/* ------------------------------------------------------------------ */

export type ErrorCode =
  | 'invalid_code'
  | 'session_ended'
  | 'rate_limited'
  | 'duplicate_vote'
  | 'too_long'
  | 'empty'
  | 'not_joined'
  | 'bad_request'
  | 'unauthorized';

/**
 * Which limit an error refers to. Without this a client receiving
 * `rate_limited` has to guess which of its own sends was rejected, which is
 * racy when a reaction and a question are in flight together.
 */
export type LimitScope = 'reaction' | 'question' | 'vote' | 'poll';

export type ServerMsg =
  /* both */
  | { t: 'error'; code: ErrorCode; message: string; scope?: LimitScope }
  | { t: 'pong' }
  | { t: 'session:ended'; at: number }
  /* professor */
  | { t: 'session:created'; sessionId: string; code: string; token: string; startedAt: number }
  | { t: 'presence'; count: number }
  | { t: 'reaction:burst'; id: string; type: ReactionType; count: number; at: number }
  /* both: questions */
  | { t: 'questions:sync'; questions: QuestionView[] }
  | { t: 'question:upsert'; question: QuestionView }
  | { t: 'question:resolved'; questionId: string; at: number }
  /* student */
  | { t: 'joined'; sessionId: string; code: string; anonId: string; startedAt: number }
  | { t: 'reaction:ack'; type: ReactionType; nextAllowedAt: number }
  /* polls */
  | { t: 'poll:open'; poll: PollView }
  | { t: 'poll:results'; results: PollResultsView }
  | { t: 'poll:closed'; pollId: string };

/* ------------------------------------------------------------------ */
/* Tunables — one place, so professor UX and server agree              */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  /** Session code length and its confusable-free alphabet. */
  codeLength: 5,
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  /** One reaction per student per this many ms. */
  reactionCooldownMs: 2000,
  /** Server-side burst window: reactions of one type inside it collapse to `× N`. */
  burstWindowMs: 1200,
  /** One question per student per this many ms. */
  questionCooldownMs: 15000,
  questionMaxChars: 200,
  /** Max question cards the overlay keeps on screen. */
  overlayMaxQuestions: 5,
  /** A resolved question lingers this long before it is dropped. */
  resolveFadeMs: 600,
  /** Floating reaction lifetime on the overlay. */
  reactionFloatMinMs: 2200,
  reactionFloatMaxMs: 4000,
  /** Poll results stay expanded this long, then minimize. */
  pollResultVisibleMs: 20000,
  /** A participant is considered gone after this much silence. */
  participantTimeoutMs: 45000,
  heartbeatMs: 15000,
} as const;

export type ReactionZone = 'left' | 'bottom' | 'both';
