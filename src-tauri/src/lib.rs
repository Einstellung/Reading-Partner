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
// image data). Custom command: the one-shot OAuth loopback listener.
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
        // Pick up data written under the pre-0.3 bundle identifier.
        .setup(|app| {
            migrate::migrate_legacy_dirs(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
