// OpenAI-compatible speech-to-text client (docs/15). POSTs the recorded WAV as
// multipart/form-data to {base}/v1/audio/transcriptions and reads back the
// transcript. Request building and response parsing are pure and the transport
// is injected, so the flow runs in bun tests with a scripted fetch — no network.

import type { SttConfig } from "./config";

const AUDIO_FILENAME = "audio.wav";

// URL + auth header for a transcription request. The multipart body (file +
// model) is assembled separately by buildTranscriptionForm so both pieces stay
// unit-testable.
export function buildTranscriptionRequest(config: SttConfig): {
  url: string;
  headers: Record<string, string>;
} {
  return {
    url: `${config.base}/v1/audio/transcriptions`,
    // No Content-Type: the fetch layer sets multipart/form-data with the
    // boundary once the FormData body is attached.
    headers: { Authorization: `Bearer ${config.apiKey}` },
  };
}

export function buildTranscriptionForm(config: SttConfig, wav: Uint8Array): FormData {
  const form = new FormData();
  // Copy into a fresh ArrayBuffer so the Blob owns contiguous bytes regardless
  // of the source view's offset.
  const blob = new Blob([wav.slice()], { type: "audio/wav" });
  form.append("file", blob, AUDIO_FILENAME);
  form.append("model", config.model);
  return form;
}

// Pull the transcript out of a response. OpenAI-compatible endpoints return
// { text }, but some return a bare string or nest it under result/data.
export function parseTranscriptionResponse(body: unknown): string {
  if (typeof body === "string") return body.trim();
  const o = (body ?? {}) as Record<string, unknown>;
  const text = o.text ?? o.transcript ?? (o.result as any)?.text ?? (o.data as any)?.text;
  if (typeof text === "string") return text.trim();
  throw new Error("STT response had no transcript text");
}

export interface SttFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type SttFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal?: AbortSignal },
) => Promise<SttFetchResponse>;

// Transcribe WAV bytes. Throws a clear message on HTTP or parse failure so the
// mic UI can surface it; the caller decides whether to fall back.
export async function transcribe(
  config: SttConfig,
  wav: Uint8Array,
  fetchImpl: SttFetch,
  signal?: AbortSignal,
): Promise<string> {
  const { url, headers } = buildTranscriptionRequest(config);
  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: buildTranscriptionForm(config, wav),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    const detail = raw.slice(0, 300).trim();
    throw new Error(`STT request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  }
  let json: unknown = raw;
  try {
    json = JSON.parse(raw);
  } catch {
    // Leave it as the raw string; parseTranscriptionResponse handles that shape.
  }
  return parseTranscriptionResponse(json);
}
