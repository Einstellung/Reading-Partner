// The context-window floor on selectable models (src/ai/providers.ts
// MIN_CONTEXT_WINDOW) checked against the live pi-ai catalog, plus the two
// boundaries that decide whether the app survives it: a stored default that no
// longer qualifies, and a provider that offers nothing at all. Run: bun test.

import { expect, test } from "bun:test";
import {
	defaultModelFor,
	getModels,
	isSelectableModel,
	MIN_CONTEXT_WINDOW,
	modelSupportsImages,
	nextDefaultsForActive,
	providers,
	type ProviderId,
} from "../../src/ai/providers";
import { enforceModelFloor } from "../../src/ai/model-call";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";

const PROVIDER_IDS = Object.keys(providers) as ProviderId[];

function catalog(id: ProviderId) {
	return providers[id].getModels();
}

function allCatalogModels() {
	return PROVIDER_IDS.flatMap((id) => catalog(id).map((m) => ({ id, model: m })));
}

function settingsFor(providerId: string | null, modelId: string | null): Settings {
	return { ...DEFAULT_SETTINGS, defaultProviderId: providerId, defaultModelId: modelId };
}

test("the floor is a window models in the catalog actually have", () => {
	const windows = new Set(allCatalogModels().map((m) => m.model.contextWindow));
	expect(windows.has(MIN_CONTEXT_WINDOW)).toBe(true);
});

test("the catalog really does contain models under the floor", () => {
	// Otherwise every other test here passes vacuously.
	const below = allCatalogModels().filter((m) => m.model.contextWindow < MIN_CONTEXT_WINDOW);
	expect(below.length).toBeGreaterThan(0);
});

test("nothing under the floor is offered, and nothing over it is withheld", () => {
	for (const id of PROVIDER_IDS) {
		const offered = new Set(getModels(id).map((m) => m.id));
		for (const model of catalog(id)) {
			expect(offered.has(model.id)).toBe(model.contextWindow >= MIN_CONTEXT_WINDOW);
		}
	}
});

test("a model under the floor cannot be selected", () => {
	for (const { id, model } of allCatalogModels()) {
		if (model.contextWindow >= MIN_CONTEXT_WINDOW) continue;
		expect(isSelectableModel(id, model.id)).toBe(false);
	}
});

test("defaultModelFor obeys the floor instead of trusting the catalog's order", () => {
	for (const id of PROVIDER_IDS) {
		const picked = defaultModelFor(id);
		if (picked === null) {
			expect(getModels(id)).toEqual([]);
			continue;
		}
		const model = catalog(id).find((m) => m.id === picked);
		expect(model?.contextWindow).toBeGreaterThanOrEqual(MIN_CONTEXT_WINDOW);
	}
});

test("nextDefaultsForActive drops a kept model that no longer qualifies", () => {
	const stale = catalog("anthropic").find((m) => m.contextWindow < MIN_CONTEXT_WINDOW);
	expect(stale).toBeDefined();
	const next = nextDefaultsForActive("anthropic", stale!.id, "anthropic");
	expect(next.defaultModelId).toBe(defaultModelFor("anthropic"));
	expect(next.defaultModelId).not.toBe(stale!.id);
});

test("the floor governs what can be chosen, not what can be called", () => {
	// A model that is hidden from the picker still resolves through the raw
	// catalog, so settings that already point at one keep working until they are
	// corrected. Without this the correction path would have nothing to correct.
	const stale = catalog("anthropic").find((m) => m.contextWindow < MIN_CONTEXT_WINDOW);
	expect(stale).toBeDefined();
	expect(modelSupportsImages("anthropic", stale!.id)).toBe(true);
});

test("a stored default under the floor is replaced and the user is told", () => {
	const stale = catalog("anthropic").find((m) => m.contextWindow < MIN_CONTEXT_WINDOW);
	expect(stale).toBeDefined();
	const result = enforceModelFloor(settingsFor("anthropic", stale!.id));
	expect(result.settings.defaultModelId).toBe(defaultModelFor("anthropic"));
	expect(result.notice).toContain(stale!.id);
	expect(result.notice).toContain(defaultModelFor("anthropic")!);
	// Nothing else about the settings moves.
	expect<Settings>({ ...result.settings, defaultModelId: null }).toEqual(
		settingsFor("anthropic", null),
	);
});

test("a qualifying default is left exactly as it was", () => {
	const good = defaultModelFor("anthropic")!;
	const before = settingsFor("anthropic", good);
	const result = enforceModelFloor(before);
	expect(result.notice).toBeNull();
	expect(result.settings).toBe(before);
});

test("every provider handles an unusable stored model, whichever branch it lands in", () => {
	for (const id of PROVIDER_IDS) {
		const result = enforceModelFloor(settingsFor(id, "no-such-model"));
		const replacement = defaultModelFor(id);
		expect(result.settings.defaultModelId).toBe(replacement);
		expect(result.notice).toBeTruthy();
		if (replacement) {
			expect(result.notice).toContain(replacement);
		} else {
			// Nothing to fall back to: the model is cleared rather than left
			// pointing at something the app will not run, and the notice names the
			// provider so the dead end is legible.
			expect(result.notice).toContain(providers[id].name);
		}
	}
});

test("settings with nothing configured, or an unknown provider, are passed through", () => {
	for (const before of [
		settingsFor(null, null),
		settingsFor("anthropic", null),
		settingsFor(null, "claude-opus-5"),
		settingsFor("some-provider-we-dropped", "some-model"),
	]) {
		const result = enforceModelFloor(before);
		expect(result.notice).toBeNull();
		expect(result.settings).toBe(before);
	}
});
