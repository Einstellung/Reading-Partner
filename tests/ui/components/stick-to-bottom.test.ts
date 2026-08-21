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
//   away, or the first growth would unpin the list forever, and must not be
//   recorded as a place the reader chose.
// - Teardown must release the container it bound to, so a re-pin (a new thread)
//   does not leave the old listener running.
// - A remembered list must come back where the reader was, and must keep coming
//   back there while the content settles under it — a one-shot restore lands in
//   the middle of the history for the same reason a one-shot pin does.
// - The reader scrolling during a restore must take it over, while the restore's
//   own scroll and a height change reported as a scroll must not. The restore's
//   own scroll counts as its own even when the browser clamps it to a fraction
//   the rounded metrics do not name.
// - A remembered place the list has become too short to reach must be given up
//   on once the content stops growing, or every later growth yanks the reader
//   back to a place that is not there any more.
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
// covers — a browser coalesces the moves within a frame the same way.
//
// The position clamps the way a browser's does, and `slack` puts the maximum a
// fraction below the one the metrics describe: scrollHeight and clientHeight are
// rounded and scrollTop is not, so on a real list a write at the computed bottom
// lands just short of it.
function makeHost(scrollHeight: number, clientHeight: number, slack = 0) {
	const listeners = new Set<() => void>();
	let position = 0;
	let owed = false;
	return {
		get scrollTop() {
			return position;
		},
		set scrollTop(next: number) {
			const clamped = Math.max(0, Math.min(next, this.scrollHeight - this.clientHeight - slack));
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
	const seams = {
		restore: () => saved,
		remember: (at: StickPosition) => {
			saved = at;
		},
	};
	return { seams, saved: () => saved };
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
	// KaTeX, then a figure card inflating: a one-shot restore is somewhere else
	// by now.
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

test("a place off the end of a list that is still short is re-applied until it fits", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	// The first paint: the rows are in, nothing inside them has settled yet.
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(bottomOf(back));
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	stop();
});

test("the restore's own scroll does not read as the reader taking over", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	// The browser reports the clamped write one turn later.
	back.flush();
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	stop();
});

test("a height change reported as a scroll does not cancel the restore", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	back.flush();
	// Scroll anchoring during the settle: taller content, and the browser moved
	// the position itself.
	back.scrollHeight += 600;
	back.scrollTop = 150;
	back.flush();
	contentChanged();
	expect(back.scrollTop).toBe(200);
	stop();
});

test("the reader scrolling during the restore takes it over", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	back.scrollTo(50);
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(50);
	stop();
});

test("the restore survives its own write landing short of the rounded bottom", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	// A list whose maximum offset is 199.5: the restore asks for 200, the browser
	// puts it at 199.5, and the echo of that write must still read as this
	// module's own rather than as the reader taking the place over.
	const back = makeHost(500, 300, 0.5);
	const { stop, contentChanged } = bindRemembered(back, memory);
	back.flush();
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	// The place the reader left is still theirs; the echo must not have written
	// the bottom over it.
	expect(memory.saved()).toEqual({ top: 200, stuck: false });
	stop();
});

test("a place the list is too short to reach is given up on, not chased", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	// Coming back to a transcript with rows missing — a preamble blanked, tool
	// chips dropped — so the remembered offset is past its end for good.
	const back = makeHost(700, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(bottomOf(back));
	// The content stops growing: nothing more is coming to reach 600.
	contentChanged();
	// The reply that streams in afterwards must be followed, not answered with
	// another yank back to a place that is not there.
	back.grow(500);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	stop();
});

test("giving up hands the list back to the reader", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const back = makeHost(700, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	contentChanged();
	back.scrollTo(50);
	back.grow(500);
	contentChanged();
	expect(back.scrollTop).toBe(50);
	stop();
});

test("a reader who never scrolled records nothing", () => {
	const memory = makeMemory();
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bindRemembered(host, memory);
	host.grow(400);
	contentChanged();
	host.flush();
	stop();
	expect(memory.saved()).toBe(null);
});

test("the pin's own write is not recorded, and the reader's next one is", () => {
	const memory = makeMemory();
	const host = makeHost(1000, 300);
	const { stop } = bindRemembered(host, memory);
	host.flush();
	expect(memory.saved()).toBe(null);
	// And the marker the pin left behind is spent, not a standing mute on the
	// scrolls that follow.
	host.scrollTo(120);
	expect(memory.saved()).toEqual({ top: 120, stuck: false });
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
