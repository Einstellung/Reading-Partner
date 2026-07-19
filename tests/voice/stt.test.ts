// Unit tests for the STT client (src/voice/stt.ts): request URL/headers, the
// multipart body, response parsing across the shapes providers use, and the
// transcribe flow over an injected fetch. No network. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildTranscriptionForm,
  buildTranscriptionRequest,
  parseTranscriptionResponse,
  transcribe,
  type SttFetch,
} from "../../src/voice/stt";
import type { SttConfig } from "../../src/voice/config";

const config: SttConfig = {
  base: "https://api.siliconflow.cn",
  model: "FunAudioLLM/SenseVoiceSmall",
  apiKey: "sk-test",
};

test("buildTranscriptionRequest targets the audio/transcriptions endpoint with a Bearer key", () => {
  const { url, headers } = buildTranscriptionRequest(config);
  expect(url).toBe("https://api.siliconflow.cn/v1/audio/transcriptions");
  expect(headers.Authorization).toBe("Bearer sk-test");
  // The multipart Content-Type is set by the fetch layer, not here.
  expect(headers["Content-Type"]).toBeUndefined();
});

test("buildTranscriptionForm carries the wav file and the model field", () => {
  const form = buildTranscriptionForm(config, new Uint8Array([1, 2, 3, 4]));
  expect(form.get("model")).toBe("FunAudioLLM/SenseVoiceSmall");
  const file = form.get("file");
  expect(file).toBeInstanceOf(Blob);
  expect((file as File).name).toBe("audio.wav");
});

test("parseTranscriptionResponse accepts { text }, a bare string, and nested shapes", () => {
  expect(parseTranscriptionResponse({ text: "  hello  " })).toBe("hello");
  expect(parseTranscriptionResponse("plain transcript")).toBe("plain transcript");
  expect(parseTranscriptionResponse({ result: { text: "nested" } })).toBe("nested");
  expect(() => parseTranscriptionResponse({ nope: 1 })).toThrow();
});

test("transcribe posts multipart and returns the parsed transcript", async () => {
  let seen: { url: string; method: string; auth?: string; hasFile: boolean } | null = null;
  const fetchImpl: SttFetch = async (url, init) => {
    seen = {
      url,
      method: init.method,
      auth: init.headers.Authorization,
      hasFile: init.body.get("file") instanceof Blob,
    };
    return { ok: true, status: 200, text: async () => JSON.stringify({ text: "你好世界" }) };
  };
  const out = await transcribe(config, new Uint8Array([0, 1]), fetchImpl);
  expect(out).toBe("你好世界");
  expect(seen).toEqual({
    url: "https://api.siliconflow.cn/v1/audio/transcriptions",
    method: "POST",
    auth: "Bearer sk-test",
    hasFile: true,
  });
});

test("transcribe tolerates a plain-string response body", async () => {
  const fetchImpl: SttFetch = async () => ({ ok: true, status: 200, text: async () => "just words" });
  expect(await transcribe(config, new Uint8Array([0]), fetchImpl)).toBe("just words");
});

test("transcribe throws a clear error on an HTTP failure", async () => {
  const fetchImpl: SttFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => "invalid api key",
  });
  const err = await transcribe(config, new Uint8Array([0]), fetchImpl).then(
    () => null,
    (e) => e as Error,
  );
  expect(err?.message).toContain("HTTP 401");
  expect(err?.message).toContain("invalid api key");
});
