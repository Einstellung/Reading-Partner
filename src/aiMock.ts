// Mock of build-spike's src/ai contract (src/ai/index.ts + providers.ts), so the
// shell can be exercised headlessly without real network/OAuth. Signatures match
// the real module exactly, so aiClient.ts can point at either.

export type ProviderId = "anthropic" | "openai" | "deepseek";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  authKind: "oauth" | "apiKey";
  configured: boolean;
}

export interface ChatMessage {
  role: "user" | "ai";
  text: string;
  images?: { data: string; mediaType: string }[];
}

export interface StreamChatOptions {
  providerId: ProviderId;
  modelId: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta(text: string): void;
  onDone(fullText: string): void;
  onError(message: string): void;
}

const configured: Record<ProviderId, boolean> = { anthropic: false, openai: false, deepseek: false };

const MODELS: Record<ProviderId, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  ],
  openai: [{ id: "gpt-5", label: "GPT-5" }],
  deepseek: [{ id: "deepseek-chat", label: "DeepSeek Chat" }],
};

const NAMES: Record<ProviderId, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

const AUTH_KIND: Record<ProviderId, "oauth" | "apiKey"> = {
  anthropic: "oauth",
  openai: "apiKey",
  deepseek: "apiKey",
};

export function installFetchBridge(): void {
  // Real impl swaps window.fetch for the Tauri http bridge (docs/05). No-op here.
}

export async function listProviders(): Promise<ProviderInfo[]> {
  await delay(20);
  return (Object.keys(NAMES) as ProviderId[]).map((id) => ({
    id,
    name: NAMES[id],
    authKind: AUTH_KIND[id],
    configured: configured[id],
  }));
}

export async function setApiKey(id: "openai" | "deepseek", key: string): Promise<void> {
  await delay(40);
  configured[id] = key.trim().length > 0;
}

export function getModels(id: ProviderId): { id: string; label: string }[] {
  return MODELS[id] ?? [];
}

// Mirrors the real contract: anthropic/openai are vision, deepseek is text-only.
export function modelSupportsImages(id: ProviderId, _modelId: string): boolean {
  void _modelId;
  return id !== "deepseek";
}

export async function anthropicLogin(): Promise<void> {
  await delay(400); // simulate the loopback browser round-trip
  configured.anthropic = true;
}

export async function anthropicLoginWithManualCode(code: string): Promise<void> {
  await delay(120);
  if (!code.trim()) throw new Error("Empty authorization code");
  configured.anthropic = true;
}

export async function anthropicLogout(): Promise<void> {
  await delay(40);
  configured.anthropic = false;
}

export async function getValidAnthropicAuth(): Promise<string | null> {
  return configured.anthropic ? "mock-token" : null;
}

// Streams a deterministic reply chunk-by-chunk, honoring the abort signal.
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { providerId, modelId, messages, signal, onDelta, onDone, onError } = options;
  if (messages.some((m) => m.images?.length) && !modelSupportsImages(providerId, modelId)) {
    onError(`${modelId} can't read images. Switch to a vision-capable model to send pictures.`);
    return;
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const reply =
    `Here is a mock explanation. You asked: "${(lastUser?.text ?? "").slice(0, 40)}". ` +
    "The passage introduces the idea and why it matters, in brief.";
  const chunks = reply.match(/\S+\s*/g) ?? [reply];

  let acc = "";
  for (const chunk of chunks) {
    if (signal?.aborted) {
      onError("aborted");
      return;
    }
    await delay(40);
    acc += chunk;
    onDelta(chunk);
  }
  onDone(acc);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
