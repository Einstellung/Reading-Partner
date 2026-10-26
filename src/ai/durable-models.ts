// The app's providers as a pi-ai `Models` collection for the durable runtime
// (docs/soul/87, "存储与 Harness"): the same provider objects, keys and
// transport the agent loop uses (providers.ts). Auth is resolved per request
// from the app's key store; the transport and pi-ai's own retry count are
// written into every request, and every request's body reports its bytes for
// the request's provider session (provider-bytes.ts), which a turn's stall
// watch counts as the connection being alive.

import { createModels, type MutableModels, type Provider } from "@earendil-works/pi-ai/models";
import type { ProviderId } from ".";
import { tappingBytes } from "./provider-bytes";
import { DEFAULT_MAX_RETRIES, providers, resolveApiKey, transportFor } from "./providers";

function appProvider(id: ProviderId, provider: Provider): Provider {
  const transport = transportFor(id);
  const extra = { maxRetries: DEFAULT_MAX_RETRIES, ...(transport ? { transport } : {}) };
  const stream: Provider["stream"] = (model, context, options) =>
    provider.stream(model, context, tappingBytes({ ...options, ...extra }) as typeof options);
  const streamSimple: Provider["streamSimple"] = (model, context, options) =>
    provider.streamSimple(model, context, tappingBytes({ ...options, ...extra }) as typeof options);
  const auth: Provider["auth"] = {
    apiKey: {
      name: `${provider.name} API key`,
      resolve: async () => ({ auth: { apiKey: await resolveApiKey(id) }, source: "app" }),
    },
  };
  // The provider's own methods stay on the prototype; only auth and the two
  // request paths are this app's.
  return Object.assign(Object.create(provider) as Provider, { auth, stream, streamSimple });
}

// Each provider is registered under pi's id, which is what a model's `provider`
// field names and what stream dispatch looks up. Durable turns name their model
// by this app's id (settings.defaultProviderId), so where the two differ (our
// "openai" is pi's "openai-codex") the same provider is registered under the
// app's id as well; without it every durable turn on OpenAI ends in no_model.
export function createAppModels(): MutableModels {
  const models = createModels();
  for (const id of Object.keys(providers) as ProviderId[]) {
    const provider = appProvider(id, providers[id]);
    models.setProvider(provider);
    if (provider.id !== id) models.setProvider(Object.assign(Object.create(provider) as Provider, { id }));
  }
  return models;
}
