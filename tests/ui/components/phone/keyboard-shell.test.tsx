// The phone shell and the keyboard (src/ui/components/phone/KeyboardShell.tsx,
// docs/pitfall/443). Through raise and dismiss cycles, both keyboard kinds: the
// shell moves to the visible top and never changes size, what it holds is not
// rendered again, and only the chat reading the context hears the keyboard. A
// shell that shrank to the visible part took the EPUB reader under a lesson
// with it, and the second keyboard over that lesson ended in React's
// update-depth error on the iPhone simulator. That loop needs WebKit's layout
// and does not reproduce here; what is pinned is that nothing outside the chat
// is touched by a keyboard any more.
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement, memo } from "react";
import { useDom } from "../../../support/dom";

const { act, cleanup, render } = await useDom();
const { KeyboardShell } = await import("../../../../src/ui/components/phone/KeyboardShell");
const { useShellKeyboard } = await import("../../../../src/ui/components/common/useKeyboardInset");

const PHONE_H = 956;
const vv = Object.assign(new EventTarget(), { width: 440, height: PHONE_H, offsetTop: 0, offsetLeft: 0, scale: 1 });
const saved = {
	vv: Object.getOwnPropertyDescriptor(window, "visualViewport"),
	inner: window.innerHeight,
	offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
};

beforeEach(() => {
	Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
	Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: PHONE_H });
	// No layout here: the shell is as tall as the page, as it is on the phone.
	Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => PHONE_H });
});

afterEach(() => {
	cleanup();
	if (saved.vv) Object.defineProperty(window, "visualViewport", saved.vv);
	else delete (window as { visualViewport?: unknown }).visualViewport;
	Object.defineProperty(window, "innerHeight", { configurable: true, value: saved.inner });
	if (saved.offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
});

// WKWebView on the iPhone: innerHeight and the visual viewport shrink together
// and the document scrolls up by the keyboard's height.
function keyboard(inner: number, height: number, offsetTop: number) {
	act(() => {
		(window as { innerHeight: number }).innerHeight = inner;
		vv.height = height;
		vv.offsetTop = offsetTop;
		vv.dispatchEvent(new Event("resize"));
		vv.dispatchEvent(new Event("scroll"));
	});
}
const software = () => keyboard(543, 543, 413);
const hardware = () => keyboard(888, 888, 68);
const dismiss = () => keyboard(PHONE_H, PHONE_H, 0);

let readerRenders = 0;
const heard: (number | null)[] = [];

// The reader a lesson covers, rendered once by its parent and then left alone.
const Reader = memo(function Reader() {
	readerRenders++;
	return createElement("div", { "data-reader": "" });
});

function Chat() {
	const covered = useShellKeyboard();
	heard.push(covered);
	return createElement("div", { "data-chat": String(covered) });
}

test("the shell moves and keeps its size; only the chat hears the keyboard", () => {
	const { container } = render(
		createElement(KeyboardShell, {
			className: "relative h-full",
			children: [createElement(Reader, { key: "reader" }), createElement(Chat, { key: "chat" })],
		}),
	);
	const clip = container.firstElementChild as HTMLElement;
	const shell = clip.firstElementChild as HTMLElement;
	const chat = () => container.querySelector("[data-chat]")!.getAttribute("data-chat");
	expect(clip.className).toContain("overflow-clip");
	expect(readerRenders).toBe(1);
	expect(chat()).toBe("0");

	for (let cycle = 0; cycle < 3; cycle++) {
		software();
		expect(shell.style.top).toBe("413px");
		expect(shell.style.height).toBe("");
		expect(chat()).toBe("413");

		dismiss();
		expect(shell.style.top).toBe("");
		expect(chat()).toBe("0");

		hardware();
		expect(shell.style.top).toBe("68px");
		expect(shell.style.height).toBe("");
		expect(chat()).toBe("68");

		dismiss();
	}

	expect(readerRenders).toBe(1);
	// One render per change and none for the scroll paired with each resize.
	expect(heard).toEqual([0, ...Array.from({ length: 3 }, () => [413, 0, 68, 0]).flat()]);
});
