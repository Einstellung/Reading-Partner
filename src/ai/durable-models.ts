// The app's providers as a pi-ai `Models` collection for the durable runtime
// (docs/soul/87, "存储与 Harness"): the same provider objects, keys and
// transport the agent loop uses (providers.ts). Auth is resolved per request
// from the app's key store; the transport and pi-ai's own retry count are
// written into every request the way runAgentTurn writes them.

import { createModels, type MutableModels, type Provider } from "@earendil-works/pi-ai/models";
import type { ProviderId } from ".";
import { DEFAULT_MAX_RETRIES, providers, resolveApiKey, transportFor } from "./providers";

function appProvider(id: ProviderId, provider: Provider): Provider {
  const transport = transportFor(id);
  const extra = { maxRetries: DEFAULT_MAX_RETRIES, ...(transport ? { transport } : {}) };
  const stream: Provider["stream"] = (model, context, options) =>
    provider.stream(model, context, { ...options, ...extra } as typeof options);
  const streamSimple: Provider["streamSimple"] = (model, context, options) =>
    provider.streamSimple(model, context, { ...options, ...extra } as typeof options);
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

export function createAppModels(): MutableModels {
  const models = createModels();
  for (const id of Object.keys(providers) as ProviderId[]) models.setProvider(appProvider(id, providers[id]));
  return models;
}
