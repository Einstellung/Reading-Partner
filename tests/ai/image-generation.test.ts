// Drawing a picture on the reader's own provider (src/ai/image-generation.ts).
// No real call: the fetch is injected.
// Run: scripts/t.sh tests/ai/image-generation.test.ts

import { expect, test } from "bun:test";
import {
  generateImage,
  IMAGE_ENDPOINTS,
  imageBytesOf,
  imageGenerationReady,
  sniffImageType,
} from "../../src/ai/image-generation";
import type { ModelCallReport } from "../../src/ai/model-usage";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const JPEG_B64 = btoa(String.fromCharCode(...JPEG));

function deps(provider: string | null, answer: () => Response | Promise<Response>) {
  const sent: { url: string; init: RequestInit }[] = [];
  const recorded: ModelCallReport[] = [];
  return {
    sent,
    recorded,
    deps: {
      providerId: async () => provider,
      apiKey: async () => "sk-test",
      fetch: async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return answer();
      },
      record: (r: ModelCallReport) => {
        recorded.push(r);
      },
    },
  };
}

test("a provider with no images endpoint is unavailable, and nothing is sent", async () => {
  const h = deps("deepseek", () => new Response("{}"));
  const result = await generateImage("a bowl", { caller: "info" }, h.deps);
  expect(result).toMatchObject({ ok: false, unavailable: true });
  expect(h.sent).toEqual([]);
  expect(h.recorded).toEqual([]);
  expect(await imageGenerationReady({ providerId: async () => null })).toBe(false);
  expect(await imageGenerationReady({ providerId: async () => "openai" })).toBe(false);
});

test("a missing credential is unavailable too", async () => {
  const result = await generateImage("a bowl", { caller: "info" }, {
    providerId: async () => "xai",
    apiKey: async () => {
      throw new Error("not connected");
    },
  });
  expect(result).toMatchObject({ ok: false, unavailable: true });
  expect(
    await imageGenerationReady({
      providerId: async () => "xai",
      apiKey: async () => {
        throw new Error("no");
      },
    }),
  ).toBe(false);
});

test("xAI is asked for one wide picture in base64, and the call is logged as info's", async () => {
  const h = deps("xai", () => Response.json({ data: [{ b64_json: JPEG_B64 }] }));
  const result = await generateImage("a bowl", { caller: "info" }, h.deps);
  expect(result).toEqual({ ok: true, bytes: JPEG, mediaType: "image/jpeg", provider: "xai", model: IMAGE_ENDPOINTS.xai!.model });
  expect(h.sent[0]?.url).toBe("https://api.x.ai/v1/images/generations");
  const body = JSON.parse(String(h.sent[0]?.init.body));
  expect(body).toMatchObject({ prompt: "a bowl", n: 1, response_format: "b64_json" });
  expect((h.sent[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  expect(h.recorded).toEqual([{ caller: "info", provider: "xai", model: IMAGE_ENDPOINTS.xai!.model, ok: true }]);
});

test("Together is asked in its own words for the same thing", async () => {
  const h = deps("together", () => Response.json({ data: [{ b64_json: JPEG_B64, type: "b64_json" }] }));
  const result = await generateImage("a bowl", { caller: "info" }, h.deps);
  expect(result.ok).toBe(true);
  expect(h.sent[0]?.url).toBe("https://api.together.ai/v1/images/generations");
  expect(JSON.parse(String(h.sent[0]?.init.body))).toMatchObject({ response_format: "base64", width: 1024, height: 576 });
});

test("a refused or empty answer is a failure to retry, not unavailable", async () => {
  const refused = deps("xai", () => new Response("quota", { status: 429 }));
  expect(await generateImage("a bowl", { caller: "info" }, refused.deps)).toMatchObject({
    ok: false,
    unavailable: false,
  });
  expect(refused.recorded[0]?.ok).toBe(false);

  const empty = deps("xai", () => Response.json({ data: [] }));
  expect(await generateImage("a bowl", { caller: "info" }, empty.deps)).toMatchObject({ ok: false, unavailable: false });

  const offline = deps("xai", () => {
    throw new TypeError("network down");
  });
  expect(await generateImage("a bowl", { caller: "info" }, offline.deps)).toMatchObject({
    ok: false,
    unavailable: false,
  });
});

test("the bytes are read out of the response and their type from their first bytes", () => {
  expect(imageBytesOf({ data: [{ b64_json: JPEG_B64 }] })).toEqual(JPEG);
  expect(imageBytesOf({ data: [{ url: "https://x" }] })).toBeNull();
  expect(imageBytesOf(null)).toBeNull();
  expect(sniffImageType(JPEG)).toBe("image/jpeg");
  expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
  expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
});
