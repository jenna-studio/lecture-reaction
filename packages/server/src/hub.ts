/**
 * Websocket hub: connection lifecycle, message routing and broadcast.
 *
 * Invariants worth keeping in mind while editing:
 *  - Every inbound frame is handled inside try/catch. One bad client must
 *    never be able to take the process down.
 *  - Anything sent toward a professor socket goes through `toProfessorView`
 *    (see store.ts) or is aggregate-only. No student identity, ever.
 *  - A professor socket disconnecting does NOT end the class.
 */

import type { WebSocket } from 'ws';
import {
  LIMITS,
  isReactionType,
  normalizeCode,
  type ClientMsg,
  type ErrorCode,
  type LimitScope,
  type PollKind,
  type ServerMsg,
} from '@lr/shared';
import { BurstAggregator, type Burst } from './burst.js';
import {
  Store,
  buildPollOptions,
  toPollResultsView,
  toPollView,
  toProfessorView,
  toStudentView,
  type Question,
  type Session,
} from './store.js';

export type Role = 'professor' | 'student';

/** Presence updates are coalesced over this window. */
const PRESENCE_DEBOUNCE_MS = 500;
/** Live poll results are sent to the professor at most this often. */
const POLL_RESULTS_THROTTLE_MS = 200;
/** How often orphaned / expired sessions are swept. */
const REAP_INTERVAL_MS = 30_000;

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  invalid_code: 'That class code is not valid.',
  session_ended: 'This class has ended.',
  rate_limited: 'Slow down a moment.',
  duplicate_vote: 'You already voted on this question.',
  too_long: `Questions are limited to ${LIMITS.questionMaxChars} characters.`,
  empty: 'Type a question first.',
  not_joined: 'Join a class first.',
  bad_request: 'Unrecognised message.',
  unauthorized: 'Not authorised for this session.',
};

interface ConnState {
  role: Role;
  sessionId?: string;
  /** Students only. */
  anonId?: string;
  /** Consecutive heartbeats with no pong; two misses terminate the socket. */
  missedPongs: number;
}

/** Per-session scheduling state that must be torn down with the session. */
interface SessionTimers {
  presence?: NodeJS.Timeout;
  pollResults?: NodeJS.Timeout;
  lastPollResultsAt: number;
}

export class Hub {
  readonly store = new Store();

  private readonly conns = new Map<WebSocket, ConnState>();
  private readonly professors = new Map<string, Set<WebSocket>>();
  private readonly students = new Map<string, Set<WebSocket>>();
  private readonly timers = new Map<string, SessionTimers>();

  private readonly bursts = new BurstAggregator((sessionId, burst) =>
    this.sendBurst(sessionId, burst),
  );

  private readonly heartbeat: NodeJS.Timeout;
  private readonly reaper: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.runHeartbeat(), LIMITS.heartbeatMs);
    this.heartbeat.unref?.();
    this.reaper = setInterval(() => this.runReaper(), REAP_INTERVAL_MS);
    this.reaper.unref?.();
  }

  /** For tests / graceful shutdown. */
  dispose(): void {
    clearInterval(this.heartbeat);
    clearInterval(this.reaper);
    this.bursts.clearAll();
    for (const sessionId of [...this.timers.keys()]) this.clearTimers(sessionId);
  }

  /* ---------------------------------------------------------------- */
  /* Connection lifecycle                                              */
  /* ---------------------------------------------------------------- */

  handleConnection(ws: WebSocket, role: Role): void {
    this.conns.set(ws, { role, missedPongs: 0 });

    ws.on('pong', () => {
      const state = this.conns.get(ws);
      if (state) state.missedPongs = 0;
    });

    ws.on('message', (data) => {
      // A malformed frame must produce an error frame, never an exception.
      try {
        this.handleMessage(ws, typeof data === 'string' ? data : data.toString());
      } catch (err) {
        console.error('[hub] message handler failed:', err);
        this.safeSend(ws, { t: 'error', code: 'bad_request', message: ERROR_MESSAGES.bad_request });
      }
    });

    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (err) => {
      console.error('[hub] socket error:', err);
    });
  }

  private handleClose(ws: WebSocket): void {
    const state = this.conns.get(ws);
    this.conns.delete(ws);
    if (!state?.sessionId) return;

    const sessionId = state.sessionId;
    const session = this.store.getSession(sessionId);

    if (state.role === 'professor') {
      const set = this.professors.get(sessionId);
      set?.delete(ws);
      if (set && set.size === 0) {
        this.professors.delete(sessionId);
        // Losing the overlay is not the end of the class — start the orphan clock.
        if (session && session.status === 'active') session.professorGoneSince = Date.now();
      }
      return;
    }

    this.students.get(sessionId)?.delete(ws);
    if (session && state.anonId) {
      // A closed socket means immediately not-present for the count.
      this.store.setPresence(session, state.anonId, false);
      this.schedulePresence(session);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Routing                                                           */
  /* ---------------------------------------------------------------- */

  private handleMessage(ws: WebSocket, raw: string): void {
    const state = this.conns.get(ws);
    if (!state) return;

    let msg: ClientMsg;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { t?: unknown }).t !== 'string') {
        return this.fail(ws, 'bad_request');
      }
      msg = parsed as ClientMsg;
    } catch {
      return this.fail(ws, 'bad_request');
    }

    if (msg.t === 'ping') return this.safeSend(ws, { t: 'pong' });

    if (state.role === 'professor') this.handleProfessor(ws, state, msg);
    else this.handleStudent(ws, state, msg);
  }

  private handleProfessor(ws: WebSocket, state: ConnState, msg: ClientMsg): void {
    switch (msg.t) {
      case 'session:create':
        return this.onSessionCreate(ws, state, msg.resume);
      case 'session:end':
        return this.onSessionEnd(ws, state);
      case 'question:resolve':
        return this.onQuestionResolve(ws, state, msg.questionId);
      case 'poll:start':
        return this.onPollStart(ws, state, msg.kind, msg.question, msg.options);
      case 'poll:end':
        return this.onPollEnd(ws, state, msg.pollId);
      default:
        return this.fail(ws, 'bad_request');
    }
  }

  private handleStudent(ws: WebSocket, state: ConnState, msg: ClientMsg): void {
    if (msg.t === 'join') return this.onJoin(ws, state, msg.code, msg.anonId);

    const session = state.sessionId ? this.store.getSession(state.sessionId) : undefined;
    const anonId = state.anonId;
    if (!session || !anonId) return this.fail(ws, 'not_joined');
    if (session.status === 'ended') return this.fail(ws, 'session_ended');
    this.store.touch(session, anonId);

    switch (msg.t) {
      case 'reaction':
        return this.onReaction(ws, session, anonId, msg.type);
      case 'question:create':
        return this.onQuestionCreate(ws, session, anonId, msg.text);
      case 'question:vote':
        return this.onQuestionVote(ws, session, anonId, msg.questionId);
      case 'poll:answer':
        return this.onPollAnswer(ws, session, anonId, msg.pollId, msg.optionId);
      default:
        return this.fail(ws, 'bad_request');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Professor handlers                                                */
  /* ---------------------------------------------------------------- */

  private onSessionCreate(
    ws: WebSocket,
    state: ConnState,
    resume?: { sessionId: string; token: string },
  ): void {
    let session: Session | undefined;

    // Resume keeps the same code/token so an overlay crash never ends a class.
    if (resume && typeof resume.sessionId === 'string' && typeof resume.token === 'string') {
      const candidate = this.store.getSession(resume.sessionId);
      if (candidate && candidate.status === 'active' && candidate.token === resume.token) {
        session = candidate;
      }
    }
    if (!session) session = this.store.createSession();

    this.attachProfessor(ws, state, session);

    this.safeSend(ws, {
      t: 'session:created',
      sessionId: session.id,
      code: session.code,
      token: session.token,
      startedAt: session.startedAt,
    });

    // Fresh overlay: hand it the current world.
    this.safeSend(ws, {
      t: 'questions:sync',
      questions: this.store.openQuestions(session).map(toProfessorView),
    });
    this.safeSend(ws, { t: 'presence', count: this.store.presenceCount(session) });
    if (session.poll) {
      this.safeSend(ws, { t: 'poll:results', results: toPollResultsView(session.poll) });
    }
  }

  private attachProfessor(ws: WebSocket, state: ConnState, session: Session): void {
    // A socket may only ever be bound to one session.
    if (state.sessionId && state.sessionId !== session.id) {
      this.professors.get(state.sessionId)?.delete(ws);
    }
    state.sessionId = session.id;
    delete session.professorGoneSince;

    let set = this.professors.get(session.id);
    if (!set) {
      set = new Set();
      this.professors.set(session.id, set);
    }
    set.add(ws);
  }

  /** Resolves the session a professor socket is authorised for. */
  private professorSession(ws: WebSocket, state: ConnState): Session | undefined {
    const session = state.sessionId ? this.store.getSession(state.sessionId) : undefined;
    if (!session) {
      this.fail(ws, 'unauthorized');
      return undefined;
    }
    if (session.status === 'ended') {
      this.fail(ws, 'session_ended');
      return undefined;
    }
    return session;
  }

  private onSessionEnd(ws: WebSocket, state: ConnState): void {
    const session = this.professorSession(ws, state);
    if (!session) return;

    const at = Date.now();
    this.store.endSession(session, at);
    this.bursts.clearSession(session.id);
    this.clearTimers(session.id);

    const ended: ServerMsg = { t: 'session:ended', at };
    for (const sock of this.professors.get(session.id) ?? []) this.safeSend(sock, ended);

    const studentSockets = this.students.get(session.id);
    for (const sock of studentSockets ?? []) {
      this.safeSend(sock, ended);
      try {
        sock.close(1000, 'session ended');
      } catch {
        /* already gone */
      }
    }
    this.students.delete(session.id);
    // The session object itself lingers (see ENDED_GRACE_MS) so that late
    // joiners are told `session_ended` rather than `invalid_code`.
  }

  private onQuestionResolve(ws: WebSocket, state: ConnState, questionId: string): void {
    const session = this.professorSession(ws, state);
    if (!session) return;
    if (typeof questionId !== 'string') return this.fail(ws, 'bad_request');

    const at = Date.now();
    const q = this.store.resolveQuestion(session, questionId, at);
    if (!q) return this.fail(ws, 'bad_request');

    const frame: ServerMsg = { t: 'question:resolved', questionId: q.id, at };
    this.toProfessors(session.id, frame);
    this.toStudents(session.id, () => frame);
  }

  private onPollStart(
    ws: WebSocket,
    state: ConnState,
    kind: PollKind,
    question: string | undefined,
    options: string[] | undefined,
  ): void {
    const session = this.professorSession(ws, state);
    if (!session) return;
    if (kind !== 'understanding' && kind !== 'custom') return this.fail(ws, 'bad_request');

    const built = buildPollOptions(kind, question, options);
    if (!built) return this.fail(ws, 'bad_request');

    // Only one poll open at a time: close the previous one first.
    if (session.poll) this.closePoll(session, session.poll.id);

    const poll = this.store.startPoll(session, kind, built.question, built.options);
    const open: ServerMsg = { t: 'poll:open', poll: toPollView(poll) };
    this.toStudents(session.id, () => open);
    // Professor sees an all-zero board immediately.
    this.sendPollResults(session, true);
  }

  private onPollEnd(ws: WebSocket, state: ConnState, pollId: string): void {
    const session = this.professorSession(ws, state);
    if (!session) return;
    if (typeof pollId !== 'string') return this.fail(ws, 'bad_request');
    if (!this.closePoll(session, pollId)) return this.fail(ws, 'bad_request');
  }

  /** Closes the open poll: students hear `poll:closed`, professor gets finals. */
  private closePoll(session: Session, pollId: string): boolean {
    const poll = this.store.endPoll(session, pollId);
    if (!poll) return false;

    const closed: ServerMsg = { t: 'poll:closed', pollId: poll.id };
    this.toStudents(session.id, () => closed);

    const timers = this.timers.get(session.id);
    if (timers?.pollResults) {
      clearTimeout(timers.pollResults);
      delete timers.pollResults;
    }
    this.toProfessors(session.id, { t: 'poll:results', results: toPollResultsView(poll) });
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Student handlers                                                  */
  /* ---------------------------------------------------------------- */

  private onJoin(ws: WebSocket, state: ConnState, rawCode: string, anonId?: string): void {
    if (typeof rawCode !== 'string') return this.fail(ws, 'bad_request');

    const code = normalizeCode(rawCode);
    const session = this.store.getByCode(code);
    if (!session) return this.fail(ws, 'invalid_code');
    if (session.status === 'ended') return this.fail(ws, 'session_ended');

    const participant = this.store.joinParticipant(
      session,
      typeof anonId === 'string' ? anonId : undefined,
    );

    if (state.sessionId && state.sessionId !== session.id) {
      this.students.get(state.sessionId)?.delete(ws);
    }
    state.sessionId = session.id;
    state.anonId = participant.anonId;

    let set = this.students.get(session.id);
    if (!set) {
      set = new Set();
      this.students.set(session.id, set);
    }
    set.add(ws);

    this.safeSend(ws, {
      t: 'joined',
      sessionId: session.id,
      code: session.code,
      anonId: participant.anonId,
      startedAt: session.startedAt,
    });
    this.safeSend(ws, {
      t: 'questions:sync',
      questions: this.store
        .openQuestions(session)
        .map((q) => toStudentView(q, participant.anonId)),
    });
    if (session.poll) {
      this.safeSend(ws, { t: 'poll:open', poll: toPollView(session.poll) });
    }

    this.schedulePresence(session);
  }

  private onReaction(ws: WebSocket, session: Session, anonId: string, type: unknown): void {
    if (!isReactionType(type)) return this.fail(ws, 'bad_request');

    const nextAllowedAt = this.store.tryReaction(session, anonId);
    if (nextAllowedAt === null) return this.fail(ws, 'rate_limited', 'reaction');

    this.safeSend(ws, { t: 'reaction:ack', type, nextAllowedAt });
    this.bursts.add(session.id, type);
  }

  private onQuestionCreate(ws: WebSocket, session: Session, anonId: string, rawText: unknown): void {
    if (typeof rawText !== 'string') return this.fail(ws, 'bad_request');

    const text = rawText.trim();
    if (text.length === 0) return this.fail(ws, 'empty');
    if (text.length > LIMITS.questionMaxChars) return this.fail(ws, 'too_long');

    const result = this.store.addQuestion(session, anonId, text);
    if (!result.ok) return this.fail(ws, result.reason, 'question');

    this.broadcastQuestion(session, result.question);
  }

  private onQuestionVote(ws: WebSocket, session: Session, anonId: string, questionId: unknown): void {
    if (typeof questionId !== 'string') return this.fail(ws, 'bad_request');

    const result = this.store.voteQuestion(session, anonId, questionId);
    if (!result.ok) {
      return this.fail(ws, result.reason === 'duplicate_vote' ? 'duplicate_vote' : 'bad_request', 'vote');
    }
    this.broadcastQuestion(session, result.question);
  }

  private onPollAnswer(
    ws: WebSocket,
    session: Session,
    anonId: string,
    pollId: unknown,
    optionId: unknown,
  ): void {
    if (typeof pollId !== 'string' || typeof optionId !== 'string') {
      return this.fail(ws, 'bad_request');
    }
    // Re-answering replaces the previous choice; students change their mind.
    const poll = this.store.answerPoll(session, anonId, pollId, optionId);
    if (!poll) return this.fail(ws, 'bad_request');
    this.sendPollResults(session, false);
  }

  /* ---------------------------------------------------------------- */
  /* Broadcast helpers                                                 */
  /* ---------------------------------------------------------------- */

  /** Same question, two audiences: aggregate for professors, per-viewer for students. */
  private broadcastQuestion(session: Session, question: Question): void {
    this.toProfessors(session.id, { t: 'question:upsert', question: toProfessorView(question) });
    this.toStudents(session.id, (anonId) => ({
      t: 'question:upsert',
      question: toStudentView(question, anonId),
    }));
  }

  private toProfessors(sessionId: string, msg: ServerMsg): void {
    for (const ws of this.professors.get(sessionId) ?? []) this.safeSend(ws, msg);
  }

  /** `build` receives the recipient's anonId so per-viewer flags stay correct. */
  private toStudents(sessionId: string, build: (anonId: string) => ServerMsg): void {
    for (const ws of this.students.get(sessionId) ?? []) {
      const anonId = this.conns.get(ws)?.anonId;
      if (!anonId) continue;
      this.safeSend(ws, build(anonId));
    }
  }

  private sendBurst(sessionId: string, burst: Burst): void {
    // Bursts are professor-only by design: students never see the room's mood.
    this.toProfessors(sessionId, {
      t: 'reaction:burst',
      id: burst.id,
      type: burst.type,
      count: burst.count,
      at: burst.at,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Throttled / debounced professor updates                           */
  /* ---------------------------------------------------------------- */

  private sessionTimers(sessionId: string): SessionTimers {
    let t = this.timers.get(sessionId);
    if (!t) {
      t = { lastPollResultsAt: 0 };
      this.timers.set(sessionId, t);
    }
    return t;
  }

  private clearTimers(sessionId: string): void {
    const t = this.timers.get(sessionId);
    if (!t) return;
    if (t.presence) clearTimeout(t.presence);
    if (t.pollResults) clearTimeout(t.pollResults);
    this.timers.delete(sessionId);
  }

  /** Coalesces join/leave storms into one `presence` frame. */
  private schedulePresence(session: Session): void {
    const timers = this.sessionTimers(session.id);
    if (timers.presence) return;
    timers.presence = setTimeout(() => {
      delete timers.presence;
      const live = this.store.getSession(session.id);
      if (!live) return;
      this.toProfessors(live.id, { t: 'presence', count: this.store.presenceCount(live) });
    }, PRESENCE_DEBOUNCE_MS);
    timers.presence.unref?.();
  }

  private sendPollResults(session: Session, immediate: boolean): void {
    const poll = session.poll;
    if (!poll) return;
    const timers = this.sessionTimers(session.id);
    const now = Date.now();

    if (immediate || now - timers.lastPollResultsAt >= POLL_RESULTS_THROTTLE_MS) {
      timers.lastPollResultsAt = now;
      this.toProfessors(session.id, { t: 'poll:results', results: toPollResultsView(poll) });
      return;
    }
    if (timers.pollResults) return; // A flush is already queued.

    const delay = POLL_RESULTS_THROTTLE_MS - (now - timers.lastPollResultsAt);
    timers.pollResults = setTimeout(() => {
      delete timers.pollResults;
      const live = this.store.getSession(session.id);
      if (!live?.poll) return;
      timers.lastPollResultsAt = Date.now();
      this.toProfessors(live.id, { t: 'poll:results', results: toPollResultsView(live.poll) });
    }, delay);
    timers.pollResults.unref?.();
  }

  /* ---------------------------------------------------------------- */
  /* Housekeeping                                                      */
  /* ---------------------------------------------------------------- */

  /** ws-level ping; two consecutive misses and the socket is terminated. */
  private runHeartbeat(): void {
    for (const [ws, state] of this.conns) {
      if (state.missedPongs >= 2) {
        // terminate() fires 'close', which runs the normal cleanup path.
        try {
          ws.terminate();
        } catch {
          this.handleClose(ws);
        }
        continue;
      }
      state.missedPongs += 1;
      try {
        ws.ping();
      } catch {
        /* the close handler will clean up */
      }
    }
  }

  private runReaper(): void {
    for (const session of this.store.reap()) {
      this.bursts.clearSession(session.id);
      this.clearTimers(session.id);
      for (const ws of this.students.get(session.id) ?? []) {
        try {
          ws.close(1000, 'session ended');
        } catch {
          /* already gone */
        }
      }
      this.students.delete(session.id);
      this.professors.delete(session.id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Send primitives                                                   */
  /* ---------------------------------------------------------------- */

  private fail(ws: WebSocket, code: ErrorCode, scope?: LimitScope): void {
    this.safeSend(ws, { t: 'error', code, message: ERROR_MESSAGES[code], scope });
  }

  private safeSend(ws: WebSocket, msg: ServerMsg): void {
    // OPEN === 1; avoids importing the enum and never throws on a dead socket.
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error('[hub] send failed:', err);
    }
  }
}
