// The rack under a lesson through a rotation with the keyboard up
// (docs/pitfall/457). WebKit fires the visual viewport's `scroll`, which React
// schedules below the sync lane, and the window's `resize`, which it renders
// synchronously; when the second arrives before the first has rendered, every
// sync render replays the second update from the state before the first. An
// updater that read the viewport itself answered each replay with a new
// object, the rack's placement effect re-ran on it and set state, and the
// nested sync renders ran into React's update-depth error with the app white
// (iPhone 17 Pro Max simulator, rotating the EPUB lesson to landscape).
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { useDom } from "../../../support/dom";

const { act } = await useDom();
// After the window: react-dom decides once whether it is in a browser
// (tests/support/dom.ts).
const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");
const { default: PenToolbar } = await import("../../../../src/ui/components/reader/PenToolbar");

const vv = Object.assign(new EventTarget(), { width: 440, height: 956, offsetTop: 0, offsetLeft: 0, scale: 1 });
const saved = Object.getOwnPropertyDescriptor(window, "visualViewport");
const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actWas = flags.IS_REACT_ACT_ENVIRONMENT;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
	Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() =>
		root.render(
			createElement(PenToolbar, {
				orientation: "horizontal",
				tool: { type: "none", color: "#ffd400" },
				colors: [{ name: "Yellow", color: "#ffd400" }],
				onToolChange: () => {},
			}),
		),
	);
	// The events below have to reach React the way WebKit's do, lane by lane,
	// not batched into one act().
	flags.IS_REACT_ACT_ENVIRONMENT = false;
});

afterEach(() => {
	flags.IS_REACT_ACT_ENVIRONMENT = actWas;
	act(() => root.unmount());
	container.remove();
	Object.assign(vv, { width: 440, height: 956 });
	if (saved) Object.defineProperty(window, "visualViewport", saved);
	else delete (window as { visualViewport?: unknown }).visualViewport;
});

test("a sync viewport update over a pending scroll one renders once, not until React gives up", () => {
	// The portrait keyboard's scroll: rendered later, off the sync lane.
	vv.height = 543;
	vv.dispatchEvent(new Event("scroll"));
	// The rotation's resize, before that render happened.
	Object.assign(vv, { width: 956, height: 440 });
	expect(() => flushSync(() => vv.dispatchEvent(new Event("resize")))).not.toThrow();
	expect(container.querySelector('[aria-label="Highlight"]')).not.toBeNull();
});

test("two keyboard frames alternating fast leave the rack on screen", () => {
	for (let i = 0; i < 20; i++) {
		Object.assign(vv, i % 2 ? { width: 440, height: 543 } : { width: 956, height: 168 });
		vv.dispatchEvent(new Event("scroll"));
		Object.assign(vv, i % 2 ? { width: 956, height: 440 } : { width: 440, height: 956 });
		expect(() => flushSync(() => vv.dispatchEvent(new Event("resize")))).not.toThrow();
	}
	expect(container.querySelector('[aria-label="Highlight"]')).not.toBeNull();
});
