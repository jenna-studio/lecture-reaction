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
 |  [ ABCDE ] [ ? Ask Class ] [ Reactions ] [ * ] [ End Class ]  |
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
pnpm install     # once

pnpm desktop     # ← run the actual product: realtime server + professor desktop app
```

`pnpm desktop` is the one you want. It starts the realtime server *and* the Tauri
desktop app together, which matters: `pnpm tauri dev` on its own launches the
overlay with no server to talk to, and it will sit there failing to connect.

The other modes:

```bash
pnpm dev         # server + student app + overlay in a BROWSER (no Rust needed)
pnpm dev:web     # server + student app only
pnpm tauri dev   # desktop app alone — only useful if a server is already running
```

Ports:

| Port | What |
| --- | --- |
| `8787` | Realtime server — WebSocket endpoint and the student app over HTTP |
| `5173` | Vite dev server for `apps/student` |
| `5174` | Vite dev server for the overlay webview, which Tauri loads |

The server works out the address students should use **every time it is asked**, so it
follows whatever network you are on. See [Getting students in](#getting-students-in).

Other root scripts: `pnpm build`, `pnpm typecheck`, `pnpm tauri`.

### What has actually been verified

On macOS (Node 25, pnpm 10): install, typecheck across all four packages, both web
bundles building, the Tauri shell compiling and **launching**, the server smoke test
against a live 30-student session, and the student app driven end to end on a phone
viewport (join, react, ask, upvote, see a question resolved).

Not yet verified anywhere: the overlay's **transparency, always-on-top and
click-through behaviour over a real presentation**. The window runs, but whether it
floats correctly above a fullscreen Keynote — macOS Spaces are the usual failure —
and whether clicks reach the app underneath is untested. That is the first thing to
check, and `CmdOrCtrl+Shift+L` is the escape hatch if the overlay ever swallows your
clicks. Windows and Linux are entirely untested.

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
| `pnpm -F @lr/server test:lan` | Ranks synthetic macOS/Windows/Linux interface tables and asserts the right address wins in each — VM bridges, WSL, Docker and VPN adapters must all lose to the real Wi-Fi. Runs without a server. |
| `pnpm icon` | Regenerates the app icon from the pixel grid in `tools/make-icon.mjs` and expands it to every platform size. Tauri needs `src-tauri/icons/32x32.png` at compile time — if it is missing, the **Rust** build fails with `failed to open icon`, which looks unrelated to icons at first glance. |

`pnpm dev`, `pnpm dev:web` and `pnpm desktop` all run `tools/free-ports.mjs` first.
It reclaims ports `8787`/`5173`/`5174` and stops leftover overlay instances, but
**only processes belonging to this checkout** — anything else holding a port is
reported by name and the run stops, rather than being killed out from under you.
It matches `-sTCP:LISTEN` only, because a plain `lsof -ti:5174` also lists the
Tauri webview's own *connections* to the port, and killing those kills the app
you are trying to start.

To review the overlay's layout without building the desktop app, open
`http://localhost:5174/?window=launcher` (or `?window=overlay`) in a browser.
Tauri calls are feature-detected, so the overlay renders against a placeholder
slide backdrop instead of a transparent window.

## Using it in a lecture

### Before the class

```bash
pnpm desktop
```

Two things start: the realtime server, and a small **launcher** window.

Get on the **same Wi-Fi the students will use** before you show anyone the code. The
address students need comes from that network, and it is the one thing that will
quietly ruin a class if it is wrong.

### Starting the class

1. Click **START CLASS** in the launcher. A fresh 5-character code appears — `K7M4P`.
   Every class gets a new one, and the previous code dies the moment its class ends.
2. Share it, whichever way suits the room:
   - **Show QR** on the projector — the fastest way to get a hall full of phones in.
   - **Copy Link** puts `http://<address>:8787/?c=K7M4P` on your clipboard, to paste
     into the LMS, a chat, or an email. Best for students on laptops.
   - **Copy Code** copies just the five characters, if you are sharing the address
     some other way.

   All three carry the code, so students land already joined rather than on a form.
   The address is re-checked continuously, so the link and the QR stay correct even
   if you join the room's Wi-Fi after starting the app.
3. Watch `N students joined` climb. When the room is in, click **Start Overlay**.
   The launcher gets out of the way and the transparent overlay takes over.

If you would rather say it out loud than show a QR, read out the address from the
server's boot log and the code from the launcher. The code deliberately contains no
`O`, `0`, `I`, `1` or `L`, so there is nothing ambiguous to say aloud — and if a
student types one of those anyway, the field ignores the keystroke rather than
accepting a code that cannot exist.

### During the class

Present exactly as you normally would. The overlay is click-through: your slides,
your clicker and your IDE all behave as if it were not running.

| You want to | Do this |
| --- | --- |
| See how the room is doing | Nothing. Reactions float up the left and bottom margins. A wave of the same reaction arrives as one icon with a count (`? x 14`), not fourteen icons. |
| Answer a question | Read the cards down the right edge — newest at the bottom, most-upvoted highlighted. Click the checkmark when you have answered it; the card fades and slides away, and the student who asked sees `Answered`. |
| Ask if they are following | Click **? Ask Class**. Every phone gets *Got it / Almost / Lost*, and the tally appears on your overlay within a second. It stays up for 20 seconds, then minimizes itself. |
| Ask something specific | Alt-click (or long-press) **? Ask Class** for a quick poll composer: a question and 2-4 options. It is deliberately small — this is not a survey tool. |
| Hide reactions for a moment | Click **Reactions**, or press `CmdOrCtrl+Shift+H`. Reactions keep being collected and counted, they just stop moving on screen. Useful during a video, a demo, or an exam. |
| Move the controls | Drag the strip. Click the code to collapse it down to just `[ K7M4P ]`. Both are remembered. |
| Click something on the overlay and nothing happens | Press `CmdOrCtrl+Shift+L` for Interaction Mode — the whole overlay becomes clickable. Press it again to go back to presenting. |

### Ending the class

Click **End Class** on the strip and confirm. Every student immediately gets
`Class ended. Thanks for participating.`, the code stops working, and the overlay
closes. Starting another class generates a different code; nothing carries over.

Nothing is stored. Reactions were never written down, and the questions go with the
session.

## Getting students in

Students open the server's address on their phone. No app, no account, no name.

The server **re-derives that address on every request**, so it tracks your
environment rather than being fixed at startup. Join the lecture hall Wi-Fi after
launching the app and the QR updates on its own within ten seconds — the launcher
re-asks continuously and also refreshes immediately on any network change.

### Choosing the right address is not trivial

A teaching laptop usually has several addresses and only one of them is reachable
from a phone in the room. On the machine this was developed on:

```
en0        10.103.85.46     real Wi-Fi          <- the one students need
bridge100  10.211.55.2      Parallels VM net    <- unreachable from a phone
bridge101  10.37.129.2      Parallels VM net    <- unreachable from a phone
```

So candidates are scored rather than taken in whatever order the OS returns them:
physical interfaces beat virtual ones, private LAN ranges beat public addresses, and
VM bridges, Docker networks, VPN tunnels and AirDrop radios are pushed to the bottom.
The boot log prints what it rejected and why, and `GET /api/join-url` returns the
full ranking.

If it still picks wrong — a room with two NICs, an unusual campus setup — override it:

```bash
LECTURE_LAN_IP=192.168.1.42 pnpm desktop
```

### When students cannot connect

Work down this list; it is roughly in order of likelihood.

1. **Are they on the same Wi-Fi?** Cellular data cannot reach your laptop. This is
   almost always the answer.
2. **Did macOS ask to allow incoming connections?** If you dismissed that prompt,
   nothing can reach the server. System Settings -> Network -> Firewall.
3. **Is the address the right one?** Check the boot log against the list above. If
   the chosen line is a `bridge`/`vmnet`/`utun` interface, use `LECTURE_LAN_IP`.
4. **Client isolation.** Many campus and guest networks block phone-to-laptop
   traffic entirely as a security policy. Nothing in this app can work around that —
   you need a different network, or the server hosted somewhere the campus routes to.
   **Test this with one phone before you rely on it in front of a class.**

## Platform support

| | Server | Student app | Professor overlay |
| --- | --- | --- | --- |
| macOS | works | works | **verified running**, click-through untested over a real presentation |
| Windows | should work | works | compiles in principle, never built or run |
| Linux | should work | works | compiles in principle, never built or run |

The server and the student app are the easy half: Node and a browser. The address
ranking is explicitly tested against Windows and Linux interface layouts
(`pnpm -F @lr/server test:lan`).

The overlay is the part that is genuinely platform-sensitive, because transparency,
always-on-top and click-through are OS window-manager features that Tauri exposes
but cannot make uniform.

**Windows.** Nothing in the Rust shell is macOS-only — the one platform-specific
detail, `Cmd` versus `Ctrl`, is `cfg`-gated, and `icon.ico` is generated. You need
the MSVC build tools and WebView2 (see [Prerequisites](#prerequisites)), then
`pnpm desktop`. The behaviour to check first is a **PowerPoint slideshow**: it takes
a topmost fullscreen window, which is exactly the thing most likely to sit above the
overlay. Presenter View on a second monitor is the usual workaround, and the overlay
does not yet choose which monitor it covers.

**Linux.** Wayland is the open question. Click-through there is a compositor-level
input-region concept rather than a window flag, so `set_ignore_cursor_events` may
not behave the same way. X11 should be closer to macOS behaviour.

None of this is speculation about the code — it compiles for these targets. It is
untested runtime behaviour, and worth an hour on the actual machine before a lecture
depends on it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Port 5174 is already in use` | A previous run left a dev server behind. `pnpm desktop` now clears this automatically (see below), so this should not recur — if it does, something outside this repo holds the port and the preflight will name it. |
| Several overlay windows on screen | Stale app instances from earlier runs. Killing the dev servers does not stop an already-running Tauri binary. The preflight now stops them too. |
| Overlay shows an old class code | Fixed, but if it recurs: the overlay follows the session the launcher persists. It should re-attach within 400ms of a new class starting. |
| Rust build fails with `failed to open icon` | The icon set is missing. `pnpm icon`. Tauri reads `icons/32x32.png` at compile time, so this surfaces as a Rust error rather than an asset one. |
| Students see `Can't reach the server. Still trying...` | The server is not reachable from their phone — work through [When students cannot connect](#when-students-cannot-connect). |
| Overlay swallows clicks | `CmdOrCtrl+Shift+L` toggles Interaction Mode off. |

## Docs

`docs/ARCHITECTURE.md` covers the wire protocol message by message, the click-through mechanism
and why CSS `pointer-events` cannot do it, the two-stage reaction burst grouping, the data model
and its future Postgres shape, the privacy boundary, the design system tokens, every rate limit
and its rationale, and what is deliberately out of scope.
