// The chat list's pin-to-bottom (src/ui/components/common/stick-to-bottom.ts).
//
// What these assertions are here for, in order of what breaks the real thing:
//
// - The list must still be at the bottom after the content has grown, not only
//   at the moment it mounted. Markdown, cards and images settle after the first
//   paint, and the one-shot scroll this replaced landed in the middle of the
//   history because of it.
// - The reader scrolling up must win, and must keep winning while a reply
//   streams underneath. Coming back to the bottom must hand the pin back.
// - The scroll the pin performs itself must not read as the reader scrolling
//   away, or the first growth would unpin the list forever.
// - Teardown must release the container it bound to, so a re-pin (a new thread)
//   does not leave the old listener running.
// - A remembered list must come back where the reader was and stay there while
//   the rest of the content settles: the pin starts from the remembered state,
//   or the first growth drags the reader to the newest message. A reader who
//   left at the bottom must come back pinned instead, so the reply that streamed
//   while they were away is in front of them.
// - The browser echoes the module's own write back as a scroll, and that echo is
//   recorded like any other. A write that landed whole records the place that was
//   already stored; a write the list was still too short to hold is clamped to
//   the bottom and records the bottom. The second is the cost of not chasing the
//   settling, and it is pinned here so it reads as a choice rather than a bug.
//
// The host and the height watcher are stand-ins: there is no layout in this
// runner, so a real element reports 0 for every metric. scrollableAncestor is
// the one part that needs a document, and it gets one.

import { expect, test } from "bun:test";
import {
	scrollableAncestor,
	stickToBottom,
	type ScrollHost,
	type StickPosition,
} from "../../../src/ui/components/common/stick-to-bottom";
import { useDom } from "../../support/dom";

await useDom();

// A scroll container that records its listeners and lets a test move its
// numbers around. Scrolling it by hand fires the event a browser would.
//
// A write that moves the list owes a scroll event too, the way a browser reports
// a programmatic scroll. There are no frames here to deliver it on, so the test
// delivers it with `flush`, and one flush fires one event however many writes it
// covers — a browser coalesces the moves within a frame the same way. The
// position clamps the way a browser's does, which is what a restore into a list
// that has not finished settling runs into.
function makeHost(scrollHeight: number, clientHeight: number) {
	const listeners = new Set<() => void>();
	let position = 0;
	let owed = false;
	return {
		get scrollTop() {
			return position;
		},
		set scrollTop(next: number) {
			const clamped = Math.max(0, Math.min(next, this.scrollHeight - this.clientHeight));
			if (clamped === position) return;
			position = clamped;
			owed = true;
		},
		scrollHeight,
		clientHeight,
		addEventListener(_type: "scroll", fn: () => void) {
			listeners.add(fn);
		},
		removeEventListener(_type: "scroll", fn: () => void) {
			listeners.delete(fn);
		},
		/** What the reader does: move the position, then the browser reports it. */
		scrollTo(top: number) {
			this.scrollTop = top;
			this.flush();
		},
		/** What the content does: get taller, no scroll event of its own. */
		grow(by: number) {
			this.scrollHeight += by;
		},
		/** The browser reporting the moves it owes an event for. */
		flush() {
			if (!owed) return;
			owed = false;
			for (const fn of Array.from(listeners)) fn();
		},
		listenerCount() {
			return listeners.size;
		},
	};
}

// The list element is only ever handed back to the injected seams here.
const LIST = {} as Element;

function bind(host: ReturnType<typeof makeHost>) {
	let notify = () => {};
	let observing = true;
	const stop = stickToBottom(LIST, {
		resolveHost: () => host as unknown as ScrollHost,
		observeContent: (_list, onChange) => {
			notify = onChange;
			return () => {
				observing = false;
			};
		},
	});
	return { stop, contentChanged: () => notify(), isObserving: () => observing };
}

const bottomOf = (host: { scrollHeight: number; clientHeight: number }) => host.scrollHeight - host.clientHeight;

test("pins to the bottom as soon as it binds", () => {
	const host = makeHost(1000, 300);
	const { stop } = bind(host);
	expect(host.scrollTop).toBe(700);
	stop();
});

test("follows the content that keeps growing after the first paint", () => {
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bind(host);
	// Markdown, then an image, then a font swap — each one taller than the last.
	for (const by of [400, 250, 90]) {
		host.grow(by);
		contentChanged();
		expect(host.scrollTop).toBe(bottomOf(host));
	}
	stop();
});

test("its own scroll does not read as the reader scrolling away", () => {
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bind(host);
	// The browser reports the pin's own move one turn later.
	host.flush();
	host.grow(500);
	contentChanged();
	expect(host.scrollTop).toBe(bottomOf(host));
	stop();
});

test("a reader who scrolls up keeps their place while the reply streams", () => {
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bind(host);
	host.scrollTo(200);
	for (const by of [120, 120]) {
		host.grow(by);
		contentChanged();
		expect(host.scrollTop).toBe(200);
	}
	stop();
});

test("a small nudge inside the threshold is not scrolling away", () => {
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bind(host);
	host.scrollTo(bottomOf(host) - 30);
	host.grow(200);
	contentChanged();
	expect(host.scrollTop).toBe(bottomOf(host));
	stop();
});

test("scrolling back to the bottom takes the pin again", () => {
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bind(host);
	host.scrollTo(100);
	host.grow(500);
	contentChanged();
	expect(host.scrollTop).toBe(100);

	host.scrollTo(bottomOf(host));
	host.grow(300);
	contentChanged();
	expect(host.scrollTop).toBe(bottomOf(host));
	stop();
});

test("a height change that arrives as a scroll event does not unpin", () => {
	const host = makeHost(1000, 300);
	const { stop } = bind(host);
	// Scroll anchoring: the content grew and the browser moved the position
	// itself, reporting it as a scroll from a place that is no longer the bottom.
	host.scrollHeight += 600;
	host.flush();
	expect(host.scrollTop).toBe(bottomOf(host));
	stop();
});

test("teardown releases the container and the height watcher", () => {
	const host = makeHost(1000, 300);
	const { stop, isObserving } = bind(host);
	expect(host.listenerCount()).toBe(1);
	stop();
	expect(host.listenerCount()).toBe(0);
	expect(isObserving()).toBe(false);
});

// The store behind the two seams, in one variable. One memory across two binds
// is the transcript unmounting when the reader clicks a citation and coming back
// when they tap the corner card.
function makeMemory() {
	let saved: StickPosition | null = null;
	// Every write, not just the last one: what the echo of the module's own write
	// records is half of what these tests are about.
	const writes: StickPosition[] = [];
	const seams = {
		restore: () => saved,
		remember: (at: StickPosition) => {
			saved = at;
			writes.push({ ...at });
		},
	};
	return { seams, saved: () => saved, writes: () => writes };
}

function bindRemembered(host: ReturnType<typeof makeHost>, memory: ReturnType<typeof makeMemory>) {
	let notify = () => {};
	const stop = stickToBottom(LIST, {
		resolveHost: () => host as unknown as ScrollHost,
		observeContent: (_list, onChange) => {
			notify = onChange;
			return () => {};
		},
		...memory.seams,
	});
	return { stop, contentChanged: () => notify() };
}

// Leaves a mid-history position in `memory`: what the reader did before they
// clicked the citation chip.
function leaveAt(memory: ReturnType<typeof makeMemory>, top: number) {
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bindRemembered(host, memory);
	host.scrollTo(top);
	host.grow(200);
	contentChanged();
	stop();
	return host;
}

test("a reader who left mid-history comes back where they were", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(1200, 300);
	const { stop } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(200);
	stop();
});

test("the restored place survives the content settling under it", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(1200, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	// KaTeX, then a figure card inflating: the pin the place came back with is off,
	// so neither wave drags the reader down to the newest message.
	for (const by of [300, 180]) {
		back.grow(by);
		contentChanged();
		expect(back.scrollTop).toBe(200);
	}
	stop();
});

test("a reader who left at the bottom comes back pinned, not frozen", () => {
	const memory = makeMemory();
	const left = makeHost(1000, 300);
	const first = bindRemembered(left, memory);
	// Up the history and back down to the newest message, which is where the
	// bottom counts as a state rather than the offset it happened to be at.
	left.scrollTo(200);
	left.grow(400);
	left.scrollTo(bottomOf(left));
	first.stop();
	expect(memory.saved()).toEqual({ top: bottomOf(left), stuck: true });

	const back = makeHost(1000, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(bottomOf(back));
	// The reply that streamed while the reader was on the page.
	back.grow(400);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	stop();
});

test("the echo of a write that landed whole records the place already stored", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const written = memory.writes().length;
	const back = makeHost(1200, 300);
	const { stop } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(200);
	// The browser reporting the restore's own move one turn later. It is read as a
	// scroll of the reader's and recorded, and what it records is what was already
	// there — which is why the write needs no marker on it.
	back.flush();
	expect(memory.writes().slice(written)).toEqual([{ top: 200, stuck: false }]);
	stop();
});

test("a write the list is too short to hold records the bottom instead", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	// The first paint: the rows are in, nothing inside them has settled, and the
	// list is shorter than the offset it is going back to. The browser clamps the
	// write to the bottom, and the echo of it puts the bottom in the memory over
	// the place. That is what this module gives up by writing the place once.
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(bottomOf(back));
	back.flush();
	expect(memory.saved()).toEqual({ top: 100, stuck: true });
	// So the reader opens on the newest message and follows the settling there,
	// which is where a list with nothing remembered leaves them.
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	stop();
});

test("without the seams nothing is remembered", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(1200, 300);
	const { stop } = bind(back);
	expect(back.scrollTop).toBe(bottomOf(back));
	stop();
});

// A stand-in for layout: happy-dom reports 0 for both metrics, and what the walk
// asks is which element has more content than room.
function sized(el: HTMLElement, scrollHeight: number, clientHeight: number): HTMLElement {
	Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
	Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
	return el;
}

function column(): { outer: HTMLElement; list: HTMLElement } {
	const outer = document.createElement("div");
	const list = document.createElement("div");
	outer.appendChild(list);
	document.body.appendChild(outer);
	// Both carry overflow-y:auto in the app — the list always does, the call
	// window's column does too. Only one of them is height-constrained.
	outer.style.overflowY = "auto";
	list.style.overflowY = "auto";
	return { outer, list };
}

test("the scrolling element is the constrained ancestor when the list is not one", () => {
	const { outer, list } = column();
	sized(outer, 2000, 500);
	sized(list, 2000, 2000);
	expect(scrollableAncestor(list)).toBe(outer);
	outer.remove();
});

test("the scrolling element is the list itself when the list is capped", () => {
	const { outer, list } = column();
	sized(outer, 800, 800);
	sized(list, 2000, 256);
	expect(scrollableAncestor(list)).toBe(list);
	outer.remove();
});

test("an ancestor that overflows without being allowed to scroll is not it", () => {
	const { outer, list } = column();
	outer.style.overflowY = "hidden";
	sized(outer, 2000, 500);
	sized(list, 2000, 2000);
	expect(scrollableAncestor(list)).toBe(document.scrollingElement as Element);
	outer.remove();
});

test("nothing scrolling means the page does", () => {
	const { outer, list } = column();
	sized(outer, 500, 500);
	sized(list, 500, 500);
	expect(scrollableAncestor(list)).toBe(document.scrollingElement as Element);
	outer.remove();
});

test("the place is not spent on the page the walk falls back to", () => {
	// On mount nothing has been laid out, so no element overflows and the walk
	// finds only the document. Writing the place there scrolls the page and leaves
	// the transcript at its oldest message.
	const { outer, list } = column();
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(1000, 300);
	const page = list.ownerDocument.scrollingElement as unknown as ScrollHost;
	let settled = false;
	let notify = () => {};
	const stop = stickToBottom(list, {
		resolveHost: () => (settled ? (back as unknown as ScrollHost) : page),
		observeContent: (_list, onChange) => {
			notify = onChange;
			return () => {};
		},
		...memory.seams,
	});
	expect(back.scrollTop).toBe(0);
	settled = true;
	notify();
	expect(back.scrollTop).toBe(200);
	stop();
	outer.remove();
});
