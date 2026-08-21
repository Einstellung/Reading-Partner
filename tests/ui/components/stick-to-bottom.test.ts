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
//   recorded as a place the reader chose. A write that moved nothing is owed no
//   such scroll, and the marker it would leave standing swallows the reader's
//   return to the bottom — the list then stops following the stream for good. It
//   must not spend the marker of an earlier write either: that echo is still on
//   its way, and reading it as the reader drops the restore and overwrites the
//   memory with a position nobody scrolled to.
// - Teardown must release the container it bound to, so a re-pin (a new thread)
//   does not leave the old listener running.
// - A remembered list must come back where the reader was, and must write that
//   place only once the list is tall enough to hold it. A write clamped to a list
//   that is still settling parks the reader at an offset nobody chose, and on the
//   growth that first passes the place that offset is the bottom — where a pin
//   read off it comes back true and every growth after it drags the reader to the
//   newest message.
// - While the place is out of reach the list must be one with no memory: at the
//   bottom, following every growth. A transcript that comes back too short for
//   the place ends there and stays there, without waiting for any clock.
// - A landing must turn the pin off, however close to the bottom it lands. The
//   wait ran pinned, and a pin left standing on the place drags the reader to the
//   newest message on the next growth.
// - The reader scrolling during a restore must take it over, while the restore's
//   own scroll and a height change reported as a scroll must not. That holds for
//   the first scroll after a wave of settling too: the wait's own pin measures
//   every wave, so a growth two waves ago is not what the reader's scroll came
//   with. The restore's own scroll counts as its own even when the browser clamps
//   it to a fraction the rounded metrics do not name.
// - A place the list never becomes tall enough to reach must be given up on when
//   the restore's window runs out, however late the growth that would have
//   reached it arrives. The window runs from the last growth, so a transcript
//   still settling in fine waves keeps its place however long the settling takes.
//   It must survive the height watcher's first delivery, which reports every
//   target it observes once at the height the bind already saw. Giving up opens the list the way one with no memory opens, pinned to the
//   newest message, and records that as the new place — otherwise the reader pays
//   the same failed restore every time they swap out to the page and back.
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

test("coming back to the bottom takes the pin again after a settle that moved nothing", () => {
	const host = makeHost(1000, 300);
	const { stop, contentChanged } = bind(host);
	// The height watcher's first delivery, at the height the bind already pinned
	// to: the write moves nothing, so the browser owes it no scroll event.
	contentChanged();
	host.scrollTo(200);
	host.scrollTo(700);
	host.grow(500);
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
	// Every write, not just the last one: a scroll of this module's own being
	// recorded at all is the defect, and the value it would record is usually the
	// one already saved.
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

// The clock the restore's window is measured on, moved by hand: the window is
// what tells a list that is still settling from one that will never reach the
// place, and nothing in this runner takes any time at all.
function makeClock() {
	let ms = 0;
	return {
		now: () => ms,
		advance: (by: number) => {
			ms += by;
		},
	};
}

function bindRemembered(
	host: ReturnType<typeof makeHost>,
	memory: ReturnType<typeof makeMemory>,
	clock?: ReturnType<typeof makeClock>,
) {
	let notify = () => {};
	const stop = stickToBottom(LIST, {
		resolveHost: () => host as unknown as ScrollHost,
		observeContent: (_list, onChange) => {
			notify = onChange;
			return () => {};
		},
		now: clock?.now,
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

test("a place off the end of a list that is still short is not written at all", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	// The first paint: the rows are in, nothing inside them has settled yet, and
	// the whole list is shorter than the offset it is going back to. Nothing of
	// the place is written; the list waits at the bottom.
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(bottomOf(back));
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	stop();
});

test("a place reached only after many small growths lands there once and stays", () => {
	// The transcript settling row by row rather than in two waves: every step is
	// small enough that the height first passes the place while the place is still
	// within a threshold of the bottom.
	for (const step of [20, 40]) {
		const memory = makeMemory();
		leaveAt(memory, 200);
		const back = makeHost(400, 300);
		const { stop, contentChanged } = bindRemembered(back, memory);
		for (let grown = 0; grown < 600; grown += step) {
			back.grow(step);
			contentChanged();
			back.flush();
		}
		expect(back.scrollTop).toBe(200);
		// And the bottom is a long way below it by now, so staying is a choice the
		// list made and not a place it ran out of room to leave.
		expect(bottomOf(back)).toBe(700);
		stop();
	}
});

test("a landing that is also the bottom does not turn the pin on", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	// The growth that first brings the place within reach makes it the bottom too:
	// the place is 200 and the list settles at a maximum of exactly 200.
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	back.grow(100);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	expect(bottomOf(back)).toBe(200);
	back.flush();
	// The reply that streams in next belongs below the fold, not in front of the
	// reader.
	back.grow(400);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	expect(memory.saved()).toEqual({ top: 200, stuck: false });
	stop();
});

test("nothing but the memory and the reader's own scroll turns the pin on", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const written = memory.writes().length;
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	// A settle that crosses the place, then a stream of replies, with the browser
	// reporting every move this module made. Nothing here is the reader, so the
	// list ends on the place and a long way above the bottom, and nothing along the
	// way is recorded.
	for (let i = 0; i < 12; i++) {
		back.grow(60);
		contentChanged();
		back.flush();
	}
	expect(back.scrollTop).toBe(200);
	expect(bottomOf(back)).toBe(820);
	expect(memory.writes().slice(written)).toEqual([]);
	// The reader's own scroll is the one thing left that can turn the pin on.
	back.scrollTo(bottomOf(back));
	back.grow(200);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	const recorded = memory.writes().slice(written);
	expect(recorded[recorded.length - 1]?.stuck).toBe(true);
	stop();
});

test("the restore outlives the height watcher's first delivery", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	// What a ResizeObserver does right after the bind: one callback per target it
	// was given, every one of them at the height the bind already measured.
	contentChanged();
	contentChanged();
	// Then the content settles in two waves, and only the second brings the place
	// within reach.
	back.grow(50);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	back.grow(300);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	stop();
});

test("the echo of the restore's landing is not a place the reader chose", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	const written = memory.writes().length;
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	// The browser reports the restore's own write one turn later.
	back.flush();
	expect(memory.writes().slice(written)).toEqual([]);
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
	expect(back.scrollTop).toBe(199.5);
	// The place the reader left is still theirs; the echo must not have written
	// the bottom over it.
	expect(memory.saved()).toEqual({ top: 200, stuck: false });
	stop();
});

test("a write that moved nothing leaves no marker behind", () => {
	const memory = makeMemory();
	const left = makeHost(1000, 300);
	const first = bindRemembered(left, memory);
	left.scrollTo(200);
	left.scrollTo(bottomOf(left));
	first.stop();
	// Back to the bottom of a shorter transcript: the bind's write moves the list,
	// and the height watcher's delivery after it writes the same number again.
	const back = makeHost(700, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(bottomOf(back));
	contentChanged();
	// The reader takes the list over, then comes back to exactly where that write
	// landed, which is a place of theirs like any other.
	back.scrollTo(100);
	back.scrollTo(400);
	expect(memory.saved()).toEqual({ top: 400, stuck: true });
	stop();
});

test("a write that moved nothing leaves the marker of one that did standing", () => {
	const memory = makeMemory();
	leaveAt(memory, 200);
	// A transcript that comes back too short for the place: the bind pins it to the
	// bottom, and the height watcher's first delivery — same list, same height —
	// writes that same number again. Only the first move is owed an echo.
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	expect(back.scrollTop).toBe(bottomOf(back));
	contentChanged();
	back.flush();
	// The echo is this module's own, so nothing here was the reader: the place is
	// still waiting and the memory still holds it.
	expect(memory.saved()).toEqual({ top: 200, stuck: false });
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(200);
	stop();
});

test("a place the list never reaches is given up on and opened at the bottom", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const clock = makeClock();
	// Coming back to a transcript with rows missing — a preamble blanked, tool
	// chips dropped — so the remembered offset is past its end for good.
	const back = makeHost(700, 300);
	const { stop, contentChanged } = bindRemembered(back, memory, clock);
	expect(back.scrollTop).toBe(bottomOf(back));
	// Long enough that anything that was going to settle has.
	clock.advance(2500);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	// From there the list is one with no memory: the reply that streams in next is
	// followed.
	back.flush();
	back.grow(500);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	// And the place that could not be reached is not tried again on the next
	// return; the bottom the reader was left at is what the memory holds now.
	expect(memory.saved()).toEqual({ top: 400, stuck: true });
	stop();
});

test("a restore that ran out of time gives up on it, however late the growth", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const clock = makeClock();
	const back = makeHost(700, 300);
	const { stop, contentChanged } = bindRemembered(back, memory, clock);
	expect(back.scrollTop).toBe(bottomOf(back));
	// Ten seconds of reading what did come back, and then a last row settles and
	// the list is finally tall enough for the old offset. The window closed eight
	// seconds ago, so the place is gone and the newest message is where this opens.
	clock.advance(10000);
	back.grow(500);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	stop();
});

test("a transcript still settling keeps its place past the length of the window", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const clock = makeClock();
	// A long transcript settling row by row on a slow frame budget: four seconds of
	// waves, every one of them the list still growing towards the place.
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory, clock);
	for (let i = 0; i < 120; i++) {
		back.grow(3);
		clock.advance(33);
		contentChanged();
		back.flush();
	}
	expect(clock.now()).toBe(3960);
	expect(back.scrollTop).toBe(bottomOf(back));
	// The wave that first fits the place still lands on it, and nothing along the
	// way was recorded.
	back.grow(400);
	clock.advance(33);
	contentChanged();
	expect(back.scrollTop).toBe(600);
	expect(memory.writes()).toHaveLength(1);
	stop();
});

test("a list the restore gave up on is still the reader's to scroll away from", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const clock = makeClock();
	const back = makeHost(700, 300);
	const { stop, contentChanged } = bindRemembered(back, memory, clock);
	clock.advance(2500);
	contentChanged();
	back.flush();
	// Up the history, and the replies that stream in stay below the fold.
	back.scrollTo(120);
	for (const by of [200, 200, 200]) {
		back.grow(by);
		contentChanged();
	}
	expect(back.scrollTop).toBe(120);
	expect(memory.saved()).toEqual({ top: 120, stuck: false });
	stop();
});

test("a place that never fits leaves the list where one with no memory leaves it", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const clock = makeClock();
	// A transcript that comes back smaller: fewer rows, a draft in the composer,
	// the on-screen keyboard gone. It settles wave by wave and never becomes tall
	// enough for the old place, and the list follows the newest message the whole
	// way there, the way it would with nothing remembered at all.
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory, clock);
	for (let i = 0; i < 20; i++) {
		back.grow(20);
		clock.advance(16);
		contentChanged();
		back.flush();
		expect(back.scrollTop).toBe(bottomOf(back));
	}
	// The settling stopped well inside the window, so no wave is left to find the
	// clock with; the list is already where the give-up would have put it.
	expect(back.scrollTop).toBe(500);
	expect(memory.writes()).toHaveLength(1);
	// The reply that arrives after the window is followed too, and it is what
	// finally writes the unreachable place out of the memory.
	clock.advance(2000);
	back.grow(300);
	contentChanged();
	expect(back.scrollTop).toBe(bottomOf(back));
	expect(memory.saved()).toEqual({ top: bottomOf(back), stuck: true });
	stop();
});

test("a place that fits only after several waves is pinned until it does", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	// Four waves short of the place, each one followed to the bottom.
	for (let i = 0; i < 4; i++) {
		back.grow(100);
		contentChanged();
		back.flush();
		expect(back.scrollTop).toBe(bottomOf(back));
	}
	// The wave that first fits the place lands on it, and the pin is off from
	// there: the replies that stream in afterwards stay below the fold.
	back.grow(200);
	contentChanged();
	expect(back.scrollTop).toBe(600);
	back.flush();
	for (const by of [300, 300]) {
		back.grow(by);
		contentChanged();
		expect(back.scrollTop).toBe(600);
	}
	expect(memory.writes()).toHaveLength(1);
	stop();
});

test("the reader's first scroll after a wave of the wait is theirs", () => {
	const memory = makeMemory();
	leaveAt(memory, 600);
	const back = makeHost(400, 300);
	const { stop, contentChanged } = bindRemembered(back, memory);
	// A wave of settling, still short of the place, and the reader pushes the list
	// up before the browser has reported the pin's move. The growth belonged to the
	// pin; the scroll that comes after it does not.
	back.grow(300);
	contentChanged();
	back.scrollTo(80);
	expect(memory.saved()).toEqual({ top: 80, stuck: false });
	// The restore is over, so the place is not written when the list finally fits.
	back.grow(600);
	contentChanged();
	expect(back.scrollTop).toBe(80);
	stop();
});

test("a reader who takes over before the window runs out leaves nothing to give up", () => {
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
