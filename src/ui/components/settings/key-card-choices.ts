// What the API-key card offers, in what order, and what it starts on. Separated
// from the card so all three are testable: the list is read off the provider
// table rather than written out again, and "which one is selected before the
// user touches anything" is a rule rather than an effect.

import { providers, type ApiKeyProviderId, type ProviderInfo } from "../../../ai/providers";

// One chip: a provider and the name it goes by. pi's own names already separate
// the regional variants (Moonshot AI / Moonshot AI CN, the three Xiaomi token
// plans), so none of them is renamed here.
export interface ProviderChip {
  id: ApiKeyProviderId;
  label: string;
}

// The order the chips are shown in: the gateways that reach many models, then
// the providers with their own, then the regional variants of a service already
// above them. Written out rather than taken from the provider table — that
// table's order is a registration order, and the two must be free to differ.
// Every key provider belongs here; the test beside this file is what says so.
const CHIP_ORDER: ApiKeyProviderId[] = [
  "opencode",
  "openrouter",
  "deepseek",
  "vercel-ai-gateway",
  "moonshotai",
  "zai",
  "minimax",
  "kimi-coding",
  "groq",
  "together",
  "xai",
  "fireworks",
  "nvidia",
  "huggingface",
  "cerebras",
  "ant-ling",
  "xiaomi",
  "qwen-token-plan",
  "opencode-go",
  "moonshotai-cn",
  "zai-coding-cn",
  "minimax-cn",
  "qwen-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp",
];

// Every provider that authenticates with a pasted key, in chip order.
export function keyProviderChips(): ProviderChip[] {
  return CHIP_ORDER.map((id) => ({ id, label: providers[id].name }));
}

// The provider the card starts on: the connected one, when a key is what
// connected it. Undefined otherwise — including while the provider list is still
// loading and when the connected provider is an OAuth one, where preselecting
// anything would name a provider the user did not choose.
export function initialKeyProviderId(infos: ProviderInfo[]): ApiKeyProviderId | undefined {
  const active = infos.find((p) => p.configured && p.authKind === "apiKey");
  return active ? (active.id as ApiKeyProviderId) : undefined;
}
