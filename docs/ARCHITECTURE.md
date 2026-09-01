# Lecture React — Architecture

A lightweight real-time lecture reaction tool.

A professor runs a transparent, always-on-top, click-through desktop overlay above whatever
they are already presenting — PowerPoint, Keynote, a PDF, a browser, an IDE. Students join
anonymously from a phone browser with a 5-character class code. Reactions float upward over
the presentation; questions stack as compact bubbles along the right edge; the professor
resolves them with a checkmark and can run a one-click understanding check.

There is deliberately **no professor dashboard**. The overlay *is* the professor interface.
Every design decision below follows from that: the professor never leaves their slides, and
the tool never asks for a login, a database, or a cloud account.

---

## 1. System overview

```
   PROFESSOR MACHINE                                    STUDENT PHONES
 +---------------------------+                     +------------------------+
 |  apps/overlay             |                     |  apps/student          |
 |  Tauri v2 + React         |                     |  Vite + React, served  |
 |                           |                     |  as a plain web page   |
 |  transparent, always on   |                     |                        |
 |  top, click-through       |                     |  no install, no login  |
 +------------+--------------+                     +-----------+------------+
              |                                                |
              |  WebSocket (professor socket)                  |  WebSocket
              |  session:create / end                          |  join, reaction,
              |  question:resolve, poll:*                      |  question:*, poll:answer
              v                                                v
      +-----------------------------------------------------------------+
      |                       packages/server                            |
      |            Node 20 + `ws`  —  single source of truth             |
      |                                                                  |
      |   http  :8787  ->  static build of apps/student (LAN URL)        |
      |   ws    :8787  ->  realtime hub                                  |
      |                                                                  |
      |   sessions (code -> Session)   participants   questions   polls  |
      |   burst accumulator (per session, per reaction type)             |
      |   toProfessorView()  <-- the single privacy boundary             |
      |   store.ts behind an interface (in-memory today)                 |
      +-----------------------------------------------------------------+
              ^                                                ^
              |  presence {count}                              |  joined {anonId}
              |  reaction:burst {type,count}                   |  questions:sync
              |  questions:sync / question:upsert              |  question:upsert
              |  question:resolved                             |  reaction:ack
              |  poll:results, session:ended                   |  poll:open / closed
              |                                                |  poll:results
```

**Toward the professor** flows *aggregate* only: a live participant count, pre-grouped
reaction bursts (`{type, count}`), question text with vote counts, and poll tallies.

**Toward students** flows the state they need to act: their own `anonId`, the shared question
list with `mine` / `voted` hints for their own client, reaction cooldown acks, and open polls.

**Never flows toward the professor:** any participant identifier, IP, user agent, question
authorship, or vote attribution. See §9.

### Packages

| Path | Contents | Notes |
| --- | --- | --- |
| `packages/shared` | `protocol.ts`, `code.ts`, `theme.css` | The frozen contract. Imported by all three other packages. |
| `packages/server` | Node + `ws` realtime server, static file host | The only stateful process. |
| `apps/student` | Vite + React web app | Built to static assets, served by the server. |
| `apps/overlay` | Tauri v2 + React | The professor's desktop overlay. |

pnpm workspaces (`packages/*`, `apps/*`). One `pnpm install` at the root; `packages/shared` is
consumed as a workspace dependency so the protocol cannot drift between client and server —
a change to a message shape breaks the typecheck on both sides in the same commit.

### Why a self-hosted Node WebSocket server (not Supabase / Firebase)

- **Zero signup, zero credentials.** A professor should be able to clone, `pnpm install`,
  `pnpm dev`, and start a class. Introducing a hosted backend introduces an account, a project,
  API keys in a `.env`, and a per-machine setup step that has nothing to do with teaching.
- **Sub-50ms on the lecture-hall LAN.** When the server runs on the professor's own machine or
  a box in the building, a reaction round-trips over the local network. A hosted realtime
  service routes every tap through a region that may be a continent away; at the density of a
  200-seat room that latency is visible as lag between a class laughing and the overlay
  reacting.
- **The data is ephemeral.** Reactions exist for 2–4 seconds of float animation and are never
  read again. Questions and poll responses live for the length of one lecture. A managed
  Postgres is the wrong shape for data whose entire lifetime is shorter than a connection.

**Tradeoff, stated plainly:** somebody must host the process — the professor's laptop, or a
small VPS for a department. There is no durable history: end the class and the questions are
gone. That is acceptable for the MVP and not acceptable forever, so `store.ts` is written
behind an interface (`SessionStore`) with an in-memory implementation. A Postgres or Supabase
adapter is a drop-in later: implement the interface, swap the construction site, and the
protocol, the overlay, and the student app do not change. §8 sketches the schema that adapter
would target.

### Why Tauri, not Electron

The professor app needs a window that is genuinely transparent, always on top, and
**click-through** — mouse events pass to PowerPoint underneath except where the overlay's own
controls are. That is an OS window-manager property (`WS_EX_TRANSPARENT` on Windows,
`ignoresMouseEvents` on macOS). It cannot be done by a browser page at all: a web page cannot
be transparent over another application, cannot stay above it, and cannot forward clicks to it.

Tauri exposes exactly that control (`set_ignore_cursor_events`, transparent + always-on-top
window flags) with a Rust host process, and produces a binary in the single-digit megabytes
rather than shipping a Chromium. Electron would work too; it is simply a 100MB+ download for a
utility that draws a few floating icons.

### Students install nothing

`apps/student` is a plain web app. The server serves its built assets on the same port as the
WebSocket endpoint, so the URL the server prints on boot (`http://<lan-ip>:8787`) is both the
page and the socket origin. No app store, no login, no permissions prompt. The professor reads
the code off the overlay; students type it into a page reachable on the room's network.

### Single source of truth

The server owns every id (`sessionId`, question ids, poll ids, poll option ids, burst ids) and
every timestamp that matters (`startedAt`, `createdAt`, `nextAllowedAt`, `endedAt`). Clients
render what they are told. This removes the entire class of bugs where two students generate
the same optimistic question id, and makes reconnection trivial: the client throws away local
state and re-syncs.

---

## 2. User flows

### Class lifecycle

```
 PROFESSOR                       SERVER                        STUDENTS
 ---------                       ------                        --------
 launch overlay
   |
   |-- ws connect --------------->|
   |-- session:create ----------->|
   |                              | generateCode(isTaken)
   |                              | create Session{id, code, startedAt}
   |<-- session:created ----------|
   |    {sessionId, code, token}  |
   |                              |
 [code shown large on overlay]    |
 [LAN URL printed by server]      |
                                  |<----------------- open http://<lan-ip>:8787
                                  |<-- join {code, anonId?} -------------
                                  | normalizeCode, look up active session
                                  |-- joined {sessionId, code, anonId} ->|
                                  |-- questions:sync ------------------->|
                                  |   (+ poll:open if one is live)
   |<-- presence {count} ---------|
   |                              |
 [present slides; overlay is      |
  click-through over them]        |
                                  |<-- reaction {type} ------------------|
                                  | cooldown check -> reaction:ack ---->|
                                  | accumulate into burst window        |
   |<-- reaction:burst -----------| flush after burstWindowMs
   |    {id, type, count, at}     |
 [floaters spawn, left/bottom]    |
                                  |<-- question:create {text} -----------|
                                  | validate, create Question
   |<-- question:upsert ----------|-- question:upsert ----------------->| (all students)
 [bubble docks on right edge]     |
                                  |<-- question:vote {questionId} -------|
   |<-- question:upsert ----------|-- question:upsert ----------------->|
 [re-sorted by votes]             |
   |
   |-- question:resolve --------->|
   |<-- question:resolved --------|-- question:resolved --------------->|
 [checkmark -> fade -> slide out] |
   |
   |-- poll:start {understanding} |
   |                              |-- poll:open {poll} ---------------->|
   |                              |<-- poll:answer {pollId, optionId} --|
   |<-- poll:results -------------|   (one per participant, live tally)
 [bar chart on overlay,           |
  pollResultVisibleMs then        |
  minimizes]                      |
   |-- poll:end {pollId} -------->|
   |<-- poll:results (endedAt) ---|-- poll:closed {pollId} ------------>|
   |
   |-- session:end -------------->|
   |<-- session:ended {at} -------|-- session:ended {at} -------------->|
                                  | drop session, code becomes reusable
 [overlay returns to idle]                                [thank-you screen]
```

### Student flow

```
  open LAN URL
        |
        v
  +-------------------+   read anonId from localStorage (create v4 UUID if absent)
  |  code entry       |
  |  [ _ _ _ _ _ ]    |   input is normalizeCode()'d as it is typed:
  +-------------------+   uppercased, non-alphanumerics stripped,
        |                 O/0 and I/L/1 dropped (not in the alphabet)
        | isPlausibleCode -> enable Join
        v
  join {code, anonId}
        |
   +----+--------------------------+
   |                               |
  joined                        error {invalid_code | session_ended}
   |                               |
   v                               v
  +------------------------+   inline message under the field,
  |  reaction pad          |   field stays focused, retry
  |  6 big blocky buttons  |
  |  (understand/confused/ |
  |   too_fast/too_slow/   |
  |   again/interesting)   |
  |                        |
  |  [ ask a question ]    |--> 200-char composer -> question:create
  |  question list w/ votes|--> tap to upvote (once) -> question:vote
  +------------------------+
        |
        | poll:open arrives -> options replace the pad until answered,
        |                      then results / "answer recorded"
        v
  session:ended -> "class ended" screen, socket closed, no reconnect
```

Tapping a reaction is optimistic: the button plays its press animation immediately and goes
into a local cooldown. `reaction:ack {nextAllowedAt}` is authoritative — the client adopts the
server's timestamp so a client with a skewed clock or a lost ack cannot spam.

### Failure flows

```
 INVALID CODE
   join {code} -> server: no active session with that code
              <- error {code:'invalid_code'}
   Student app stays on the code screen, shows "No class with that code",
   clears nothing (the typed code stays so a single typo is fixable).

 ENDED CLASS
   join {code} -> session exists but status='ended', or is already gone
              <- error {code:'session_ended'}   (or session:ended mid-lecture)
   Student app moves to the terminal "class ended" screen and stops reconnecting.
   This is the one state where the student client deliberately gives up.

 NETWORK DROP — STUDENT (silent resume)
   socket closes
        |
        v
   reconnect with backoff (short, jittered; the phone may be walking
   between APs).  UI shows a small dim "reconnecting" dot, not a modal —
   the reaction pad stays on screen and taps queue for one attempt.
        |
        v
   join {code, anonId}   <-- same anonId from localStorage
        |
   server rebinds the socket to the existing Participant if the session is
   still active: cooldowns, one-vote-per-question and poll answers survive.
        |
        v
   joined + questions:sync (+ poll:open if live)  -> full state replaced,
   dot disappears.  From the student's point of view nothing happened.

 NETWORK DROP — PROFESSOR (silent resume)
   overlay socket closes
        |
        v
   reconnect with backoff; the overlay keeps rendering its last known
   question stack rather than blanking (a blank overlay mid-lecture is worse
   than a slightly stale one).
        |
        v
   session:create { resume: { sessionId, token } }   <-- token from
   session:created, held by the overlay
        |
   server validates the token against the live session:
     ok        -> session:created (same id, same code) + questions:sync
                  + presence.  The class code on screen never changed, so
                  students who never noticed anything are still connected.
     unknown   -> error {unauthorized} and the overlay starts a fresh
                  session with a new code (the old one died with the process).
        |
        v
   in-flight reactions during the gap are lost by design — they are
   ephemeral.  Questions and votes are not: they were server state.

 SERVER GONE ENTIRELY
   Both sides sit in backoff.  Students see the reconnect dot; the professor
   sees a muted "offline" pip in the overlay control cluster.  When the
   process comes back the sessions are gone (in-memory), so the professor's
   resume fails as `unauthorized` and a new code is issued.

 IDLE PARTICIPANTS
   Heartbeat every LIMITS.heartbeatMs (15s); a participant with no traffic for
   LIMITS.participantTimeoutMs (45s) is dropped and `presence` is re-broadcast.
   A phone that locks its screen therefore leaves the count within ~45s.
```

---

## 3. Overlay behaviour

### Two interaction modes

**Presentation Mode** (default, the one the professor lectures in). The window is
click-through: mouse events land on PowerPoint, the PDF, the IDE underneath. The overlay is
visually present — reactions float, question bubbles dock on the right, the code and presence
count sit in a corner chip — but the pointer passes straight through *except* over the
interactive rects: the control cluster, question cards, and the resolve checkmarks. Over those,
and only those, the window captures the click.

**Interaction Mode** (`CmdOrCtrl+Shift+L`). The window stops ignoring cursor events entirely.
The whole surface is interactive, the panel chrome becomes fully opaque rather than glass, and
the professor can drag panels, open the poll composer, type a custom poll question, or work
through a backlog of questions without threading the cursor between hitboxes. Slides underneath
are unclickable for as long as this lasts, which is exactly why it is a mode and not the
default.

**Quiet Mode** (`CmdOrCtrl+Shift+H`) is orthogonal to both: it suppresses reaction floaters and
dims the question stack to a single count chip, for the stretch of a lecture where motion in
the periphery is a distraction. Questions keep arriving; they just stop animating in.

### How click-through is actually achieved

The naive approach is "make the window normal and set `pointer-events: none` on everything
except the buttons." This does not work, and understanding why is the key to this file:

> A click-through window receives **no mouse events at all**. `set_ignore_cursor_events(true)`
> is an OS-level property of the whole window — the compositor routes the pointer to whatever
> is behind it and the webview is never told the cursor exists. There is no `mousemove`, no
> `mouseover`, no hover. CSS `pointer-events` is a *within-document* hit-test that runs only
> once an event has already been delivered to the document. With ignore-cursor-events on, no
> event is ever delivered, so the CSS rule can never fire. Conversely, with it off, the window
> swallows every click including the ones meant for the slides, and `pointer-events: none` on
> the transparent background does not forward them to the application underneath — it forwards
> them to whatever is below *in the same document*, which is nothing.

So the hit-test has to happen outside the webview's own event stream:

```
  Rust host (Tauri)                          Webview (React)
  ---------------------------------------------------------------------
  timer tick (~60Hz, coalesced)
    |
    +-- query OS cursor position (global, screen coords)
    |
    +-- convert to window-local logical px
    |
    +-- emit("cursor", {x, y})  ------------->  listener
                                                  |
                                                  +-- hit-test {x,y} against the
                                                  |   interactive rect list
                                                  |   (control cluster, question
                                                  |    cards, checkmarks, composer)
                                                  |   maintained by the components
                                                  |   themselves via a registry
                                                  |
                                                  +-- inside = should_capture
                                                  |
                                                  +-- if should_capture !== last:
    <--- invoke("set_click_through", capture) ----+     (edge-triggered only)
    |
    +-- window.set_ignore_cursor_events(!capture)
```

Points that matter for whoever maintains this:

- **Poll in Rust, not in JS.** The webview cannot see the cursor while it is click-through;
  the host process always can.
- **Toggle only on change.** Calling `set_ignore_cursor_events` every tick causes visible
  cursor flicker and, on some window managers, dropped clicks. The webview tracks the last
  committed state and issues the IPC call only on a transition.
- **The rect list is derived, not hardcoded.** Interactive components register their bounding
  boxes (measured after layout, updated on resize and on question-stack changes) into a single
  registry the hit-test reads. A question card that slides out must deregister, or a dead
  hitbox keeps stealing clicks from the slides.
- **Pad the rects slightly.** The poll interval means the cursor can enter a control and click
  before the next tick. A few pixels of padding around each rect, plus a tick fast enough to
  land inside a normal click's press-to-release window, makes this unnoticeable.
- **In Interaction Mode the poller is irrelevant** — the window captures unconditionally and
  the hit-test result is ignored until the mode is toggled back.
- **In Quiet Mode the rect list shrinks** to the control cluster and the count chip, so the
  professor cannot accidentally catch a click on a dimmed question card.

Platform note: this is verified on macOS. Windows and Linux click-through behaviour is listed
under future work (§13).

### What the overlay draws

```
 +---------------------------------------------------------------+
 |                                          [ Q ] can you redo    | <- question stack,
 |                                          [ 3 ] the proof?      |    right-hand strip
 |         (protected centre: nothing spawns here)  [v]           |
 |                                          [ Q ] what is O(n)?   |
 |   ^  ^                                   [ 1 ]           [v]   |
 |   O  ?                                   ( +2 more )           |
 |  ^   ^   ^                                                     |
 |  ?   O   !          <- floating reactions rise from the        |
 |                        left column and the bottom band         |
 | [ ABCDE ] [ 34 ]  [ check ]  [ quiet ]                         | <- control cluster
 +---------------------------------------------------------------+
```

---

## 4. Realtime data flow

Every frame is JSON `{ t: <type>, ...payload }`. `PROTOCOL_VERSION = 1`.
The tables below are the complete contents of `packages/shared/src/protocol.ts`.

### Professor → Server (`ProfessorMsg`)

| Message | When sent | Carries |
| --- | --- | --- |
| `session:create` | On overlay connect, and again after a reconnect (with `resume`). | `resume?: { sessionId, token }` — omitted for a fresh class, present to reclaim an existing one. |
| `session:end` | Professor ends the class from the control cluster. | — |
| `question:resolve` | Professor clicks a question card's checkmark. | `questionId` |
| `poll:start` | One-click understanding check, or the quick custom composer in Interaction Mode. | `kind: 'understanding' \| 'custom'`, `question?`, `options?: string[]` (both omitted for `understanding`, which uses `UNDERSTANDING_OPTIONS`). |
| `poll:end` | Professor closes an open poll. | `pollId` |
| `ping` | Every `LIMITS.heartbeatMs`. | — |

### Student → Server (`StudentMsg`)

| Message | When sent | Carries |
| --- | --- | --- |
| `join` | After the code screen, and on every reconnect. | `code` (normalized), `anonId?` — present whenever localStorage already holds one, which is what makes resume silent. |
| `reaction` | Tap on one of the six reaction buttons, if not in cooldown. | `type: ReactionType` |
| `question:create` | Composer submit. | `text` (≤ `LIMITS.questionMaxChars`) |
| `question:vote` | Tap an existing question. | `questionId` |
| `poll:answer` | Tap an option while a poll is open. | `pollId`, `optionId` |
| `ping` | Every `LIMITS.heartbeatMs`. | — |

### Server → Client (`ServerMsg`)

| Message | To | When sent | Carries |
| --- | --- | --- | --- |
| `error` | both | Any rejected frame. | `code: ErrorCode`, `message` (human-readable, safe to display). |
| `pong` | both | Reply to `ping`. | — |
| `session:ended` | both | Professor ended the class, or the session was torn down. | `at` |
| `session:created` | professor | Reply to `session:create`, fresh or resumed. | `sessionId`, `code`, `token`, `startedAt`. The `token` is the professor's resume credential — hold it, never display it. |
| `presence` | professor | A participant joins, drops, or times out. | `count` — a number, never a list. |
| `reaction:burst` | professor | A burst window flushes (see §5). | `id`, `type`, `count`, `at`. One frame per type per window, never one per tap. |
| `questions:sync` | both | On join, on professor resume, and after any state the client cannot patch incrementally. | `questions: QuestionView[]` — full replacement of the client's list. |
| `question:upsert` | both | A question is created or its vote count changes. | `question: QuestionView` |
| `question:resolved` | both | Professor resolved a question. | `questionId`, `at` |
| `joined` | student | Successful `join`. | `sessionId`, `code`, `anonId` (server-confirmed; the client persists this), `startedAt`. |
| `reaction:ack` | student | Every accepted `reaction`. | `type`, `nextAllowedAt` — the authoritative cooldown deadline. |
| `poll:open` | student | `poll:start`, and to any student joining while a poll is live. | `poll: PollView` |
| `poll:results` | both* | Answers arrive, and once more when the poll ends. | `results: PollResultsView` — `total`, per-option `count` and `pct`, `endedAt?` when closed. Students see results only after the poll ends or after they have answered. |
| `poll:closed` | student | `poll:end`. | `pollId` |

### Domain shapes

- `QuestionView { id, text, votes, createdAt, status: 'open'|'resolved', mine?, voted? }` —
  `mine` and `voted` are **student-only hints about the current viewer**. They are computed
  per-socket and are stripped on the professor path; see §9.
- `PollView { id, kind, question, options: [{id,label}], createdAt }`.
- `PollResultsView { pollId, kind, question, total, results: [{optionId,label,count,pct}], endedAt? }` —
  counts only.
- `UNDERSTANDING_OPTIONS` = `got_it` "Got it", `almost` "Almost", `lost` "Lost". The one-click
  check uses exactly these, which is what makes it one click.
- `ErrorCode` = `invalid_code`, `session_ended`, `rate_limited`, `duplicate_vote`, `too_long`,
  `empty`, `not_joined`, `bad_request`, `unauthorized`.
- `REACTION_TYPES` = `understand`, `confused`, `too_fast`, `too_slow`, `again`, `interesting`.
  `REACTION_META` gives each one a `label`, a `meaning` (the sentence shown to students), a
  Font Awesome free-solid `icon` name, and an `accent` palette key:

  | type | label | meaning | icon | accent |
  | --- | --- | --- | --- | --- |
  | `understand` | Understand | I understand this. | `check` | mint |
  | `confused` | Confused | I'm confused. | `question` | pink |
  | `too_fast` | Too Fast | You're going too fast. | `forward` | sky |
  | `too_slow` | Too Slow | You're going too slowly. | `backward` | lavender |
  | `again` | Again | Please explain that again. | `rotate-left` | sky |
  | `interesting` | Interesting | This is interesting. | `lightbulb` | yellow |

  Both clients read labels, icons and colours from this one table. Adding a reaction type is a
  single-file change plus whatever art the icon needs.

### Session codes (`packages/shared/src/code.ts`)

`generateCode(isTaken)` draws `LIMITS.codeLength` (5) characters from
`LIMITS.codeAlphabet` = `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — 31 symbols with `O`, `0`, `I`, `1`,
`L` removed, because the code is read off a projector at the back of a lecture hall. It retries
up to 200 times against the caller-supplied `isTaken` predicate (uniqueness among *active*
sessions is the server's business, not the generator's), and on the astronomically unlikely
exhaustion it widens to 6 characters rather than failing a class start — a slightly longer code
is a far better outcome than a professor staring at an error at 9:00am.

`normalizeCode(raw)` makes typed input forgiving: uppercase, strip everything non-alphanumeric,
then remove the confusables — `O` is folded to `0` and `0` is dropped, and `I`, `L`, `1` are
dropped, since none of them are in the alphabet. Truncates to `codeLength + 1`. Run it on every
keystroke so the student's field only ever contains characters that could be part of a real
code.

`isPlausibleCode(code)` is the cheap client-side gate before sending `join`: right length, all
characters in the alphabet. It says nothing about whether the class exists — only the server
knows that.

---

## 5. Reaction burst grouping

Two hundred students tapping "confused" in the same three seconds must not become two hundred
websocket frames and two hundred DOM nodes. Grouping happens in two independent stages, on both
sides of the wire, because they solve two different problems.

### Stage 1 — server-side burst window (bandwidth and frame count)

Per session, per reaction type:

```
  reaction {type} arrives, passes the cooldown check
        |
        v
  is there an open window for (session, type)?
        |
        +-- no  --> open one: count = 1, schedule flush at
        |           now + LIMITS.burstWindowMs (1200ms)
        |
        +-- yes --> count += 1        (no frame is sent)
        |
        v
  flush timer fires
        |
        +--> send ONE  reaction:burst { id, type, count, at }  to the professor
        +--> close the window for (session, type)
```

Windows are per type, so a wave of `confused` and a wave of `understand` remain two distinct
signals arriving on their own cadences. A single reaction in a quiet room still produces one
burst of `count: 1` after at most 1200ms — that latency is invisible next to the 2200–4000ms
float animation, and it is the price of the room-scale case behaving.

The professor socket therefore sees at most `6 types / 1.2s` ≈ 5 frames/second regardless of
class size. Students get no reaction broadcasts at all; they never need to see other people's
taps.

### Stage 2 — overlay density cap (frames per second and legibility)

The server can still hand the overlay a legitimate `{type: 'confused', count: 87}`. Spawning 87
floaters would both destroy the frame rate and communicate nothing more than a dozen would.

```
  reaction:burst {type, count} arrives
        |
        v
  live floater count < CAP (~12) ?
        |
        +-- yes --> spawn min(count, CAP - live) floaters, each with its own
        |           spawn point, drift and lifetime (reactionFloatMinMs..MaxMs)
        |
        +-- no  --> merge into the NEWEST live floater of the same type:
                    bump its multiplier badge (x3 -> x11), replay lr-pop,
                    refresh its lifetime.  No new node is created.
```

The cap is on *live* floaters, so it self-relieves as animations complete. Merging into the
newest same-type item rather than the oldest keeps the badge near the bottom of the screen where
it just appeared, instead of attaching a growing number to something already fading out at the
top.

### Why both

They are not redundant:

- Server grouping bounds **network traffic and frames**. It cannot know how many floaters are
  already on screen, how long the last burst is still animating, or how big the professor's
  display is.
- Overlay grouping bounds **rendering cost and visual noise**. It cannot reduce the number of
  websocket frames that already crossed the wire, and it has no view of the room's aggregate
  rate.

Remove the server stage and a large class saturates the socket. Remove the overlay stage and one
honest burst of 87 stutters the animation on top of the professor's slides.

---

## 6. Reaction positioning

Floaters must never obscure what the professor is presenting. The screen is divided:

```
 +----------------------------------------------------------+
 | left  |                                     |  RESERVED   |
 | zone  |                                     |  right strip|
 |       |        PROTECTED CENTRE             |  (questions |
 |  ^    |     (no reaction ever spawns        |   only)     |
 |  ^    |      or drifts into this box)       |             |
 |  ^    |                                     |             |
 |       |                                     |             |
 |-------+-------------------------------------|             |
 |            bottom zone   ^   ^   ^          |             |
 +----------------------------------------------------------+
```

- **Spawn zones** are configurable per `ReactionZone = 'left' | 'bottom' | 'both'`. `left` is a
  narrow column up the left edge; `bottom` is a band across the lower portion, excluding the
  reserved strip; `both` alternates between them. Default is `both`, which spreads the load so
  neither zone saturates during a wave.
- **The reserved right-hand strip** belongs to the question stack and nothing else. Reactions do
  not spawn there and their horizontal drift (`--lr-drift`) is clamped so a rising floater cannot
  wander across a question card.
- **The protected centre** is the slide's content area — the diagram, the code sample, the thing
  the professor is actually pointing at. Nothing spawns in it and the `--lr-rise` distance is
  chosen so left-zone floaters travel up the margin rather than cutting across it.
- Each floater gets randomized spawn offset, drift and lifetime within
  `[reactionFloatMinMs, reactionFloatMaxMs]` (2200–4000ms) so a burst of the same type reads as a
  crowd, not a marching column.

---

## 7. Question prioritisation

The right-hand strip has room for a handful of cards, and a lecture generates more than that.

```
  ordering:  votes DESC, then createdAt DESC   (ties break toward the newest)
  visible:   first LIMITS.overlayMaxQuestions (5) open questions
  overflow:  collapses to a single "+N more" chip below the stack
```

Votes first, recency second: the point of voting is that eight students silently agreeing "yes,
that step" outranks one person's aside, and a genuinely important question asked early should not
sink under fresher noise. Recency breaks ties so that among equally-voted questions the professor
sees what the room is thinking about *now*.

The cap is a hard product decision. Five cards is roughly what a professor can scan without
stopping the lecture; twenty is a dashboard, and this tool refuses to be one. The `+N more` chip
is deliberately not expandable in Presentation Mode — it is a pressure gauge, telling the
professor a backlog exists. In Interaction Mode the professor can open it and work through the
list.

Resolve:

```
  professor clicks [v] on a card
        |
        +-- optimistic: card dims and the checkmark fills immediately
        |
        v
  question:resolve {questionId}  ->  server marks status='resolved'
        |
        v
  question:resolved {questionId, at}  ->  professor AND all students
        |
        +-- overlay:  fade over LIMITS.resolveFadeMs (600ms),
        |             then lr-slide-out-right, then unmount
        |             (and deregister its click-through rect — §3)
        |
        +-- promotion: the highest-ranked overflow question takes the freed
        |              slot with lr-slide-in-right, and the +N chip decrements
        |
        +-- student: the card greys out with a "answered" marker so the person
                     who asked sees that it was addressed, not dropped
```

The 600ms lingering fade exists so the professor gets confirmation their click registered before
the card leaves — an instantly vanishing card reads as a misclick.

---

## 8. Data model

**MVP reality first:** `packages/server` holds `Session`, `Participant`, `Question`,
`QuestionVote`, `Poll`, `PollOption` and `PollResponse` **in memory**, behind the `SessionStore`
interface. `Reaction` rows are **never materialised at all** — a reaction is counted into a burst
window and then it is gone; nothing reads an individual reaction, ever. `Professor` does not
exist as a row in the MVP either; there are no accounts, and a professor is identified only by
holding the session `token`.

The DDL below is the schema a durable adapter would target. It is written down now so the
in-memory structures are shaped the same way and the later port is mechanical.

```sql
-- Not used in the MVP (no accounts). Present so sessions can be owned later.
CREATE TABLE professor (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_id uuid REFERENCES professor(id) ON DELETE SET NULL,
  code         char(5) NOT NULL,            -- LIMITS.codeAlphabet only
  token        text    NOT NULL,            -- professor resume credential
  status       text    NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','ended')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);

-- The hot path: join by code, among ACTIVE sessions only.  Codes are recycled
-- after a class ends, so the uniqueness constraint must be partial too.
CREATE UNIQUE INDEX session_active_code_uniq
  ON session (code) WHERE status = 'active';

CREATE TABLE participant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  anon_id     uuid NOT NULL,                -- client-generated, localStorage
  joined_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, anon_id)              -- makes reconnect an upsert
);
-- No name, no email, no IP, no user agent.  Deliberately.  See §9.

-- NOT PERSISTED IN THE MVP.  Kept here to document the shape, and because a
-- future "what confused the room at minute 34" feature needs it.  Reactions are
-- only ever read in aggregate; individual rows have no consumer.
CREATE TABLE reaction (
  id             bigserial PRIMARY KEY,
  session_id     uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participant(id) ON DELETE SET NULL,
  type           text NOT NULL,             -- REACTION_TYPES
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reaction_session_time ON reaction (session_id, created_at);

CREATE TABLE question (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participant(id) ON DELETE SET NULL,
  text           varchar(200) NOT NULL,     -- LIMITS.questionMaxChars
  votes          integer NOT NULL DEFAULT 0,-- denormalised; the sort key
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','resolved')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

-- The overlay's exact query: open questions for one session, best first.
CREATE INDEX question_session_rank
  ON question (session_id, votes DESC, created_at DESC)
  WHERE status = 'open';

CREATE TABLE question_vote (
  question_id    uuid NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, participant_id)  -- one vote per person, enforced
);                                           -- by the schema, not by the app

CREATE TABLE poll (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('understanding','custom')),
  question    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX poll_session_open ON poll (session_id) WHERE ended_at IS NULL;

CREATE TABLE poll_option (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id  uuid NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
  label    text NOT NULL,
  position smallint NOT NULL,
  UNIQUE (poll_id, position)
);

CREATE TABLE poll_response (
  poll_id        uuid NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  option_id      uuid NOT NULL REFERENCES poll_option(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, participant_id)      -- one answer per person
);
CREATE INDEX poll_response_tally ON poll_response (poll_id, option_id);
```

Indexes worth the words:

- `session_active_code_uniq` — every `join` is a lookup by code, and it must only ever match a
  live class. Partial-unique also encodes the rule that codes are reusable once a class ends,
  which is what lets a 5-character alphabet survive a whole department.
- `question_session_rank` — the overlay's sort (§7) expressed as an index, so rendering the stack
  never sorts the table.
- `poll_response_tally` — `poll:results` is a `GROUP BY option_id`; this makes it an index scan.
- The two composite primary keys (`question_vote`, `poll_response`) enforce one-vote-per-question
  and one-answer-per-poll at the storage layer. The in-memory store implements the same
  constraint with a `Set`; keeping them identical is why a `duplicate_vote` error behaves the
  same before and after the port.

---

## 9. Privacy model

The rule, stated once: **no participant identifier ever crosses to a professor socket.**

What a professor can see, in total:
- a participant **count** (`presence`),
- reaction **counts** by type (`reaction:burst`),
- question **text** and **vote counts** (`QuestionView` minus the student hints),
- poll **tallies** (`PollResultsView`).

What a professor cannot see, at all: who is in the room, who reacted, who asked which question,
who voted for it, who answered a poll and how, or how many questions any individual asked. There
is no view, no export, and no message shape that carries it. Students are told this, because a
tool for saying "I'm lost" is worthless if saying it feels attributable.

### `anonId`

A UUID v4 generated by the student's browser on first visit and kept in `localStorage`. It is
sent with `join` and confirmed back in `joined`. It is used for exactly three things:

1. **Reaction cooldown** — enforcing `LIMITS.reactionCooldownMs` per person rather than per
   socket, so reconnecting does not reset the throttle.
2. **One vote per question, one answer per poll** — `question_vote` / `poll_response` are keyed
   by participant.
3. **Connection resume** — rebinding a reconnecting socket to the existing `Participant`, which
   is what makes the network-drop flow in §2 silent.

It is not an account. It is not tied to a name, an email, an IP, or a device fingerprint. It is
scoped to the browser that made it, the student can clear it by clearing site data, and it means
nothing outside a live session. The server keeps no `Reaction` rows at all, so even inside the
server there is no per-person reaction history to leak.

### The `toProfessorView` boundary

Privacy enforced by "remember not to include the field" fails the first time someone adds a
field. Instead, everything that leaves the server toward a professor socket passes through one
function:

```
  internal Question / Poll / Participant state
              |
              v
      toProfessorView(entity)     <-- packages/server, one place
              |
              +-- constructs the outbound shape explicitly, field by field
              +-- never spreads the internal object
              +-- drops participantId, anonId, mine, voted, last_seen, sockets
              |
              v
        ServerMsg toward the professor
```

Three properties make this hold:

- It is **allowlist, not denylist**: the function names each field it emits. A new internal field
  is invisible by default; you have to deliberately add it to leak it.
- It is the **only** path. Professor sends are funnelled through the helper that calls it; no
  handler serialises internal state directly to a professor socket.
- The protocol backs it up in types. `QuestionView.mine` and `.voted` are documented as
  student-only, and the professor-facing shape omits them.

Reviewers: any change that widens `toProfessorView`, or that writes to a professor socket without
going through it, is the thing to catch.

---

## 10. Design system

`packages/shared/src/theme.css` is plain CSS custom properties plus a small set of component
classes, so it works in both apps with or without Tailwind layered on top. One file, imported by
`apps/student` and `apps/overlay`, so the phone and the projector agree.

Direction: **retro pixel, but professional.** Blocky rectangles, 2px hard borders, small offset
drop shadows with no blur, stepped transitions rather than eased ones. It reads as playful enough
that a lecture hall will actually press the buttons, and restrained enough to sit on top of a
professor's slides in front of two hundred people. Pixel font for headings, class codes and
buttons; a readable humanist sans for anything a person has to *read*, which above all means
question text.

### Tokens

Palette:

| Token | Value | Role |
| --- | --- | --- |
| `--lr-bg` | `#F7F6F1` | Page ground, warm off-white |
| `--lr-dark` | `#282828` | Ink, borders, shadows |
| `--lr-sky` | `#A9D8FF` | Primary accent (`too_fast`, `again`, `.lr-btn-primary`) |
| `--lr-pink` | `#FFB7D5` | Danger / attention (`confused`, `.lr-btn-danger`) |
| `--lr-lavender` | `#C9B8FF` | `too_slow`, focus ring |
| `--lr-mint` | `#ACE8D3` | `understand` |
| `--lr-yellow` | `#FFE49A` | `interesting` |
| `--lr-muted` | `#6E6A63` | Secondary text |
| `--lr-line` | `#282828` | Border colour (aliased to ink) |
| `--lr-surface` | `#FFFFFF` | Card / panel fill |

The five accents are exactly `PaletteKey` in `protocol.ts` (`sky`, `pink`, `lavender`, `mint`,
`yellow`), and `REACTION_META[type].accent` names one of them — so a reaction's colour comes from
the protocol, not from a lookup table duplicated in each app.

Chrome:

| Token | Value |
| --- | --- |
| `--lr-border` | `2px` |
| `--lr-shadow` | `4px 4px 0 var(--lr-dark)` |
| `--lr-shadow-sm` | `2px 2px 0 var(--lr-dark)` |
| `--lr-radius` | `3px` |
| `--lr-font-pixel` | `'Silkscreen', 'Courier New', monospace` |
| `--lr-font-text` | `'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif` |

`color-scheme: light`. The design is deliberately single-mode: the overlay composites over
arbitrary application content, and a dark variant that inverts against a white slide is worse
than one consistent, high-contrast treatment.

### Classes

- `.lr-pixel` / `.lr-text` — the two type roles.
- `.lr-panel` — opaque card: surface fill, 2px ink border, 4px offset shadow.
- `.lr-panel-glass` — the overlay variant: `color-mix` of `--lr-bg` at 82% with transparent, a
  6px backdrop blur, a softened border, and the small shadow. Slides stay legible underneath
  while the panel stays a distinct object.
- `.lr-btn` — 12px pixel type, 12/16 padding, ink border, small offset shadow. `:hover` warms the
  fill; `:active` and `[data-pressed='true']` translate `(2px, 2px)` and collapse the shadow to
  zero, so the button physically presses into the page. `:focus-visible` draws a 2px lavender
  outline at 2px offset — keyboard focus is never removed. `:disabled` drops to 0.45 opacity.
  Modifiers: `.lr-btn-primary` (sky), `.lr-btn-danger` (pink), `.lr-btn-ghost` (transparent, no
  shadow), `.lr-btn-lg` (14px / 18–20 padding, for the student reaction pad on a phone).
- `.lr-a-sky` / `-pink` / `-lavender` / `-mint` / `-yellow` — accent fills, addressed directly by
  `REACTION_META[type].accent`.
- `.lr-code` — 40px pixel type, `0.28em` letter-spacing with a matching `text-indent` so the
  tracked-out string stays optically centred. This is the class code on the projector; it exists
  to be read from the back row.
- `.lr-loader` — three 6px squares blinking on `steps(1, end)` at 150ms offsets. A retro
  indicator, not a spinner.
- `.lr-rule` — 2px dotted rule drawn with a repeating linear gradient, 4px on / 4px off.

### Animation vocabulary

| Keyframes | Used for |
| --- | --- |
| `lr-float-up` | Reaction floaters. Bounces in (scale 0.6 → 1.12 → 1 in the first 22%), then rises `--lr-rise` (default 260px) with `--lr-drift` of horizontal wander, fading to 0. The two custom properties are what let each floater be individually randomised (§6). |
| `lr-slide-in-right` | A question card docking into the right-hand strip. |
| `lr-slide-out-right` | A resolved question leaving after its fade (§7). |
| `lr-pop` | Acknowledgement beat — a burst multiplier incrementing, a vote count changing, a button confirming. |

Transitions are `steps(2)` on transform and shadow (90ms), plain ease on colour (120ms). Stepped
motion is the whole retro conceit: things snap between states instead of gliding.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` collapses every animation and transition to `0.01ms`
globally. The one carve-out is `.lr-float`: reaction floaters set `animation: none` and
`opacity: 1` instead of being reduced to nothing, because a reaction that is animated away to
invisibility is a reaction the professor never receives. Under reduced motion they simply appear
in place and are removed when their lifetime expires. The rule is: motion is decorative
everywhere except where it is the message, and there the element becomes static rather than
absent.

---

## 11. Rate limiting

Every value lives in `LIMITS` in `protocol.ts` — one table, so the server's enforcement and the
clients' UX affordances cannot disagree. A client that shows a 2s cooldown while the server
enforces 5s produces silent failures; sharing the constant makes that impossible.

| Limit | Value | Rationale |
| --- | --- | --- |
| `codeLength` | `5` | Short enough to read off a projector and type on a phone without error; 31^5 ≈ 28.6M combinations is far more than enough for the number of classes active simultaneously on one server. |
| `codeAlphabet` | `ABCDEFGHJKMNPQRSTUVWXYZ23456789` | 31 symbols with `O`, `0`, `I`, `1`, `L` removed. Every code is read at distance and typed under time pressure; confusables are the dominant failure mode. |
| `reactionCooldownMs` | `2000` | One reaction per student per 2s. Long enough that a single student cannot dominate the display, short enough that a genuine sequence ("too fast" then "again") is not blocked. Enforced by `anonId`, so reconnecting does not reset it, and the deadline is returned in `reaction:ack` so the client's countdown is the server's. |
| `burstWindowMs` | `1200` | The server-side grouping window (§5). Bounds professor-bound frames to ~5/s at any class size. Below the float animation's minimum lifetime, so grouping never introduces visible delay. |
| `questionCooldownMs` | `15000` | One question per student per 15s. Questions occupy scarce screen real estate and the professor's attention; 15s is roughly the time it takes to write a real one and long enough to stop a heckler. |
| `questionMaxChars` | `200` | A question must fit a compact bubble that is legible from the back of a hall and scannable mid-sentence. 200 characters forces one question, not a paragraph. Enforced server-side (`too_long`) and shown as a live counter client-side. |
| `overlayMaxQuestions` | `5` | The overlay's hard card cap (§7). A product limit, not a technical one: five is what a professor can absorb without stopping. Overflow becomes `+N more`. |
| `resolveFadeMs` | `600` | A resolved card lingers this long before sliding out, so the click is visibly acknowledged rather than the card just vanishing. |
| `reactionFloatMinMs` / `reactionFloatMaxMs` | `2200` / `4000` | Floater lifetime range. Long enough to be noticed peripherally while lecturing, short enough that the screen clears between waves. The range is randomised per floater so a burst looks like a crowd. |
| `pollResultVisibleMs` | `20000` | Poll results stay expanded 20s, then minimize to a chip. Long enough to read a three-bar tally and react to it; short enough that the professor never has to dismiss it manually to get back to their slides. |
| `participantTimeoutMs` | `45000` | No traffic for 45s and the participant is dropped, and `presence` re-broadcast. Three missed heartbeats — tolerant of a phone briefly roaming between access points, tight enough that the count reflects the room. |
| `heartbeatMs` | `15000` | `ping`/`pong` interval on both client types. Keeps intermediaries from idling out the socket and gives the timeout above something to measure. |

Rejections are explicit, never silent: `rate_limited`, `too_long`, `empty`, `duplicate_vote`,
`not_joined` come back as `error` frames with a displayable message, so a student who is
throttled sees why instead of concluding the tool is broken.

---

## 12. MVP scope

In scope:

1. Professor overlay: transparent, always-on-top, click-through window (Tauri v2).
2. Presentation Mode / Interaction Mode toggle (`CmdOrCtrl+Shift+L`) with cursor-poll hit-testing.
3. Quiet Mode (`CmdOrCtrl+Shift+H`).
4. Start a class: server-generated 5-character code, displayed large on the overlay.
5. Server prints its LAN URL on boot; the same process serves the student app and the socket.
6. Student join by code, anonymous, no install — `anonId` in `localStorage`.
7. Six reaction types from `REACTION_META`, with per-student cooldown and `reaction:ack`.
8. Server-side burst grouping into `reaction:burst {type, count}`.
9. Overlay reaction floaters with density cap, zone-constrained spawning, protected centre.
10. Student questions, 200 chars, per-student cooldown.
11. Question upvoting, one vote per student per question.
12. Overlay question stack: votes-then-recency sort, 5-card cap, `+N more` chip.
13. Resolve a question with a checkmark; fade and slide out on both sides.
14. One-click understanding check (`got_it` / `almost` / `lost`) with live tally on the overlay.
15. Live presence count; end class cleanly, with `session:ended` to every client.

Deliberately out of scope:

- **Custom polls beyond the quick composer.** The overlay has a minimal composer for an ad-hoc
  question with a few options; there is no poll library, no question bank, no scheduled polls, no
  correct answers, no grading. A quiz builder is a different product.
- **Analytics.** No engagement graphs, no per-minute confusion timelines, no exports. The
  professor already gets the signal in real time, which is the only moment it can change anything.
- **Lecture history.** Nothing survives `session:end`. No transcripts, no archived question lists,
  no "compare this week to last week".
- **Accounts.** No professor login, no student roster, no institutional SSO. Accounts would create
  exactly the attributable identity the privacy model (§9) exists to prevent, and they would put a
  signup form between a professor and starting a class.
- **An LMS-style dashboard.** No web console, no attendance, no participation scores, no
  gradebook integration.

The philosophy, stated so future scope arguments have something to argue against: **this is a
tiny utility that runs alongside a lecture, not a classroom-management system.** Every one of the
above is a defensible feature and every one of them turns an overlay a professor forgets is there
into software a professor has to administer. Anything that requires the professor to look away
from their slides, or that makes a student wonder whether their answer is attributable, is
against the grain of the product. Features get added when they can be expressed inside the
overlay in one glance and one click.

---

## 13. Future work

- **Durable history behind the store interface.** `SessionStore` already isolates persistence.
  A Postgres adapter against the §8 schema gives end-of-lecture question exports and cross-lecture
  continuity without touching the protocol or either client. Reactions would move from
  aggregate-only to appended rows so "what confused the room at minute 34" becomes answerable —
  which is precisely the point at which the §9 privacy boundary needs re-reviewing, since a
  timeline is a richer artefact than a count.
- **Multi-monitor overlay placement.** The overlay currently assumes one screen. A professor
  presenting from a laptop to a projector wants to choose which display it covers, and wants it to
  follow the presentation display when the arrangement changes.
- **Windows and Linux click-through verification.** The cursor-poll + `set_ignore_cursor_events`
  design is verified on macOS. Windows (`WS_EX_TRANSPARENT` / `WS_EX_LAYERED` interaction with
  always-on-top) and Linux (per-compositor; Wayland may not expose a global cursor position at
  all) need testing, and Wayland may need a different strategy entirely — likely an input region
  set from the same rect registry rather than a whole-window toggle.
- **Hosted deployment.** A one-command deploy of `packages/server` for departments that would
  rather not run it on a laptop, with a stable URL and a QR code. This trades away the LAN-latency
  argument in §1, so it should be an option, not the default.
- **Reconnect hardening.** The professor resume token currently dies with the process; persisting
  it (with the store) would let a crashed overlay rejoin a class that is still running.
- **Accessibility pass on the student app.** The reaction pad is the piece most people touch;
  it needs a screen-reader review and a hit-target audit on small phones beyond the
  `prefers-reduced-motion` handling already in the theme.
