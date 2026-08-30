// The speaking half's vendor key (docs/33, M-voice-2). Same shape as the STT
// key in config.ts: a credential in credentials.json, kept on this device and
// out of the sync range, so every device needs its own.
//
// The native side has two sources, in priority order: this key, and
// MIMO_API_KEY in the process environment. The environment one is what a bench
// launch sets (plugins/voice/src/session.rs), so it stays as the fallback and a
// blank field in Settings does not silence a bench build.
//
// The key is handed over once per change rather than once per sentence: the
// plugin holds one SpeechSession for the process, so carrying the key on
// speak_begin would put it across the IPC boundary once per turn of
// conversation.

import { invoke } from "@tauri-apps/api/core";
import { hasNativeSpeech } from "../../platform/app/platform";
import { loadCredentials, updateCredentials, type ApiKeyCredential } from "../credentials";

// The command, and the argument key it reads. Both are checked by a test rather
// than by a device build: a typo in either is silent, and the symptom is a mute
// app hours later.
export const SPEECH_KEY_COMMAND = "plugin:voice|set_speech_key";

// The one command, as a parameter rather than an import, so the invoke can be
// checked under bun where there is no plugin at all (the same reason
// dictation.ts takes a DictationBridge).
export interface SpeechKeyBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

// The TTS key, or null when unset (the app is then silent).
export async function getTtsKey(): Promise<string | null> {
  const creds = await loadCredentials();
  return creds.voiceTts?.key ?? null;
}

// Set or clear the TTS key (empty string clears it). This writes the file only;
// the native side is told by syncSpeechKey, which the caller runs after.
export async function setTtsKey(key: string): Promise<void> {
  const trimmed = key.trim();
  await updateCredentials((creds) => {
    if (trimmed) creds.voiceTts = { type: "apiKey", key: trimmed } satisfies ApiKeyCredential;
    else delete creds.voiceTts;
  });
}

export async function hasTtsKey(): Promise<boolean> {
  return (await getTtsKey()) !== null;
}

// Hand the plugin the key it should speak with. `null` clears it, after which
// the process environment is used again. The answer is whether the native side
// has a voice afterwards, which is not the same question as whether a key was
// saved: with no key here, an environment key still answers true.
export async function pushSpeechKey(
  key: string | null,
  bridge: SpeechKeyBridge,
): Promise<boolean> {
  return await bridge.invoke<boolean>(SPEECH_KEY_COMMAND, { key });
}

// Read the saved key and hand it over: once at startup, and again after every
// save.
//
// Never rejects. At startup there is nobody to show a failure to, and on a host
// that cannot speak there is nothing to tell — the app is silent either way, and
// the mic path (config.ts) is unaffected. A caller that wants to know reads the
// answer.
//
// No bridge is the caller's way of saying the host decides, the same way
// nativeDictation() decides; a bridge means the caller is the transport and has
// decided already, which is what lets the command string be checked somewhere
// other than a device build.
export async function syncSpeechKey(bridge?: SpeechKeyBridge): Promise<boolean> {
  const transport = bridge ?? (hasNativeSpeech() ? tauriBridge : null);
  if (!transport) return false;
  try {
    return await pushSpeechKey(await getTtsKey(), transport);
  } catch {
    return false;
  }
}

const tauriBridge: SpeechKeyBridge = {
  invoke: (command, args) => invoke(command, args),
};
