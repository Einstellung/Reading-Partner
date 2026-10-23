// Drawing a picture with the reader's own provider (docs/73 图片).
//
// One request, one image, on the provider this device is set to talk to. Only
// providers with an OpenAI-style `POST /images/generations` are in the table
// (the ChatGPT sign-in's Codex backend among them, unverified);
// on any other provider, or with no provider at all, the answer is
// "unavailable" and the caller keeps whatever it shows without a picture. No
// key of its own: the provider's credential is the one the chat already uses
// (resolveApiKey), and the hosts below are the providers' own baseUrls, which
// the fetch bridge already routes (providers.ts bridgedHosts).
//
// The spend goes into the model-call log like any other call, with zero tokens:
// that log counts tokens and has no field for a per-image price, so an image
// call is told apart by its model id.

import { loadSettings } from "../platform/app/settings";
import { errMsg } from "../platform/std/errors";
import { codexAccountId } from "./auth/openai-oauth";
import { recordModelCall, type ModelCallContext } from "./model-usage";
import { resolveApiKey, type ProviderId } from "./providers";

/** One provider's image endpoint: where it is, which model, and the body it takes. */
export interface ImageEndpoint {
  baseUrl: string;
  model: string;
  body(prompt: string): Record<string, unknown>;
  /** Headers beyond the bearer token, made from the credential. May throw. */
  headers?(key: string): Record<string, string>;
}

// A wide picture, because the card is 16:9; base64 back, because a link would
// point at a CDN the webview's CSP does not allow and that expires anyway.
export const IMAGE_ENDPOINTS: Partial<Record<ProviderId, ImageEndpoint>> = {
  xai: {
    baseUrl: "https://api.x.ai/v1",
    model: "grok-imagine-image-2.0",
    body: (prompt) => ({
      model: "grok-imagine-image-2.0",
      prompt,
      n: 1,
      aspect_ratio: "16:9",
      response_format: "b64_json",
    }),
  },
  together: {
    baseUrl: "https://api.together.ai/v1",
    model: "black-forest-labs/FLUX.1-schnell",
    body: (prompt) => ({
      model: "black-forest-labs/FLUX.1-schnell",
      prompt,
      n: 1,
      width: 1024,
      height: 576,
      steps: 4,
      response_format: "base64",
      output_format: "jpeg",
    }),
  },
  // UNVERIFIED: never called with a live credential. The ChatGPT sign-in's
  // Codex backend, the way OpenAI's own Codex client draws (openai/codex
  // codex-rs/codex-api/src/endpoint/images.rs: POST {CHATGPT_CODEX_BASE_URL}/
  // images/generations, `ChatGPT-Account-ID` beside the token, gpt-image-2).
  // OpenAI's Codex docs say it counts toward the plan's Codex limits and is
  // not on the Free plan. The body carries only the fields that client sends;
  // the answer is PNG. Notes in docs/research/食材与菜品图片源调研.md.
  openai: {
    baseUrl: "https://chatgpt.com/backend-api/codex",
    model: "gpt-image-2",
    body: (prompt) => ({
      prompt,
      model: "gpt-image-2",
      background: "opaque",
      quality: "medium",
      size: "1536x1024",
    }),
    headers: (key) => ({ "ChatGPT-Account-ID": codexAccountId(key), originator: "codex_cli_rs" }),
  },
};

export type GeneratedImage =
  | { ok: true; bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/webp"; provider: string; model: string }
  // `unavailable`: nothing on this device can draw. Otherwise the call was made
  // and failed, which the caller retries later.
  | { ok: false; unavailable: boolean; reason: string };

export interface GenerateImageDeps {
  /** The provider this device talks to. Settings unless injected. */
  providerId?: () => Promise<string | null>;
  apiKey?: (id: ProviderId) => Promise<string>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  record?: typeof recordModelCall;
  timeoutMs?: number;
}

const TIMEOUT_MS = 120_000;

async function configuredProvider(): Promise<string | null> {
  return (await loadSettings()).defaultProviderId ?? null;
}

/** The endpoint this device would draw with, or null when it cannot draw. */
export async function imageEndpoint(
  providerId: () => Promise<string | null> = configuredProvider,
): Promise<{ id: ProviderId; endpoint: ImageEndpoint } | null> {
  const id = (await providerId().catch(() => null)) as ProviderId | null;
  const endpoint = id ? IMAGE_ENDPOINTS[id] : undefined;
  return id && endpoint ? { id, endpoint } : null;
}

/** Whether this device can draw now: a provider in the table, and its credential at hand. */
export async function imageGenerationReady(deps: Pick<GenerateImageDeps, "providerId" | "apiKey"> = {}): Promise<boolean> {
  const found = await imageEndpoint(deps.providerId ?? configuredProvider);
  if (!found) return false;
  try {
    return !!(await (deps.apiKey ?? resolveApiKey)(found.id));
  } catch {
    return false;
  }
}

/** The media type a picture's first bytes say it is, or null. */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** The first image's bytes out of an images response body, or null. */
export function imageBytesOf(body: unknown): Uint8Array | null {
  const data = (body as { data?: unknown } | null)?.data;
  const first = Array.isArray(data) ? (data[0] as { b64_json?: unknown } | undefined) : undefined;
  const b64 = typeof first?.b64_json === "string" ? first.b64_json : "";
  if (!b64) return null;
  try {
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

/** Draw one picture for `prompt`. Never throws. */
export async function generateImage(
  prompt: string,
  spend: ModelCallContext,
  deps: GenerateImageDeps = {},
): Promise<GeneratedImage> {
  const found = await imageEndpoint(deps.providerId ?? configuredProvider);
  if (!found) return { ok: false, unavailable: true, reason: "the configured provider does not draw pictures" };
  const { id, endpoint } = found;
  let key: string;
  let extra: Record<string, string>;
  try {
    key = await (deps.apiKey ?? resolveApiKey)(id);
    extra = endpoint.headers?.(key) ?? {};
  } catch (e) {
    return { ok: false, unavailable: true, reason: errMsg(e) };
  }
  const send = deps.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const record = deps.record ?? recordModelCall;
  const report = (ok: boolean) => record({ ...spend, provider: id, model: endpoint.model, ok });
  try {
    const response = await send(`${endpoint.baseUrl}/images/generations`, {
      method: "POST",
      headers: { ...extra, "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(endpoint.body(prompt)),
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
    });
    if (!response.ok) {
      report(false);
      return { ok: false, unavailable: false, reason: `the image endpoint answered ${response.status}` };
    }
    const bytes = imageBytesOf(await response.json());
    const mediaType = bytes ? sniffImageType(bytes) : null;
    if (!bytes || !mediaType) {
      report(false);
      return { ok: false, unavailable: false, reason: "the image endpoint sent no picture" };
    }
    report(true);
    return { ok: true, bytes, mediaType, provider: id, model: endpoint.model };
  } catch (e) {
    report(false);
    return { ok: false, unavailable: false, reason: errMsg(e) };
  }
}
