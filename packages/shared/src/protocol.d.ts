/**
 * Wire protocol shared by the professor overlay, the student web app and the
 * realtime server. Every websocket frame is JSON: { t: <type>, ...payload }.
 *
 * Design rules:
 *  - The server is the single source of truth. Clients never invent ids.
 *  - Nothing that identifies a student ever travels toward a professor client.
 *  - Reactions are ephemeral: broadcast as pre-grouped bursts, never stored.
 */
export declare const PROTOCOL_VERSION = 1;
export declare const REACTION_TYPES: readonly ["understand", "confused", "too_fast", "too_slow", "again", "interesting"];
export type ReactionType = (typeof REACTION_TYPES)[number];
export type PaletteKey = 'sky' | 'pink' | 'lavender' | 'mint' | 'yellow';
/** Font Awesome free-solid icon names, matching the product spec. */
export declare const REACTION_META: Record<ReactionType, {
    label: string;
    meaning: string;
    icon: string;
    accent: PaletteKey;
}>;
export declare function isReactionType(v: unknown): v is ReactionType;
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
    results: {
        optionId: string;
        label: string;
        count: number;
        pct: number;
    }[];
    endedAt?: number;
}
export declare const UNDERSTANDING_OPTIONS: readonly [{
    readonly id: "got_it";
    readonly label: "Got it";
}, {
    readonly id: "almost";
    readonly label: "Almost";
}, {
    readonly id: "lost";
    readonly label: "Lost";
}];
export type ProfessorMsg = {
    t: 'session:create';
    resume?: {
        sessionId: string;
        token: string;
    };
} | {
    t: 'session:end';
} | {
    t: 'question:resolve';
    questionId: string;
} | {
    t: 'poll:start';
    kind: PollKind;
    question?: string;
    options?: string[];
} | {
    t: 'poll:end';
    pollId: string;
} | {
    t: 'ping';
};
export type StudentMsg = {
    t: 'join';
    code: string;
    anonId?: string;
} | {
    t: 'reaction';
    type: ReactionType;
} | {
    t: 'question:create';
    text: string;
} | {
    t: 'question:vote';
    questionId: string;
} | {
    t: 'poll:answer';
    pollId: string;
    optionId: string;
} | {
    t: 'ping';
};
export type ClientMsg = ProfessorMsg | StudentMsg;
export type ErrorCode = 'invalid_code' | 'session_ended' | 'rate_limited' | 'duplicate_vote' | 'too_long' | 'empty' | 'not_joined' | 'bad_request' | 'unauthorized';
/**
 * Which limit an error refers to. Without this a client receiving
 * `rate_limited` has to guess which of its own sends was rejected, which is
 * racy when a reaction and a question are in flight together.
 */
export type LimitScope = 'reaction' | 'question' | 'vote' | 'poll';
export type ServerMsg = {
    t: 'error';
    code: ErrorCode;
    message: string;
    scope?: LimitScope;
} | {
    t: 'pong';
} | {
    t: 'session:ended';
    at: number;
} | {
    t: 'session:created';
    sessionId: string;
    code: string;
    token: string;
    startedAt: number;
} | {
    t: 'presence';
    count: number;
} | {
    t: 'reaction:burst';
    id: string;
    type: ReactionType;
    count: number;
    at: number;
} | {
    t: 'questions:sync';
    questions: QuestionView[];
} | {
    t: 'question:upsert';
    question: QuestionView;
} | {
    t: 'question:resolved';
    questionId: string;
    at: number;
} | {
    t: 'joined';
    sessionId: string;
    code: string;
    anonId: string;
    startedAt: number;
} | {
    t: 'reaction:ack';
    type: ReactionType;
    nextAllowedAt: number;
} | {
    t: 'poll:open';
    poll: PollView;
} | {
    t: 'poll:results';
    results: PollResultsView;
} | {
    t: 'poll:closed';
    pollId: string;
};
export declare const LIMITS: {
    /** Session code length and its confusable-free alphabet. */
    readonly codeLength: 5;
    readonly codeAlphabet: "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    /** One reaction per student per this many ms. */
    readonly reactionCooldownMs: 2000;
    /** Server-side burst window: reactions of one type inside it collapse to `× N`. */
    readonly burstWindowMs: 1200;
    /** One question per student per this many ms. */
    readonly questionCooldownMs: 15000;
    readonly questionMaxChars: 200;
    /** Max question cards the overlay keeps on screen. */
    readonly overlayMaxQuestions: 5;
    /** A resolved question lingers this long before it is dropped. */
    readonly resolveFadeMs: 600;
    /** Floating reaction lifetime on the overlay. */
    readonly reactionFloatMinMs: 2200;
    readonly reactionFloatMaxMs: 4000;
    /** Poll results stay expanded this long, then minimize. */
    readonly pollResultVisibleMs: 20000;
    /** A participant is considered gone after this much silence. */
    readonly participantTimeoutMs: 45000;
    readonly heartbeatMs: 15000;
};
export type ReactionZone = 'left' | 'bottom' | 'both';
