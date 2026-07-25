// OpenAI-Images-compatible async relay client (right.codes style), for deck
// illustrations. A generation is submitted async (returns a task id), then
// polled until it completes or fails. The paid API key is a credential
// (credentials.json, not synced); apiBase/model are harmless settings. All the
// request-building and poll-state logic is pure and fetch-injectable so the flow
// runs in bun tests with a scripted fetch — no network, no spend.

export const DEFAULT_IMAGE_API_BASE = "https://www.right.codes";
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";

// Async submit → poll cadence and ceiling. Backoff starts short and settles at
// POLL_MAX_MS; the whole poll gives up after OVERALL_TIMEOUT_MS.
const POLL_START_MS = 2_000;
const POLL_MAX_MS = 5_000;
const OVERALL_TIMEOUT_MS = 180_000;

export interface ImageGenConfig {
  apiBase: string;
  model: string;
  apiKey: string;
}

// Resolve the effective base/model, applying defaults for empty settings.
export function resolveImageGenConfig(opts: {
  apiBase?: string | null;
  model?: string | null;
  apiKey: string;
}): ImageGenConfig {
  return {
    apiBase: (opts.apiBase?.trim() || DEFAULT_IMAGE_API_BASE).replace(/\/+$/, ""),
    model: opts.model?.trim() || DEFAULT_IMAGE_MODEL,
    apiKey: opts.apiKey,
  };
}

export interface GenerateParams {
  prompt: string;
  // Optional reference image (a prior illustration) as a data URL, for style
  // consistency across the deck.
  image?: string;
}

export interface HttpRequest {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
}

// Build the async generation submit request. The relay accepts the
// OpenAI-images shape plus async/size fields; a reference image rides `image` as
// a single-element data-URL array.
export function buildGenerationRequest(config: ImageGenConfig, params: GenerateParams): HttpRequest {
  const body: Record<string, unknown> = {
    model: config.model,
    prompt: params.prompt,
    async: true,
    n: 1,
    size: "16:9",
  };
  if (params.image) body.image = [params.image];
  return {
    url: `${config.apiBase}/draw/v1/images/generations`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}

// Pull the task id from the submit response. The relay returns { task_id } but
// some deployments use { id }; accept either.
export function parseTaskId(json: unknown): string {
  const o = (json ?? {}) as Record<string, unknown>;
  const id = o.task_id ?? o.id;
  if (typeof id === "string" && id) return id;
  if (typeof id === "number") return String(id);
  throw new Error("image relay did not return a task id");
}

export function buildPollRequest(config: ImageGenConfig, taskId: string): HttpRequest {
  return {
    url: `${config.apiBase}/v1/tasks/${encodeURIComponent(taskId)}`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  };
}

// A single image result: a URL to fetch, or inline base64.
export interface TaskImage {
  url?: string;
  b64?: string;
}

export type TaskPhase = "pending" | "completed" | "failed";

export interface TaskState {
  phase: TaskPhase;
  images: TaskImage[];
  error?: string;
}

// Normalize a poll response into a phase + any images. Tolerant of the shapes the
// relay uses: status/state fields, data/images/output arrays, url/image_url or
// b64_json/base64 per item. Anything unrecognized reads as still pending.
export function parseTaskState(json: unknown): TaskState {
  const o = (json ?? {}) as Record<string, any>;
  const raw = String(o.status ?? o.state ?? "").toLowerCase();
  const phase: TaskPhase =
    raw === "completed" || raw === "succeeded" || raw === "success"
      ? "completed"
      : raw === "failed" || raw === "error"
        ? "failed"
        : "pending";

  const items: any[] = Array.isArray(o.data)
    ? o.data
    : Array.isArray(o.images)
      ? o.images
      : Array.isArray(o.output)
        ? o.output
        : Array.isArray(o.result?.images)
          ? o.result.images
          : [];

  const images: TaskImage[] = [];
  for (const it of items) {
    if (typeof it === "string") {
      if (it.startsWith("http")) images.push({ url: it });
      else images.push({ b64: it });
      continue;
    }
    const url = it?.url ?? it?.image_url ?? it?.imageUrl;
    const b64 = it?.b64_json ?? it?.base64 ?? it?.b64;
    if (typeof url === "string") images.push({ url });
    else if (typeof b64 === "string") images.push({ b64 });
  }

  const error =
    phase === "failed"
      ? String(o.error?.message ?? o.error ?? o.message ?? "image generation failed")
      : undefined;
  return { phase, images, error };
}

// Poll delay after `attempt` polls (0-based): 2s for the first couple, then 5s.
export function pollDelayMs(attempt: number): number {
  return Math.min(POLL_MAX_MS, POLL_START_MS + attempt * 1_500);
}

// Injected IO so the whole flow is testable without a real relay.
export interface ImageGenDeps {
  fetch: (req: HttpRequest) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  // Fetch a result URL's bytes (used when the relay returns URLs, not base64).
  fetchBytes: (url: string) => Promise<Uint8Array>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
}

function toDataUrl(image: TaskImage, bytes?: Uint8Array): string {
  if (image.b64) {
    // Some relays return a full data URL in b64; pass it through.
    return image.b64.startsWith("data:") ? image.b64 : `data:image/png;base64,${image.b64}`;
  }
  if (bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    // btoa exists in the webview and in bun's global scope.
    return `data:image/png;base64,${btoa(binary)}`;
  }
  throw new Error("image result had neither a URL nor base64 data");
}

// Submit one generation and poll to completion. Resolves a data URL for the
// image; rejects on task failure, overall timeout, or abort. The abort signal
// interrupts the sleep between polls and is honored before each request.
export async function generateImage(
  config: ImageGenConfig,
  params: GenerateParams,
  deps: ImageGenDeps,
): Promise<string> {
  const throwIfAborted = () => {
    if (deps.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  };

  throwIfAborted();
  const submit = await deps.fetch(buildGenerationRequest(config, params));
  if (!submit.ok) throw new Error(`image relay submit failed (HTTP ${submit.status})`);
  const taskId = parseTaskId(await submit.json());

  const startedAt = deps.now();
  for (let attempt = 0; ; attempt++) {
    throwIfAborted();
    if (deps.now() - startedAt > OVERALL_TIMEOUT_MS) {
      throw new Error("image generation timed out");
    }
    await deps.sleep(pollDelayMs(attempt));
    throwIfAborted();

    const res = await deps.fetch(buildPollRequest(config, taskId));
    if (!res.ok) {
      // A transient poll error is not fatal on its own; keep polling until the
      // overall timeout. A hard 4xx (bad task) will keep failing and time out.
      continue;
    }
    const state = parseTaskState(await res.json());
    if (state.phase === "failed") throw new Error(state.error ?? "image generation failed");
    if (state.phase !== "completed") continue;

    const image = state.images[0];
    if (!image) throw new Error("image generation completed with no image");
    if (image.b64) return toDataUrl(image);
    const bytes = await deps.fetchBytes(image.url!);
    return toDataUrl(image, bytes);
  }
}
