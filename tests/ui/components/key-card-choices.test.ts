// What the Settings API-key card offers and what it starts on
// (src/ui/components/settings/key-card-choices.ts). The card itself only
// renders these two answers, so this is where the rules are checked.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  initialKeyProviderId,
  keyProviderChoices,
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

test("the card offers every key provider and no OAuth one", () => {
  const choices = keyProviderChoices();
  expect(choices.map((c) => c.value)).toEqual(API_KEY_PROVIDER_IDS);
  expect(choices.map((c) => c.value)).not.toContain("anthropic");
  expect(choices.map((c) => c.value)).not.toContain("openai");
});

test("each choice is labelled with the provider's own name", () => {
  for (const choice of keyProviderChoices()) {
    expect(choice.label).toBe(providers[choice.value as ProviderInfo["id"]].name);
    expect(choice.label).toBeTruthy();
  }
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
