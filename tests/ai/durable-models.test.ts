import { describe, expect, test } from "bun:test";
import { createAppModels } from "../../src/ai/durable-models";
import { PROVIDER_IDS, providers } from "../../src/ai/providers";

// Durable turns name their model by this app's provider id (settings.defaultProviderId),
// which is not always pi's: our "openai" is pi's "openai-codex".
describe("createAppModels", () => {
  test("every app provider id resolves its own models", () => {
    const models = createAppModels();
    for (const id of PROVIDER_IDS) {
      const first = providers[id].getModels()[0];
      if (!first) continue;
      expect(models.getModel(id, first.id)?.id).toBe(first.id);
    }
  });

  test("openai resolves a ChatGPT sign-in model", () => {
    const models = createAppModels();
    const id = providers.openai.getModels()[0]!.id;
    expect(models.getModel("openai", id)).toBeDefined();
  });
});
