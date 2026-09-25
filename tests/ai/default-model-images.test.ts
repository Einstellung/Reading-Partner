// Whether the default (talk) model takes images (src/ai/providers.ts
// defaultModelTakesImages), against the real catalogue. Run: bun test.

import { expect, test } from "bun:test";
import { defaultModelTakesImages, PROVIDER_IDS, providers, type ProviderId } from "../../src/ai/providers";

function modelWith(image: boolean): { providerId: ProviderId; modelId: string } {
	for (const providerId of PROVIDER_IDS) {
		const model = providers[providerId].getModels().find((m) => m.input.includes("image") === image);
		if (model) return { providerId, modelId: model.id };
	}
	throw new Error(`no model with image=${image} in the catalogue`);
}

test("a vision default model takes images, a text-only one does not", () => {
	const vision = modelWith(true);
	const text = modelWith(false);
	expect(defaultModelTakesImages({ defaultProviderId: vision.providerId, defaultModelId: vision.modelId })).toBe(true);
	expect(defaultModelTakesImages({ defaultProviderId: text.providerId, defaultModelId: text.modelId })).toBe(false);
});

test("no default model set means no images", () => {
	const vision = modelWith(true);
	expect(defaultModelTakesImages({ defaultProviderId: null, defaultModelId: vision.modelId })).toBe(false);
	expect(defaultModelTakesImages({ defaultProviderId: vision.providerId, defaultModelId: null })).toBe(false);
});

test("an unknown model id does not take images", () => {
	expect(defaultModelTakesImages({ defaultProviderId: "anthropic", defaultModelId: "no-such-model" })).toBe(false);
});
