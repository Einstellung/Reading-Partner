// The tray icon, and with it the app's right to outlive its window (docs/36).
//
// The collector end is a desktop machine that keeps polling while its owner
// reads on a phone. That needs the process to survive the window being closed,
// which is what this module is: an icon with a menu, a close button that hides
// instead of quitting, and one honest way out.
//
// Desktop only. The module is compiled out on iOS and Android, where there is no
// tray, the window is the app, and the collector does not run at all.
//
// Linux notes, all measured against the tray-icon crate this rides on:
//
// - Mouse events on the icon are never emitted. The click handler below is for
//   macOS and Windows; on Linux the context menu is the entire interface, so
//   everything the icon can do is also a menu item.
// - The tooltip is unsupported. The same sentence is therefore also the text of
//   a disabled menu item, which is where a Linux user reads it.
// - The icon needs a StatusNotifier host on the desktop to appear at all
//   (libayatana-appindicator3 at runtime, plus a shell that shows it — GNOME
//   needs an extension). Nothing here can detect a missing host: the icon is
//   registered over D-Bus and simply goes nowhere. See the README.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub const TRAY_ID: &str = "main";
const STATUS_ITEM: &str = "collector-status";
const SHOW_ITEM: &str = "show";
const QUIT_ITEM: &str = "quit";

// The status line, held so the frontend can rewrite it. Managed state rather
// than a lookup because a TrayIcon does not hand its menu back.
struct TrayStatusItem<R: Runtime>(MenuItem<R>);

// What the tray says before the collector has said anything. Replaced by the
// first status the frontend pushes, which happens on the app's first poll cycle.
const UNKNOWN_STATUS: &str = "Collection status unknown";

// Build the icon. Returns whether it was built: the caller only takes the window
// hostage (hide-on-close) when there is something left to reach the app by.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> bool {
    match build(app) {
        Ok(()) => true,
        Err(err) => {
            eprintln!("failed to create the tray icon: {err}");
            false
        }
    }
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, STATUS_ITEM, UNKNOWN_STATUS, false, None::<&str>)?;
    let show = MenuItem::with_id(app, SHOW_ITEM, "Show Reading Partner", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&status, &PredefinedMenuItem::separator(app)?, &show, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(UNKNOWN_STATUS)
        // The left click toggles the window; the menu is the right click. Only
        // macOS and Windows ever see this — Linux shows the menu on either.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ITEM => show_window(app),
            QUIT_ITEM => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayStatusItem(status));
    Ok(())
}

// Bring the window back, whatever it was hiding behind. Hidden and minimised are
// separate states and a window can be in both, so both are undone.
fn show_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

// The click on the icon: away if it is in front, back otherwise. A minimised
// window still reports itself visible, so it counts as away.
fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let up = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    if up {
        let _ = window.hide();
    } else {
        show_window(app);
    }
}

// Closing the window puts the app in the tray instead of ending it. Installed
// only when the icon was built, so a desktop with no tray at all cannot end up
// with an app it can neither see nor quit.
pub fn hide_on_close<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
}

// What the collector is up to, in one sentence the frontend writes
// (src/info/briefing/collector.ts). Both places it can be read are set from it:
// the tooltip, which Linux ignores, and the disabled first menu item, which is
// where Linux reads it.
#[tauri::command]
pub fn set_tray_status<R: Runtime>(app: AppHandle<R>, text: String) {
    if let Some(item) = app.try_state::<TrayStatusItem<R>>() {
        let _ = item.0.set_text(&text);
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(&text));
    }
}
