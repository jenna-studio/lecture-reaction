# Lecture React

A professor is mid-slide and has no idea half the room stopped following two minutes ago.
Lecture React is a transparent overlay that floats that signal over whatever they are already
presenting.

The professor runs a click-through desktop window on top of PowerPoint, Keynote, a PDF, a
browser, an IDE — anything. Students open a URL on their phone, type a 5-character class code,
and tap: *understand*, *confused*, *too fast*, *too slow*, *again*, *interesting*. Reactions
float up over the slides. Questions stack as compact bubbles down the right edge, sorted by
votes; the professor clears them with a checkmark and can fire a one-click understanding check.

No student install. No login on either side. No dashboard — the overlay **is** the professor
interface, and nobody ever looks away from the slides.

## What the overlay looks like

```
 +---------------------------------------------------------------+
 |                                          [ Q ] can you redo    |
 |                                          [ 3 ] the proof?  [v] |
 |                                                                |
 |            (nothing spawns over the slide content)             |
 |                                          [ Q ] what's the      |
 |   ^  ^                                   [ 1 ] base case?  [v] |
 |   O  ?                                                         |
 |  ^   ^   ^                               ( +2 more )           |
 |  ?   O   !                                                     |
 |                                                                |
 |  [ ABCDE ]  [ 34 online ]  [ check ]  [ quiet ]                |
 +---------------------------------------------------------------+
   ^ reactions rise from the left column and the bottom band
     the right-hand strip is reserved for questions
     the class code and controls sit in the corner
```

Everything you see is drawn on a transparent, always-on-top window. Clicks pass straight through
to the slides underneath — except over the controls, the question cards and the checkmarks.

## Repo layout

```
lecture-reaction/
├── packages/
│   ├── shared/      protocol.ts (wire types + LIMITS + REACTION_META),
│   │                code.ts (class-code generation/normalisation),
│   │                theme.css (retro pixel design tokens)
│   └── server/      Node 20 + ws realtime server; also serves the student app
├── apps/
│   ├── student/     Vite + React web app — what students open on their phone
│   └── overlay/     Tauri v2 + React — the professor's desktop overlay
└── docs/
    └── ARCHITECTURE.md
```

pnpm workspaces. `packages/shared` is the single source of truth for the wire protocol and the
design tokens; all three other packages depend on it, so a protocol change breaks the typecheck
on every side in the same commit.

## Prerequisites

- **Node 20+** and **pnpm** — required for everything.
- **Rust toolchain + Tauri v2 system prerequisites** — required only for `apps/overlay`
  (the desktop app). Follow https://tauri.app/start/prerequisites/ for your platform:
  macOS needs Xcode Command Line Tools; Linux needs the WebKitGTK and build packages; Windows
  needs the MSVC build tools and WebView2.

If you are only working on the server or the student app, you can skip Rust entirely and use
`pnpm dev:web`.

## Running it

```bash
pnpm install

pnpm dev        # server + student app + overlay (needs the Rust toolchain)
pnpm dev:web    # server + student app only (no Rust needed)
```

Ports:

| Port | What |
| --- | --- |
| `8787` | Realtime server — WebSocket endpoint and the student app over HTTP |
| `5173` | Vite dev server for `apps/student` |
| `5174` | Vite dev server for the overlay webview, which Tauri loads |

The server prints its LAN URL on boot, something like `http://192.168.1.42:8787`. That is the
address students use. They must be on the same network as the machine running the server —
the room's Wi-Fi, or the campus network if you are hosting it centrally. If nobody can reach it,
check your firewall is allowing inbound connections on 8787 before checking anything else.

Other root scripts: `pnpm build`, `pnpm typecheck`, `pnpm tauri`.

Verified on macOS (Node 25, pnpm 10): `pnpm install`, `pnpm typecheck` across all four
packages, `pnpm build` for the student and overlay bundles, `cargo check` for the Tauri shell,
and the server smoke test against a live 30-student session. The Tauri app has been compiled
but not launched as a window here, so the transparent always-on-top and click-through
behaviour is unverified on any platform — that is the one thing to check first.

## Keyboard shortcuts

| Shortcut | Effect |
| --- | --- |
| `CmdOrCtrl+Shift+L` | Toggle **Interaction Mode** — the whole overlay becomes clickable so you can drag panels, open the poll composer, and work through questions. Slides underneath are not clickable while this is on. Toggle it back off to keep presenting. |
| `CmdOrCtrl+Shift+H` | Toggle **Quiet Mode** — reaction floaters are suppressed and the question stack dims to a count chip. Questions keep arriving; they just stop moving in your peripheral vision. |

Both are global, so they work while PowerPoint has focus.

## Development tools

Testing a lecture tool normally needs a lecture. These stand in for one:

| Command | What it does |
| --- | --- |
| `pnpm -F @lr/server smoke` | Drives a scripted 30-student class against a running server and asserts the protocol end to end: code format, presence, burst grouping, rate limits, upvotes, poll tallies, resolve, end-of-class, and rejoin-after-end. Requires the server to already be running. |
| `pnpm -F @lr/server simulate <CODE>` | Joins 24 simulated students to a live class: posts four questions with different vote weights, answers any understanding check, and keeps reaction waves flowing. Use it to exercise the overlay without 24 phones. |
| `pnpm icon` | Regenerates the app icon from the pixel grid in `tools/make-icon.mjs` and expands it to every platform size. Tauri needs `src-tauri/icons/32x32.png` at compile time — if it is missing, the **Rust** build fails with `failed to open icon`, which looks unrelated to icons at first glance. |

To review the overlay's layout without building the desktop app, open
`http://localhost:5174/?window=launcher` (or `?window=overlay`) in a browser.
Tauri calls are feature-detected, so the overlay renders against a placeholder
slide backdrop instead of a transparent window.

## How a class runs

1. **Start.** Launch the overlay. It connects to the server and gets a 5-character class code,
   shown large in the corner. Read it out, or leave it on screen — it is styled to be legible
   from the back row.
2. **Students join.** They open the LAN URL, type the code, and land on the reaction pad.
   No account, no app, no name. The overlay shows a live count of how many are connected.
3. **Present.** Lecture normally. The overlay is click-through, so your slides behave exactly as
   they did before it was running. Reactions rise up the margins; the centre of the slide is
   never covered.
4. **Questions.** Students type a question (200 chars) and upvote each other's. The top five by
   votes dock along the right edge; the rest collapse into a `+N more` chip. Click the checkmark
   on a card when you have answered it — it fades out for you and greys out for the student who
   asked, so they know it was addressed.
5. **Check understanding.** One click opens a *Got it / Almost / Lost* poll on every phone. The
   tally appears live on the overlay, stays up for 20 seconds, then minimizes.
6. **End.** End the class from the overlay. Every student gets a clean end screen and the code is
   released. Nothing is stored — reactions were never persisted, and the questions go with the
   session.

## Docs

`docs/ARCHITECTURE.md` covers the wire protocol message by message, the click-through mechanism
and why CSS `pointer-events` cannot do it, the two-stage reaction burst grouping, the data model
and its future Postgres shape, the privacy boundary, the design system tokens, every rate limit
and its rationale, and what is deliberately out of scope.
