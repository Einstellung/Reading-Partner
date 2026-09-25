// The provider registration both harness.ts and held.ts feed pi-ai's
// createProvider: an id and name from the model's own provider field, and a
// no-op api-key auth — the real credential is already closed over by
// streamFn, which is where this app keeps that decision (src/ai/providers.ts).
// What differs per call site is which models the provider is told it can run:
// harness.ts registers one model at a time, held.ts accumulates every model an
// agent's turns have asked for.

import type { Api, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "./contract";

export function providerConfigFor(model: Model<Api>, models: Model<Api>[], streamFn: StreamFn) {
  return {
    id: model.provider,
    name: model.provider,
    auth: { apiKey: { name: model.provider, resolve: async () => ({ auth: {} }) } },
    models,
    api: { stream: streamFn, streamSimple: streamFn },
  };
}
