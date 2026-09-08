//! Lecture React — desktop shell.
//!
//! Two windows:
//!   * `launcher` — a small ordinary window (START CLASS / class code / QR).
//!   * `overlay`  — a transparent, borderless, always-on-top, click-through
//!                  window covering the whole screen. Created hidden at
//!                  startup so showing it later is instant.
//!
//! ---------------------------------------------------------------------------
//! CLICK-THROUGH (the least obvious mechanic in this codebase)
//! ---------------------------------------------------------------------------
//! The overlay must let every click reach PowerPoint/Keynote underneath, while
//! a handful of small widgets (control strip, question cards, resolve buttons)
//! stay clickable. There is no per-region hit-testing API in a webview: a
//! window either swallows cursor events or it does not
//! (`set_ignore_cursor_events`).
//!
//! So we do the hit-testing ourselves, in the frontend, driven from Rust:
//!
//!   1. When the overlay window is created we spawn a background thread that
//!      polls the *global* cursor position every ~50 ms.
//!   2. It converts that screen point into the overlay window's LOGICAL
//!      coordinate space — subtract the window's outer position, divide by the
//!      scale factor — which is exactly the space `getBoundingClientRect()`
//!      reports in. It emits it as a `cursor-moved` event to the overlay.
//!   3. The frontend hit-tests that point against every element marked
//!      interactive and calls `set_click_through(enabled)` ONLY when the answer
//!      flips. Nothing crosses the IPC boundary on a normal tick.
//!
//! While the window is ignoring cursor events it receives no DOM mouse events
//! at all — that is why the position has to come from the OS side rather than
//! from `mousemove`.
//!
//! `set_interaction_mode(true)` ("full interaction", bound to Cmd/Ctrl+Shift+L)
//! pins the window to *never* ignore cursor events, so the professor can grab
//! the strip without chasing pixels.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const LAUNCHER_LABEL: &str = "launcher";
pub const OVERLAY_LABEL: &str = "overlay";

/// How often the cursor is sampled. 20 Hz is imperceptible for hovering a
/// button and costs almost nothing.
const CURSOR_POLL_MS: u64 = 50;

/* ------------------------------------------------------------------ */
/* Shared state                                                        */
/* ------------------------------------------------------------------ */

#[derive(Default)]
pub struct OverlayState {
    /// Last value the frontend asked for via `set_click_through`.
    wants_click_through: AtomicBool,
    /// Full-interaction mode overrides `wants_click_through`.
    interaction_mode: AtomicBool,
    /// Quiet mode lives in the frontend; Rust only owns the shortcut toggle.
    quiet_mode: AtomicBool,
    /// Cleared when the overlay window goes away, which stops the poll thread.
    cursor_thread_running: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
struct CursorPoint {
    /// Logical CSS pixels, relative to the overlay window's top-left.
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize)]
struct ToggleEvent {
    enabled: bool,
}

/* ------------------------------------------------------------------ */
/* Window plumbing                                                     */
/* ------------------------------------------------------------------ */

/// Screen geometry the overlay should cover.
fn overlay_bounds<R: Runtime>(app: &AppHandle<R>) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    // `available_monitors`/`primary_monitor` can both fail on a headless or
    // still-initialising display server; fall back to a sane default rather
    // than refusing to open the overlay.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        // NOTE: we deliberately use the *full* monitor rectangle rather than
        // the work area. The overlay is click-through, so covering the menu
        // bar / dock costs the professor nothing, and it keeps the overlay
        // aligned with a fullscreen presentation. (`Monitor::work_area` is
        // available in newer Tauri 2.x; switching to it is a one-line change.)
        (*monitor.position(), *monitor.size())
    } else {
        (PhysicalPosition::new(0, 0), PhysicalSize::new(1440, 900))
    }
}

/// Creates the overlay window, hidden. Idempotent.
fn build_overlay<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(existing);
    }

    let (pos, size) = overlay_bounds(app);
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        // The frontend routes on `?window=`, which also makes the overlay
        // reviewable in a plain browser.
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .title("Lecture React Overlay")
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .shadow(false)
    .skip_taskbar(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .visible(false)
    .inner_size(size.width as f64 / scale, size.height as f64 / scale)
    .position(pos.x as f64 / scale, pos.y as f64 / scale)
    .build()?;

    // Cover the screen exactly, in physical pixels, regardless of rounding in
    // the logical sizes above.
    let _ = window.set_position(pos);
    let _ = window.set_size(size);

    // Stay above a fullscreen Keynote/PowerPoint and follow the professor
    // across Spaces. Both calls are best-effort: on platforms/versions where
    // they are unsupported they simply return an error we ignore.
    let _ = window.set_visible_on_all_workspaces(true);
    let _ = window.set_always_on_top(true);

    // Start fully click-through: presentation mode is the default state.
    let _ = window.set_ignore_cursor_events(true);
    app.state::<OverlayState>()
        .wants_click_through
        .store(true, Ordering::Relaxed);

    spawn_cursor_poller(app.clone(), window.clone());

    // Stop the poller if the window is destroyed.
    {
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                app_handle
                    .state::<OverlayState>()
                    .cursor_thread_running
                    .store(false, Ordering::Relaxed);
            }
        });
    }

    Ok(window)
}

/// Step 1+2 of the click-through mechanic: poll the OS cursor and hand the
/// overlay the point in its own logical coordinate space.
fn spawn_cursor_poller<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) {
    let running = app.state::<OverlayState>().cursor_thread_running.clone();
    if running.swap(true, Ordering::SeqCst) {
        return; // already polling
    }

    std::thread::spawn(move || {
        let mut last = (f64::NAN, f64::NAN);
        while running.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(CURSOR_POLL_MS));

            // If the overlay is hidden there is nothing to hit-test.
            if !window.is_visible().unwrap_or(false) {
                continue;
            }

            let Ok(cursor) = app.cursor_position() else {
                continue;
            };
            let Ok(origin) = window.outer_position() else {
                continue;
            };
            let scale = window.scale_factor().unwrap_or(1.0).max(0.1);

            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;

            // Sub-pixel jitter would spam the webview for no reason.
            if (x - last.0).abs() < 0.5 && (y - last.1).abs() < 0.5 {
                continue;
            }
            last = (x, y);

            let _ = window.emit("cursor-moved", CursorPoint { x, y });
        }
    });
}

/// Applies `wants_click_through` unless full-interaction mode overrides it.
fn apply_click_through<R: Runtime>(app: &AppHandle<R>, state: &OverlayState) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    let ignore = !state.interaction_mode.load(Ordering::Relaxed)
        && state.wants_click_through.load(Ordering::Relaxed);
    let _ = window.set_ignore_cursor_events(ignore);
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn show_overlay(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
    let window = build_overlay(&app).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    // Never steal focus from the presentation.
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    apply_click_through(&app, &state);
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_overlay(app: AppHandle, state: State<'_, OverlayState>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    state.cursor_thread_running.store(false, Ordering::Relaxed);
    Ok(())
}

/// Step 3: called by the frontend hit-test, and ONLY when the answer changes.
#[tauri::command]
fn set_click_through(app: AppHandle, state: State<'_, OverlayState>, enabled: bool) {
    state.wants_click_through.store(enabled, Ordering::Relaxed);
    apply_click_through(&app, &state);
}

/// Full-interaction mode: the overlay never ignores cursor events.
#[tauri::command]
fn set_interaction_mode(app: AppHandle, state: State<'_, OverlayState>, on: bool) {
    state.interaction_mode.store(on, Ordering::Relaxed);
    apply_click_through(&app, &state);
    let _ = app.emit_to(OVERLAY_LABEL, "interaction-mode", ToggleEvent { enabled: on });
}

/// Restores the launcher after the class ends.
#[tauri::command]
fn focus_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LAUNCHER_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().ok();
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Gets the launcher out of the way once the overlay is up.
#[tauri::command]
fn hide_launcher(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LAUNCHER_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<'_, OverlayState>) {
    state.cursor_thread_running.store(false, Ordering::Relaxed);
    app.exit(0);
}

/* ------------------------------------------------------------------ */
/* Global shortcuts                                                    */
/* ------------------------------------------------------------------ */

/// `CmdOrCtrl` — Cmd on macOS, Ctrl elsewhere.
fn primary_modifier() -> Modifiers {
    #[cfg(target_os = "macos")]
    {
        Modifiers::SUPER | Modifiers::SHIFT
    }
    #[cfg(not(target_os = "macos"))]
    {
        Modifiers::CONTROL | Modifiers::SHIFT
    }
}

fn toggle_interaction_shortcut() -> Shortcut {
    Shortcut::new(Some(primary_modifier()), Code::KeyL)
}

fn toggle_quiet_shortcut() -> Shortcut {
    Shortcut::new(Some(primary_modifier()), Code::KeyH)
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Bundled realtime server                                             */
/* ------------------------------------------------------------------ */

/// Port the server listens on, matching the frontend's default origin.
const SERVER_PORT: u16 = 8787;

/// Handle to the server we started, so it dies with the app rather than
/// lingering and holding the port.
struct ServerProcess(Mutex<Option<std::process::Child>>);

/// True when something already answers on the server port — a `pnpm dev`
/// session, or a second copy of the app. Starting another would just fail to
/// bind and leave a confusing error, so we attach to the running one instead.
fn server_already_running() -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], SERVER_PORT)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

/// Starts the bundled server sidecar.
///
/// The binary is a self-contained Node SEA build placed next to this
/// executable by Tauri's `externalBin`. In a `tauri dev` run it is absent,
/// which is fine: the dev server is already running.
fn start_server(app: &AppHandle) -> Option<std::process::Child> {
    if server_already_running() {
        println!("[lecture-react] realtime server already running on {SERVER_PORT}");
        return None;
    }

    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let binary = exe_dir.join(if cfg!(windows) { "lr-server.exe" } else { "lr-server" });
    if !binary.exists() {
        eprintln!(
            "[lecture-react] no bundled server at {} — expecting a dev server on {SERVER_PORT}",
            binary.display()
        );
        return None;
    }

    // The packaged server cannot locate the student app relative to its own
    // source, so it is told where the bundled copy lives.
    let student_dist = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("student"))
        .ok();

    let mut cmd = std::process::Command::new(&binary);
    cmd.env("PORT", SERVER_PORT.to_string());
    if let Some(dist) = student_dist {
        cmd.env("LECTURE_STUDENT_DIST", dist);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: no server console over slides.
    }

    match cmd.spawn() {
        Ok(child) => {
            println!("[lecture-react] started bundled server (pid {})", child.id());
            Some(child)
        }
        Err(err) => {
            eprintln!("[lecture-react] could not start bundled server: {err}");
            None
        }
    }
}

pub fn run() {
    // Set before Tauri creates either webview. Both windows share USB-local storage.
    #[cfg(windows)]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("portable.txt").is_file() {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("Data"));
                if dir.join("WebView2/msedgewebview2.exe").is_file() {
                    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", dir.join("WebView2"));
                }
            }
        }
    }
    tauri::Builder::default()
        .manage(OverlayState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return; // one action per physical press
                    }
                    let state = app.state::<OverlayState>();

                    if shortcut == &toggle_interaction_shortcut() {
                        let on = !state.interaction_mode.load(Ordering::Relaxed);
                        state.interaction_mode.store(on, Ordering::Relaxed);
                        apply_click_through(app, &state);
                        let _ = app.emit_to(
                            OVERLAY_LABEL,
                            "interaction-mode",
                            ToggleEvent { enabled: on },
                        );
                    } else if shortcut == &toggle_quiet_shortcut() {
                        let on = !state.quiet_mode.load(Ordering::Relaxed);
                        state.quiet_mode.store(on, Ordering::Relaxed);
                        let _ =
                            app.emit_to(OVERLAY_LABEL, "quiet-mode", ToggleEvent { enabled: on });
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            show_overlay,
            hide_overlay,
            close_overlay,
            set_click_through,
            set_interaction_mode,
            focus_launcher,
            hide_launcher,
            quit_app,
        ])
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // Start the realtime server before anything tries to connect.
            let child = start_server(&handle);
            if let Some(state) = app.try_state::<ServerProcess>() {
                if let Ok(mut slot) = state.0.lock() {
                    *slot = child;
                }
            }

            // Registration failures (another app owns the combo) must not stop
            // the class from starting — the on-screen controls still work.
            let shortcuts = app.global_shortcut();
            if let Err(err) = shortcuts.register(toggle_interaction_shortcut()) {
                eprintln!("[lecture-react] could not register Cmd/Ctrl+Shift+L: {err}");
            }
            if let Err(err) = shortcuts.register(toggle_quiet_shortcut()) {
                eprintln!("[lecture-react] could not register Cmd/Ctrl+Shift+H: {err}");
            }

            // Pre-create the overlay (hidden) so START OVERLAY is instant.
            if let Err(err) = build_overlay(&handle) {
                eprintln!("[lecture-react] overlay window could not be created: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lecture React")
        .run(|handle, event| {
            // Never leave the server running after the window closes: it would
            // hold port 8787 and the next launch would silently attach to a
            // server with no class in it.
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                if let Some(state) = handle.try_state::<ServerProcess>() {
                    if let Ok(mut slot) = state.0.lock() {
                        if let Some(mut child) = slot.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
