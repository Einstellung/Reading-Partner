// Thin wrappers over the Rust recording commands (src-tauri/src/voice.rs).
// Recording runs natively because WebKitGTK's getUserMedia is unreliable on
// Linux (docs/15). stop returns a 16 kHz mono WAV.

import { invoke } from "@tauri-apps/api/core";

export function startRecording(): Promise<void> {
  return invoke<void>("start_voice_recording");
}

// Stop and receive the WAV bytes. Tauri serializes the Rust Vec<u8> as a number
// array; wrap it back into a Uint8Array for the STT request.
export async function stopRecording(): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("stop_voice_recording");
  return new Uint8Array(bytes);
}

export function cancelRecording(): Promise<void> {
  return invoke<void>("cancel_voice_recording");
}
