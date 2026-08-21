// Voice input (docs/15): push-to-talk recording, STT transcription, and an LLM
// cleanup pass. This barrel also wires the production transport (Tauri http for
// STT, streamChat for cleanup); the pure pieces stay in their own modules for
// unit testing.

import { streamChat } from "../providers";
import { cleanTauriFetch } from "../../platform/app/tauri-fetch";
import type { CleanupRunner } from "./cleanup";
import type { SttFetch } from "./stt";

export {
  DEFAULT_STT_BASE,
  DEFAULT_STT_MODEL,
  getSttKey,
  setSttKey,
  hasSttKey,
  loadSttConfig,
  resolveSttConfig,
  type SttConfig,
} from "./config";
export { transcribe } from "./stt";
export { buildGlossary, cleanupTranscript, type CleanupModel, type GlossarySource } from "./cleanup";
export { startRecording, stopRecording, cancelRecording } from "./recorder";
export {
  AUDIO_PROFILE_OPTIONS,
  DEFAULT_AUDIO_PROFILE,
  chooseAudioProfile,
  chosenAudioProfile,
  isAudioProfile,
  type AudioProfile,
} from "./audio-profile";
export {
  EMPTY_TRANSCRIPT,
  applyDictationEvent,
  assembleTranscript,
  hasOnDeviceDictation,
  joinSpeech,
  nativeDictation,
  transcriptText,
  type DictationEvent,
  type DictationOptions,
  type DictationSource,
  type Transcript,
} from "./dictation";
export {
  FINISH_TIMEOUT_MS,
  START_TIMEOUT_HINT,
  START_TIMEOUT_MS,
  INITIAL_HOLD_STATE,
  holdReducer,
  type HoldEffect,
  type HoldEvent,
  type HoldResult,
  type HoldState,
  type HoldStatus,
  type Zone,
} from "./hold-machine";
export {
  INITIAL_PRESS_STATE,
  NEEDS_KEY_HINT,
  NO_SPEECH_HINT,
  beginPress,
  errMsg,
  pressReducer,
  type BeginOutcome,
  type PressEffect,
  type PressEvent,
  type PressResult,
  type PressState,
  type PressStatus,
} from "./press-machine";

// STT transport over the app's Tauri fetch so the request bypasses the webview's
// CORS and CSP (connect-src blocks direct cross-origin fetches; the plugin path
// goes over IPC). Works for any https STT host allowed by the http capability.
export const sttFetch: SttFetch = async (url, init) => {
  const res = await cleanTauriFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  return { ok: res.ok, status: res.status, text: () => res.text() };
};

// Cleanup call over the user's existing chat provider, collected from the stream.
export const chatCleanupRunner: CleanupRunner = (model, systemPrompt, userText, signal) =>
  new Promise<string>((resolve, reject) => {
    void streamChat({
      providerId: model.providerId,
      modelId: model.modelId,
      systemPrompt,
      messages: [{ role: "user", text: userText }],
      signal,
      reasoning: model.reasoning,
      onDelta: () => {},
      onDone: resolve,
      onError: (m) => reject(new Error(m)),
    });
  });
