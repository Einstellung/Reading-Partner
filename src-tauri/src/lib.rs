// M1 needs no custom commands: the dialog and fs plugins cover file open,
// and reading-state JSON is written from the frontend via the fs plugin.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
