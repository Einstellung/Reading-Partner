// Thin wrappers over the Rust recording commands (src-tauri/src/voice.rs).
// Recording runs natively because WebKitGTK's getUserMedia is unreliable on
// Linux (docs/15). stop returns a 16 kHz mono WAV.

import { invoke } from "@tauri-apps/api/core";

// Tauri serializes a Rust Vec<u8> as a number array; wrap it back into a
// Uint8Array for the STT request.
async function wav(command: string, args?: Record<string, unknown>): Promise<Uint8Array> {
  const bytes = await invoke<number[]>(command, args);
  return new Uint8Array(bytes);
}

// Push to talk: one press is one recording, capped at 90 seconds in Rust.

export function startRecording(): Promise<void> {
  return invoke<void>("start_voice_recording");
}

export function stopRecording(): Promise<Uint8Array> {
  return wav("stop_voice_recording");
}

export function cancelRecording(): Promise<void> {
  return invoke<void>("cancel_voice_recording");
}

// A recording session: one continuously running capture, cut into segments
// without a gap (rehearsal, docs/43). The mic stream stays open across a cut, so
// no audio is lost at the seam and the session never stops itself.

// `maxSegmentSeconds` is a fallback cut for a segment nobody ends — it keeps the
// raw buffer bounded, it does not end the session. Default 60, clamped to
// 1..=120 in Rust.
export function startSession(opts?: { maxSegmentSeconds?: number }): Promise<void> {
  return invoke<void>("start_voice_session", { maxSegmentSeconds: opts?.maxSegmentSeconds });
}

// Everything captured since the previous cut (or since the start), as one WAV.
// Capture continues. A segment with no audio in it comes back as a valid but
// empty WAV (a 44-byte header), not an error.
export function cutSession(): Promise<Uint8Array> {
  return wav("cut_voice_session");
}

// The last segment, and the stream closes.
export function stopSession(): Promise<Uint8Array> {
  return wav("stop_voice_session");
}

export function cancelSession(): Promise<void> {
  return invoke<void>("cancel_voice_session");
}
