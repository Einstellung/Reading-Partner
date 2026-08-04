// The context window as the picker writes it (src/ai/model-label.ts). Run: bun test.

import { expect, test } from "bun:test";
import { formatContextWindow, modelChoiceLabel } from "../../src/ai/model-label";
import { getModels, providers, type ProviderId } from "../../src/ai/providers";

test("windows read the way people quote them", () => {
	expect(formatContextWindow(128_000)).toBe("128k");
	expect(formatContextWindow(200_000)).toBe("200k");
	expect(formatContextWindow(272_000)).toBe("272k");
	expect(formatContextWindow(1_000_000)).toBe("1M");
	expect(formatContextWindow(1_500_000)).toBe("1.5M");
	expect(formatContextWindow(2_000_000)).toBe("2M");
});

test("a window just under a million is not written as 1000k", () => {
	expect(formatContextWindow(999_999)).toBe("1M");
	expect(formatContextWindow(1_048_576)).toBe("1M");
});

test("a model with no declared window has no number to show", () => {
	expect(formatContextWindow(0)).toBeNull();
	expect(formatContextWindow(-1)).toBeNull();
	expect(formatContextWindow(Number.NaN)).toBeNull();
});

test("the label carries the name and the window, and only the name without one", () => {
	expect(modelChoiceLabel({ label: "Claude Opus 5", contextWindow: 200_000 })).toBe(
		"Claude Opus 5 · 200k",
	);
	expect(modelChoiceLabel({ label: "Some Model", contextWindow: 0 })).toBe("Some Model");
});

test("every model in the live catalog gets a window in its label", () => {
	for (const id of Object.keys(providers) as ProviderId[]) {
		for (const model of getModels(id)) {
			expect(modelChoiceLabel(model)).toMatch(/ · \d+(\.\d)?[kM]$/);
		}
	}
});
