// Voice input (docs/15): push-to-talk recording, STT transcription, and an LLM
// cleanup pass. This barrel also wires the production transport (Tauri http for
// STT, streamChat for cleanup); the pure pieces stay in their own modules for
// unit testing.

import { streamChat } from "../ai/providers";
import { cleanTauriFetch } from "../app/tauri-fetch";
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
