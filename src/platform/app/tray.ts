// The tray icon's one writable field, from this side (src-tauri/src/tray.rs).
//
// The icon itself is built in Rust, because it has to exist whether or not a
// window does. All the frontend owns is the sentence on it: what the collector
// is up to, which is the one thing a closed-window app still has to be able to
// say (docs/36).

import { invoke } from "@tauri-apps/api/core";

// Set the tray tooltip and its status menu line. Failures are swallowed: on a
// phone and in a plain browser the command does not exist at all, and a tooltip
// nobody can see is not worth a code path anywhere else.
export async function setTrayStatus(text: string): Promise<void> {
  try {
    await invoke("set_tray_status", { text });
  } catch {
    // No tray here.
  }
}
