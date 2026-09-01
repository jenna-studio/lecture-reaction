/**
 * In-memory domain store for the MVP.
 *
 * Everything here is deliberately expressed as a small set of methods so the
 * whole file can later be swapped for a Postgres/Supabase implementation
 * behind the same interface. The relational mapping it stands in for:
 *
 *   Session        (id pk, code unique-while-active, token, status, started_at, ended_at)
 *   Participant    (id pk, session_id fk, anon_id, joined_at, last_seen_at)
 *   Question       (id pk, session_id fk, author_participant_id fk, text, votes, created_at, status, resolved_at)
 *   QuestionVote   (question_id fk, participant_id fk, created_at)  -- pk(question_id, participant_id)
 *   Poll           (id pk, session_id fk, kind, question, created_at, ended_at)
 *   PollOption     (id pk, poll_id fk, label, ordinal)
 *   PollResponse   (poll_id fk, participant_id fk, option_id fk, answered_at) -- pk(poll_id, participant_id)
 *
 * Reactions are intentionally absent: they are ephemeral and never stored.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import {
  LIMITS,
  UNDERSTANDING_OPTIONS,
  generateCode,
  type PollKind,
  type PollOptionView,
  type PollResultsView,
  type PollView,
  type QuestionView,
  type SessionStatus,
} from '@lr/shared';

/** Hard cap on stored questions per session (defensive, see hub). */
export const MAX_QUESTIONS_PER_SESSION = 200;

/** How long an ended session lingers so late joiners hear `session_ended`. */
export const ENDED_GRACE_MS = 60_000;

/** A session with no professor socket for this long is reaped. */
export const ORPHAN_SESSION_MS = 10 * 60_000;

export interface Participant {
  anonId: string;
  joinedAt: number;
  lastSeenAt: number;
  /** Whether a socket is currently attached — drives the presence count. */
  present: boolean;
  lastReactionAt: number;
  lastQuestionAt: number;
}

export interface Question {
  id: string;
  text: string;
  votes: number;
  createdAt: number;
  status: 'open' | 'resolved';
  resolvedAt?: number;
  /** Never leaves the store toward a professor. */
  authorAnonId: string;
  /** QuestionVote rows, keyed by participant. */
  voters: Set<string>;
}

export interface Poll {
  id: string;
  kind: PollKind;
  question: string;
  options: PollOptionView[];
  createdAt: number;
  endedAt?: number;
  /** PollResponse rows: one option per participant, replaceable. */
  responses: Map<string, string>;
}

export interface Session {
  id: string;
  code: string;
  /** 32-hex professor secret; authorizes resume and all professor actions. */
  token: string;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  /** Set when the last professor socket detaches; cleared when one attaches. */
  professorGoneSince?: number;
  participants: Map<string, Participant>;
  questions: Map<string, Question>;
  poll: Poll | null;
}

export type AddQuestionResult =
  | { ok: true; question: Question }
  | { ok: false; reason: 'rate_limited' };

export type VoteResult =
  | { ok: true; question: Question }
  | { ok: false; reason: 'duplicate_vote' | 'not_found' };

export class Store {
  private readonly sessions = new Map<string, Session>();
  /** code -> sessionId, for every session we still remember (active or in grace). */
  private readonly byCode = new Map<string, string>();

  /* ---------------------------------------------------------------- */
  /* Sessions                                                          */
  /* ---------------------------------------------------------------- */

  createSession(now = Date.now()): Session {
    const code = generateCode((c) => this.isCodeTaken(c));
    const session: Session = {
      id: randomUUID(),
      code,
      token: randomBytes(16).toString('hex'),
      status: 'active',
      startedAt: now,
      participants: new Map(),
      questions: new Map(),
      poll: null,
    };
    this.sessions.set(session.id, session);
    this.byCode.set(code, session.id);
    return session;
  }

  /** A code is unavailable while any remembered session still holds it. */
  private isCodeTaken(code: string): boolean {
    return this.byCode.has(code);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getByCode(code: string): Session | undefined {
    const id = this.byCode.get(code);
    return id ? this.sessions.get(id) : undefined;
  }

  /** Sessions still accepting joins. */
  activeSessionCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.status === 'active') n++;
    return n;
  }

  allSessions(): Iterable<Session> {
    return this.sessions.values();
  }

  endSession(session: Session, now = Date.now()): void {
    session.status = 'ended';
    session.endedAt = now;
    session.poll = null;
  }

  /** Forget a session entirely, freeing its code for reuse. */
  dropSession(session: Session): void {
    this.sessions.delete(session.id);
    if (this.byCode.get(session.code) === session.id) this.byCode.delete(session.code);
  }

  /**
   * Housekeeping: drop ended sessions past their grace period and active
   * sessions whose professor has been gone too long. Returns reaped sessions
   * so the caller can tear down sockets/timers.
   */
  reap(now = Date.now()): Session[] {
    const reaped: Session[] = [];
    for (const s of this.sessions.values()) {
      const endedTooLongAgo =
        s.status === 'ended' && s.endedAt !== undefined && now - s.endedAt > ENDED_GRACE_MS;
      const orphaned =
        s.status === 'active' &&
        s.professorGoneSince !== undefined &&
        now - s.professorGoneSince > ORPHAN_SESSION_MS;
      if (endedTooLongAgo || orphaned) reaped.push(s);
    }
    for (const s of reaped) this.dropSession(s);
    return reaped;
  }

  /* ---------------------------------------------------------------- */
  /* Participants                                                      */
  /* ---------------------------------------------------------------- */

  /** Reuses the participant row when the client presents a known anonId. */
  joinParticipant(session: Session, anonId: string | undefined, now = Date.now()): Participant {
    const existing = anonId ? session.participants.get(anonId) : undefined;
    if (existing) {
      existing.present = true;
      existing.lastSeenAt = now;
      return existing;
    }
    const participant: Participant = {
      anonId: anonId && anonId.length <= 64 ? anonId : randomUUID(),
      joinedAt: now,
      lastSeenAt: now,
      present: true,
      lastReactionAt: 0,
      lastQuestionAt: 0,
    };
    session.participants.set(participant.anonId, participant);
    return participant;
  }

  setPresence(session: Session, anonId: string, present: boolean, now = Date.now()): void {
    const p = session.participants.get(anonId);
    if (!p) return;
    p.present = present;
    p.lastSeenAt = now;
  }

  touch(session: Session, anonId: string, now = Date.now()): void {
    const p = session.participants.get(anonId);
    if (p) p.lastSeenAt = now;
  }

  presenceCount(session: Session): number {
    let n = 0;
    for (const p of session.participants.values()) if (p.present) n++;
    return n;
  }

  /* ---------------------------------------------------------------- */
  /* Reactions (no rows, just the per-participant cooldown clock)      */
  /* ---------------------------------------------------------------- */

  /** Returns the timestamp the participant may react again, or null if too soon. */
  tryReaction(session: Session, anonId: string, now = Date.now()): number | null {
    const p = session.participants.get(anonId);
    if (!p) return null;
    if (now - p.lastReactionAt < LIMITS.reactionCooldownMs) return null;
    p.lastReactionAt = now;
    p.lastSeenAt = now;
    return now + LIMITS.reactionCooldownMs;
  }

  /* ---------------------------------------------------------------- */
  /* Questions                                                         */
  /* ---------------------------------------------------------------- */

  addQuestion(
    session: Session,
    anonId: string,
    text: string,
    now = Date.now(),
  ): AddQuestionResult {
    const p = session.participants.get(anonId);
    if (!p) return { ok: false, reason: 'rate_limited' };
    if (now - p.lastQuestionAt < LIMITS.questionCooldownMs) return { ok: false, reason: 'rate_limited' };
    if (session.questions.size >= MAX_QUESTIONS_PER_SESSION) return { ok: false, reason: 'rate_limited' };

    p.lastQuestionAt = now;
    p.lastSeenAt = now;
    const question: Question = {
      id: randomUUID(),
      text,
      // The author implicitly upvotes their own question.
      votes: 1,
      createdAt: now,
      status: 'open',
      authorAnonId: anonId,
      voters: new Set([anonId]),
    };
    session.questions.set(question.id, question);
    return { ok: true, question };
  }

  voteQuestion(session: Session, anonId: string, questionId: string): VoteResult {
    const q = session.questions.get(questionId);
    if (!q) return { ok: false, reason: 'not_found' };
    if (q.voters.has(anonId)) return { ok: false, reason: 'duplicate_vote' };
    q.voters.add(anonId);
    q.votes += 1;
    return { ok: true, question: q };
  }

  resolveQuestion(session: Session, questionId: string, now = Date.now()): Question | undefined {
    const q = session.questions.get(questionId);
    if (!q) return undefined;
    q.status = 'resolved';
    q.resolvedAt = now;
    return q;
  }

  openQuestions(session: Session): Question[] {
    return [...session.questions.values()].filter((q) => q.status === 'open');
  }

  /* ---------------------------------------------------------------- */
  /* Polls                                                             */
  /* ---------------------------------------------------------------- */

  /** Starts a poll, implicitly closing any poll already open. */
  startPoll(
    session: Session,
    kind: PollKind,
    question: string,
    options: PollOptionView[],
    now = Date.now(),
  ): Poll {
    const poll: Poll = {
      id: randomUUID(),
      kind,
      question,
      options,
      createdAt: now,
      responses: new Map(),
    };
    session.poll = poll;
    return poll;
  }

  endPoll(session: Session, pollId: string, now = Date.now()): Poll | undefined {
    const poll = session.poll;
    if (!poll || poll.id !== pollId) return undefined;
    poll.endedAt = now;
    session.poll = null;
    return poll;
  }

  /** One response per participant; re-answering replaces the previous choice. */
  answerPoll(session: Session, anonId: string, pollId: string, optionId: string): Poll | undefined {
    const poll = session.poll;
    if (!poll || poll.id !== pollId) return undefined;
    if (!poll.options.some((o) => o.id === optionId)) return undefined;
    poll.responses.set(anonId, optionId);
    return poll;
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/**
 * PRIVACY BOUNDARY.
 * The single place a stored Question is converted for a professor client.
 * It must never carry `authorAnonId`, `voters`, `mine`, `voted`, or anything
 * else that could identify or single out a student. If you need a new field
 * on the professor side, add it here and nowhere else.
 */
export function toProfessorView(q: Question): QuestionView {
  return { id: q.id, text: q.text, votes: q.votes, createdAt: q.createdAt, status: q.status };
}

/** Student view: the public fields plus hints about *this* viewer only. */
export function toStudentView(q: Question, viewerAnonId: string): QuestionView {
  return {
    ...toProfessorView(q),
    mine: q.authorAnonId === viewerAnonId,
    voted: q.voters.has(viewerAnonId),
  };
}

export function toPollView(poll: Poll): PollView {
  return {
    id: poll.id,
    kind: poll.kind,
    question: poll.question,
    options: poll.options,
    createdAt: poll.createdAt,
  };
}

/** Aggregate counts only — never which participant chose what. */
export function toPollResultsView(poll: Poll): PollResultsView {
  const counts = new Map<string, number>();
  for (const optionId of poll.responses.values()) {
    counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
  }
  const total = poll.responses.size;
  return {
    pollId: poll.id,
    kind: poll.kind,
    question: poll.question,
    total,
    results: poll.options.map((o) => {
      const count = counts.get(o.id) ?? 0;
      return {
        optionId: o.id,
        label: o.label,
        count,
        pct: total === 0 ? 0 : Math.round((count / total) * 100),
      };
    }),
    ...(poll.endedAt !== undefined ? { endedAt: poll.endedAt } : {}),
  };
}

/** Builds the option list for a poll:start request. */
export function buildPollOptions(
  kind: PollKind,
  rawQuestion: unknown,
  rawOptions: unknown,
): { question: string; options: PollOptionView[] } | null {
  if (kind === 'understanding') {
    return {
      question: 'How are we doing?',
      options: UNDERSTANDING_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    };
  }
  if (!Array.isArray(rawOptions)) return null;
  const labels = rawOptions
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.trim().slice(0, 40))
    .filter((l) => l.length > 0);
  if (labels.length < 2 || labels.length > 6) return null;
  const question =
    typeof rawQuestion === 'string' && rawQuestion.trim().length > 0
      ? rawQuestion.trim().slice(0, 200)
      : 'Quick poll';
  return { question, options: labels.map((label, i) => ({ id: `opt_${i}`, label })) };
}
