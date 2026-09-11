// The corner the companion lives in (src/ui/components/info/VoiceOrbEntry.tsx).
// One box, one size, one place, whether or not a call is up: the entry used to
// grow to 160px and re-centre itself when a call opened, which threw a body
// across the screen over the thing being talked about.
//
// Run: bun test.

import { afterEach, expect, test } from "bun:test";

import { useDom } from "../../../support/dom";

const { cleanup, fireEvent, render } = await useDom();
afterEach(cleanup);

const { StubOrbLayer } = await import("../../../../src/ui/components/info/VoiceOrbEntry");

function box(container: HTMLElement): HTMLElement {
	const el = container.querySelector("button");
	expect(el).toBeTruthy();
	return el as HTMLElement;
}

test("the companion is the same box before, during and after a call", () => {
	const { container } = render(<StubOrbLayer />);
	const resting = box(container).className;
	expect(resting).toContain("h-18");
	expect(resting).toContain("w-18");

	// The stub's own start: a tap opens the call.
	fireEvent.click(box(container));
	expect(box(container).className).toBe(resting);

	fireEvent.click(box(container));
	expect(box(container).className).toBe(resting);
});

test("the layer stays in the corner and never takes the screen", () => {
	const { container } = render(<StubOrbLayer />);
	const layer = container.firstElementChild as HTMLElement;
	expect(layer.className).toContain("items-end");
	expect(layer.className).not.toContain("inset-0");
	fireEvent.click(box(container));
	expect((container.firstElementChild as HTMLElement).className).toBe(layer.className);
});
