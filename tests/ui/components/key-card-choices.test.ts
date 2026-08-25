// What the Settings API-key card offers, in what order, and what it starts on
// (src/ui/components/settings/key-card-choices.ts). The card itself only renders
// these answers, so this is where the rules are checked. Run: bun test.

import { expect, test } from "bun:test";
import {
  initialKeyProviderId,
  keyProviderChips,
} from "../../../src/ui/components/settings/key-card-choices";
import { API_KEY_PROVIDER_IDS, AUTH_KIND, PROVIDER_IDS, providers } from "../../../src/ai/providers";
import type { ProviderInfo } from "../../../src/ai/providers";

function info(id: string, over: Partial<ProviderInfo> = {}): ProviderInfo {
  const providerId = id as ProviderInfo["id"];
  return {
    id: providerId,
    name: providers[providerId].name,
    authKind: AUTH_KIND[providerId],
    configured: false,
    ...over,
  };
}

const all = (configured: string | null): ProviderInfo[] =>
  PROVIDER_IDS.map((id) => info(id, { configured: id === configured }));

test("the card offers every key provider, once each, and no OAuth one", () => {
  const ids = keyProviderChips().map((c) => c.id);
  expect([...ids].sort()).toEqual([...API_KEY_PROVIDER_IDS].sort());
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).not.toContain("anthropic");
  expect(ids).not.toContain("openai");
});

test("the chips are ordered by the card's own list, not the provider table's", () => {
  // The broad gateways first, the regional variants last. Written out as names,
  // because that is what a reader of the card sees.
  expect(keyProviderChips().map((c) => c.label)).toEqual([
    "OpenCode Zen",
    "OpenRouter",
    "DeepSeek",
    "Vercel AI Gateway",
    "Moonshot AI",
    "Z.AI",
    "MiniMax",
    "Kimi For Coding",
    "Groq",
    "Together",
    "xAI",
    "Fireworks",
    "NVIDIA",
    "Hugging Face",
    "Cerebras",
    "Ant Ling",
    "Xiaomi",
    "Qwen Token Plan",
    "OpenCode Zen Go",
    "Moonshot AI CN",
    "Z.AI Coding CN",
    "MiniMax CN",
    "Qwen Token Plan CN",
    "Xiaomi Token Plan AMS",
    "Xiaomi Token Plan CN",
    "Xiaomi Token Plan SGP",
  ]);
  // And that order is the card's, not the table's.
  expect(keyProviderChips().map((c) => c.id)).not.toEqual(API_KEY_PROVIDER_IDS);
});

test("each chip is labelled with the provider's own name", () => {
  for (const chip of keyProviderChips()) {
    expect(chip.label).toBe(providers[chip.id].name);
    expect(chip.label).toBeTruthy();
  }
});

test("a provider and its regional variant are told apart by their labels alone", () => {
  const labels = keyProviderChips().map((c) => c.label);
  expect(new Set(labels).size).toBe(labels.length);
});

test("the card starts on the connected provider when a key is what connected it", () => {
  expect(initialKeyProviderId(all("deepseek"))).toBe("deepseek");
  expect(initialKeyProviderId(all("groq"))).toBe("groq");
  expect(initialKeyProviderId(all("xiaomi-token-plan-sgp"))).toBe("xiaomi-token-plan-sgp");
});

test("an OAuth provider being connected preselects nothing", () => {
  expect(initialKeyProviderId(all("anthropic"))).toBeUndefined();
  expect(initialKeyProviderId(all("openai"))).toBeUndefined();
});

test("nothing connected, and the list not loaded yet, preselect nothing", () => {
  expect(initialKeyProviderId(all(null))).toBeUndefined();
  expect(initialKeyProviderId([])).toBeUndefined();
});
