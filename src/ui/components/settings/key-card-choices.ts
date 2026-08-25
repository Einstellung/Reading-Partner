// What the API-key card offers and what it starts on. Separated from the card
// so both are testable: the list is read off the provider table rather than
// written out again, and "which one is selected before the user touches
// anything" is a rule rather than an effect.

import {
  API_KEY_PROVIDER_IDS,
  providers,
  type ApiKeyProviderId,
  type ProviderInfo,
} from "../../../ai/providers";
import type { Choice } from "./ChoiceField";

// Every provider that authenticates with a pasted key, in provider-table order,
// labelled with the name the provider gives itself.
export function keyProviderChoices(): Choice[] {
  return API_KEY_PROVIDER_IDS.map((id) => ({ value: id, label: providers[id].name }));
}

// The provider the card starts on: the connected one, when a key is what
// connected it. Undefined otherwise — including while the provider list is still
// loading and when the connected provider is an OAuth one, where preselecting
// anything would name a provider the user did not choose.
export function initialKeyProviderId(infos: ProviderInfo[]): ApiKeyProviderId | undefined {
  const active = infos.find((p) => p.configured && p.authKind === "apiKey");
  return active ? (active.id as ApiKeyProviderId) : undefined;
}
