// What the API-key card offers, in what order, and what it starts on. Separated
// from the card so all of it is testable: the list is read off the provider
// table rather than written out again, and "which one is selected before the
// user touches anything" and "is the folded group open" are rules rather than
// effects.

import { providers, type ApiKeyProviderId, type ProviderInfo } from "../../../ai/providers";

// One chip: a provider and the name it goes by. pi's own names already separate
// the regional variants (Moonshot AI / Moonshot AI CN, the three Xiaomi token
// plans), so none of them is renamed here.
export interface ProviderChip {
  id: ApiKeyProviderId;
  label: string;
}

// What the card can have selected: a key provider, or the custom
// OpenAI-compatible endpoint, which takes a URL and a model as well as a key.
export type KeyCardChoice = ApiKeyProviderId | "custom";

// The providers shown before anything is unfolded, in this order.
const PRIMARY: ApiKeyProviderId[] = ["anthropic-api", "openai-api", "google", "openrouter", "deepseek"];

// The order of everything else: the gateways that reach many models, then the
// providers with their own, then the regional variants of a service already
// above them. Written out rather than taken from the provider table — that
// table's order is a registration order, and the two must be free to differ.
// Every key provider belongs here; the test beside this file is what says so.
const CHIP_ORDER: ApiKeyProviderId[] = [
  "opencode",
  "openrouter",
  "anthropic-api",
  "openai-api",
  "google",
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

const chip = (id: ApiKeyProviderId): ProviderChip => ({ id, label: providers[id].name });

// Every provider that authenticates with a pasted key: the primary ones
// first, then the rest in chip order.
export function keyProviderChips(): ProviderChip[] {
  return [...primaryChips(), ...foldedChips()];
}

export function primaryChips(): ProviderChip[] {
  return PRIMARY.map(chip);
}

// The chips behind "More providers", in chip order. The custom endpoint is the
// card's own entry after these, not a chip of this list.
export function foldedChips(): ProviderChip[] {
  return CHIP_ORDER.filter((id) => !PRIMARY.includes(id)).map(chip);
}

export function isFolded(choice: KeyCardChoice | undefined): boolean {
  return choice !== undefined && !PRIMARY.includes(choice as ApiKeyProviderId);
}

// Whether "More providers" is open: what the user last made it, and until they
// touch it, open exactly when the selected choice is inside it — so whoever
// uses a folded provider sees it selected without having to look for it.
export function moreProvidersOpen(toggled: boolean | undefined, selected: KeyCardChoice | undefined): boolean {
  return toggled ?? isFolded(selected);
}

// The choice the card starts on: the connected provider, when a key (or the
// custom endpoint) is what connected it. Undefined otherwise — including while
// the provider list is still loading and when the connected provider is an
// OAuth one, where preselecting anything would name a provider the user did not
// choose.
export function initialKeyProviderId(infos: ProviderInfo[]): KeyCardChoice | undefined {
  const active = infos.find((p) => p.configured && (p.authKind === "apiKey" || p.authKind === "custom"));
  return active ? (active.id as KeyCardChoice) : undefined;
}
