// The phone shell and the keyboard (src/ui/components/common/KeyboardShell.tsx,
// docs/pitfall/443). Through raise and dismiss cycles, both keyboard kinds: the
// shell moves to the visible top and never changes size, what it holds is not
// rendered again, and only the chat reading the context hears the keyboard. A
// shell that shrank to the visible part took the EPUB reader under a lesson
// with it, and the second keyboard over that lesson ended in React's
// update-depth error on the iPhone simulator. That loop needs WebKit's layout
// and does not reproduce here; what is pinned is that nothing outside the chat
// is touched by a keyboard any more. The iPad's shell is the same one: before
// an app switch its keyboard scrolls the document as the iPhone's does, after
// one it shrinks only the visual viewport (docs/pitfall/392), and a desktop has
// no keyboard at all.
//
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement, memo } from "react";
import { useDom } from "../../../support/dom";

const { act, cleanup, render } = await useDom();
const { KeyboardShell } = await import("../../../../src/ui/components/common/KeyboardShell");
const { useShellKeyboard } = await import("../../../../src/ui/components/common/useKeyboardInset");

const PHONE_H = 956;
// How tall the shell is laid out, whatever the keyboard does.
let shellHeight = PHONE_H;
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
	Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => shellHeight });
});

afterEach(() => {
	cleanup();
	shellHeight = PHONE_H;
	(window as { innerHeight: number }).innerHeight = PHONE_H;
	vv.height = PHONE_H;
	vv.offsetTop = 0;
	readerRenders = 0;
	heard.length = 0;
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
const heard: (number | undefined)[] = [];

// The reader a lesson covers, rendered once by its parent and then left alone.
const Reader = memo(function Reader() {
	readerRenders++;
	return createElement("div", { "data-reader": "" });
});

function Chat() {
	const keyboard = useShellKeyboard();
	heard.push(keyboard?.covered);
	return createElement("div", { "data-chat": String(keyboard?.covered), "data-cramped": String(keyboard?.cramped) });
}

function drawShell() {
	const { container } = render(
		createElement(KeyboardShell, {
			className: "relative h-full",
			children: [createElement(Reader, { key: "reader" }), createElement(Chat, { key: "chat" })],
		}),
	);
	const shell = container.firstElementChild!.firstElementChild as HTMLElement;
	const chat = () => container.querySelector("[data-chat]")!.getAttribute("data-chat");
	const cramped = () => container.querySelector("[data-chat]")!.getAttribute("data-cramped");
	return { shell, chat, cramped };
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

test("a phone on its side: the shell moves as in portrait and says the chat is cramped", () => {
	shellHeight = 440;
	keyboard(440, 440, 0);
	const { shell, chat, cramped } = drawShell();
	expect(cramped()).toBe("false");

	keyboard(168, 168, 272);
	expect(shell.style.top).toBe("272px");
	expect(shell.style.height).toBe("");
	expect(chat()).toBe("272");
	expect(cramped()).toBe("true");

	// The hardware keyboard's accessory bar leaves room for the bar.
	keyboard(372, 372, 68);
	expect(chat()).toBe("68");
	expect(cramped()).toBe("false");

	keyboard(440, 440, 0);
	expect(shell.style.top).toBe("");
	expect(cramped()).toBe("false");
	expect(readerRenders).toBe(1);
});

test("the iPad before an app switch: the document scrolls and the shell moves back into view", () => {
	shellHeight = 1194;
	keyboard(1194, 1194, 0);
	const { shell, chat } = drawShell();

	keyboard(854, 854, 340);
	expect(shell.style.top).toBe("340px");
	expect(shell.style.height).toBe("");
	expect(chat()).toBe("340");

	keyboard(1194, 1194, 0);
	expect(shell.style.top).toBe("");
	expect(chat()).toBe("0");
	expect(readerRenders).toBe(1);
});

test("the iPad after an app switch: the shell stays put and the chat hears what is covered", () => {
	shellHeight = 1366;
	keyboard(1366, 1366, 0);
	const { shell, chat, cramped } = drawShell();

	keyboard(1366, 963, 0);
	expect(shell.style.top).toBe("0px");
	expect(chat()).toBe("403");
	expect(cramped()).toBe("false");
	expect(readerRenders).toBe(1);
});

test("a desktop window: nothing moves and nothing is covered", () => {
	shellHeight = 900;
	keyboard(900, 900, 0);
	const { shell, chat } = drawShell();
	// Resizing the window changes both heights together.
	keyboard(700, 700, 0);
	shellHeight = 700;
	keyboard(700, 700, 0);
	expect(shell.style.top).toBe("");
	expect(chat()).toBe("0");
	expect(heard.every((c) => c === 0)).toBe(true);
});
