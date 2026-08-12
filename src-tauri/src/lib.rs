mod atomic_fs;
mod image_proxy;
mod migrate;
mod navigation;
mod oauth_callback;
// Voice capture records the mic in Rust via cpal (WebKitGTK's getUserMedia is
// unreliable on the Linux desktop). It is desktop-only: mobile webviews handle
// audio themselves, and cpal pulls in a desktop audio backend that has no place
// in an iOS build, so the module and its commands compile out on mobile.
#[cfg(desktop)]
mod voice;
// On-demand article fetching through a hidden webview (docs/17). Desktop only:
// the DOM comes back through WebKitGTK's own JS bridge, and iOS's WKWebView has
// both a different bridge and a cookie policy (ITP) that the warm-up this
// depends on is not known to survive. See the module note.
#[cfg(desktop)]
mod webview_fetch;
// The tray icon and close-to-tray (docs/36). Desktop only: there is no tray on a
// phone, and the collector this keeps alive does not run there either.
#[cfg(desktop)]
mod tray;

// Plugins: dialog + fs (M1 file open / reading state), http (AI provider requests
// routed through Rust to bypass CORS), opener (open the system browser for OAuth),
// clipboard-manager (read pasted images on WebKitGTK, whose DOM paste event drops
// image data), deep-link (receive the Google mobile OAuth custom-scheme redirect
// on iOS and Android),
// os (platform detection to fork the OAuth flow). Custom commands: the one-shot
// OAuth loopback listener (desktop-only in practice; registered everywhere) and
// the atomic data-file writer (atomic_fs), which the fs plugin has no equivalent
// for. The `img:` URI scheme (image_proxy) serves the article images the
// webview's CSP/COEP would otherwise drop.
//
// mobile_entry_point generates the entry the iOS/Android wrapper calls; it is
// inert on desktop, where main.rs calls run() directly.
//
// navigation is ours: a plugin only because that is the one hook that reaches
// windows created from tauri.conf.json. It cancels every navigation that would
// leave the app's own page (navigation.rs).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(navigation::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // The voice commands and their state only exist on desktop (see the module
    // note above); everything else is registered on both.
    #[cfg(desktop)]
    let builder = builder
        // Start with the machine when the user has asked for it (docs/36). Off
        // by default and registered here only; the choice itself is a per-device
        // one and lives in device.json, not in the synced settings.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(voice::VoiceState::default())
        // The fetcher's state is also what the navigation guard reads to tell a
        // hidden fetcher window from the app's own, so it is managed before any
        // window exists.
        .manage(webview_fetch::WebviewFetchState::default())
        .invoke_handler(tauri::generate_handler![
            atomic_fs::write_text_file_atomic,
            atomic_fs::quarantine_file,
            oauth_callback::start_oauth_callback_listener,
            voice::start_voice_recording,
            voice::stop_voice_recording,
            voice::cancel_voice_recording,
            webview_fetch::fetch_article_via_webview,
            webview_fetch::session::open_site_sign_in,
            webview_fetch::session::check_site_session,
            webview_fetch::session::clear_site_cookies,
            tray::set_tray_status
        ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        atomic_fs::write_text_file_atomic,
        atomic_fs::quarantine_file,
        oauth_callback::start_oauth_callback_listener
    ]);

    builder
        .register_asynchronous_uri_scheme_protocol(image_proxy::SCHEME, image_proxy::handle)
        .setup(|app| {
            // App-wide root directory guarantee. Tauri derives the per-app data
            // dir from the bundle identifier but never creates it, and
            // writeTextFile does not create parent directories. On a fresh iOS
            // install the dir does not exist on first run, so the first writer
            // (Google sign-in) hit "os error 2" (see docs/pitfall). Create it
            // once at startup so every later write finds the root in place.
            // Idempotent, runs every launch; a failure is logged, not fatal —
            // a real problem surfaces at the actual write.
            use tauri::Manager;
            match app.path().app_data_dir() {
                Ok(dir) => {
                    if let Err(err) = std::fs::create_dir_all(&dir) {
                        eprintln!("failed to create app data dir {}: {}", dir.display(), err);
                    }
                }
                Err(err) => eprintln!("failed to resolve app data dir: {}", err),
            }
            // Pick up data written under the pre-0.3 bundle identifier.
            migrate::migrate_legacy_dirs(app.handle());
            // Dev-only: with RP_WEBVIEW_FETCH_PROBE set, fetch those URLs
            // through the hidden webview, print the results and exit. No-op
            // without the variable.
            #[cfg(desktop)]
            {
                webview_fetch::run_probe_from_env(app.handle());
                webview_fetch::session::run_probe_from_env(app.handle());
                // The tray is what lets the app go on collecting with its window
                // closed (docs/36), so the close button only stops being a quit
                // button once there is an icon to reach the app by.
                if tray::init(app.handle()) {
                    tray::hide_on_close(app.handle());
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
