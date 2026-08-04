// What the model picker offers (src/ai/providers.ts) checked against the live
// pi-ai catalog: every model is offered, whatever its context window, and the
// default lands on the widest one rather than wherever the catalog happens to
// start. Plus the boundary that decides whether the app survives its own
// settings file: a stored default the catalog no longer carries. Run: bun test.

import { expect, test } from "bun:test";
import {
	defaultModelFor,
	getModels,
	isSelectableModel,
	nextDefaultsForActive,
	providers,
	type ProviderId,
} from "../../src/ai/providers";
import { enforceKnownModel } from "../../src/ai/model-call";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";

const PROVIDER_IDS = Object.keys(providers) as ProviderId[];

// An id no provider will ever carry, standing in for a settings file written by
// an older build against a model that has since been retired.
const RETIRED = "claude-from-a-previous-build";

function catalog(id: ProviderId) {
	return providers[id].getModels();
}

function allCatalogModels() {
	return PROVIDER_IDS.flatMap((id) => catalog(id).map((m) => ({ id, model: m })));
}

function settingsFor(providerId: string | null, modelId: string | null): Settings {
	return { ...DEFAULT_SETTINGS, defaultProviderId: providerId, defaultModelId: modelId };
}

test("the catalog spans several context windows, so the rest of this file is not vacuous", () => {
	const windows = new Set(allCatalogModels().map((m) => m.model.contextWindow));
	expect(windows.size).toBeGreaterThan(1);
	expect(Math.min(...windows)).toBeLessThan(1_000_000);
});

test("every model in the catalog is offered, whatever its window", () => {
	for (const id of PROVIDER_IDS) {
		const offered = getModels(id).map((m) => m.id);
		expect(offered).toEqual(catalog(id).map((m) => m.id));
	}
});

test("every model in the catalog can be selected, whatever its window", () => {
	for (const { id, model } of allCatalogModels()) {
		expect(isSelectableModel(id, model.id)).toBe(true);
	}
	expect(isSelectableModel("anthropic", RETIRED)).toBe(false);
	expect(isSelectableModel("anthropic", null)).toBe(false);
});

test("each offered model carries its own context window, for the picker to show", () => {
	for (const id of PROVIDER_IDS) {
		for (const offered of getModels(id)) {
			const model = catalog(id).find((m) => m.id === offered.id)!;
			expect(offered.contextWindow).toBe(model.contextWindow);
			expect(offered.label).toBe(model.name || model.id);
		}
	}
});

test("the default is the widest window the provider offers, not the first listed", () => {
	for (const id of PROVIDER_IDS) {
		const picked = defaultModelFor(id);
		if (picked === null) {
			expect(getModels(id)).toEqual([]);
			continue;
		}
		const model = catalog(id).find((m) => m.id === picked)!;
		const widest = Math.max(...catalog(id).map((m) => m.contextWindow));
		expect(model.contextWindow).toBe(widest);
	}
});

test("nextDefaultsForActive keeps a model the provider still carries", () => {
	// A small window is a choice the user is allowed to have made, so re-signing
	// in to the same provider must not quietly upgrade it.
	const kept = catalog("anthropic").find((m) => m.contextWindow < 1_000_000);
	expect(kept).toBeDefined();
	const next = nextDefaultsForActive("anthropic", kept!.id, "anthropic");
	expect(next).toEqual({ defaultProviderId: "anthropic", defaultModelId: kept!.id });
});

test("nextDefaultsForActive drops a kept model the provider no longer carries", () => {
	const next = nextDefaultsForActive("anthropic", RETIRED, "anthropic");
	expect(next.defaultModelId).toBe(defaultModelFor("anthropic"));
});

test("a stored default the catalog doesn't know is replaced and the user is told", () => {
	const result = enforceKnownModel(settingsFor("anthropic", RETIRED));
	expect(result.settings.defaultModelId).toBe(defaultModelFor("anthropic"));
	expect(result.notice).toContain(RETIRED);
	expect(result.notice).toContain(defaultModelFor("anthropic")!);
	// Nothing else about the settings moves.
	expect<Settings>({ ...result.settings, defaultModelId: null }).toEqual(
		settingsFor("anthropic", null),
	);
});

test("a stored default the catalog still carries is left exactly as it was", () => {
	for (const { id, model } of allCatalogModels()) {
		const before = settingsFor(id, model.id);
		const result = enforceKnownModel(before);
		expect(result.notice).toBeNull();
		expect(result.settings).toBe(before);
	}
});

test("every provider handles an unusable stored model, whichever branch it lands in", () => {
	for (const id of PROVIDER_IDS) {
		const result = enforceKnownModel(settingsFor(id, "no-such-model"));
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
		const result = enforceKnownModel(before);
		expect(result.notice).toBeNull();
		expect(result.settings).toBe(before);
	}
});
