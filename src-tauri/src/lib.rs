mod migrate;
mod oauth_callback;
mod voice;

// Plugins: dialog + fs (M1 file open / reading state), http (AI provider requests
// routed through Rust to bypass CORS), opener (open the system browser for OAuth),
// clipboard-manager (read pasted images on WebKitGTK, whose DOM paste event drops
// image data). Custom command: the one-shot OAuth loopback listener.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(voice::VoiceState::default())
        .invoke_handler(tauri::generate_handler![
            oauth_callback::start_oauth_callback_listener,
            voice::start_voice_recording,
            voice::stop_voice_recording,
            voice::cancel_voice_recording
        ])
        // Pick up data written under the pre-0.3 bundle identifier.
        .setup(|app| {
            migrate::migrate_legacy_dirs(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
