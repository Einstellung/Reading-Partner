mod migrate;
mod oauth_callback;
// Voice capture records the mic in Rust via cpal (WebKitGTK's getUserMedia is
// unreliable on the Linux desktop). It is desktop-only: mobile webviews handle
// audio themselves, and cpal pulls in a desktop audio backend that has no place
// in an iOS build, so the module and its commands compile out on mobile.
#[cfg(desktop)]
mod voice;

// Plugins: dialog + fs (M1 file open / reading state), http (AI provider requests
// routed through Rust to bypass CORS), opener (open the system browser for OAuth),
// clipboard-manager (read pasted images on WebKitGTK, whose DOM paste event drops
// image data), deep-link (receive the Google iOS OAuth custom-scheme redirect),
// os (platform detection to fork the OAuth flow). Custom command: the one-shot
// OAuth loopback listener (desktop-only in practice; registered everywhere).
//
// mobile_entry_point generates the entry the iOS/Android wrapper calls; it is
// inert on desktop, where main.rs calls run() directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
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
        .manage(voice::VoiceState::default())
        .invoke_handler(tauri::generate_handler![
            oauth_callback::start_oauth_callback_listener,
            voice::start_voice_recording,
            voice::stop_voice_recording,
            voice::cancel_voice_recording
        ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        oauth_callback::start_oauth_callback_listener
    ]);

    builder
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
