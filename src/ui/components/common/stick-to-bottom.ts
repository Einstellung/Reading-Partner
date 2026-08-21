// Pins a list to its newest content: opening a chat lands on the last message,
// and a streaming reply keeps its tail in view — until the reader scrolls up,
// which hands the scroll position back to them until they return to the bottom.
//
// Scrolling once on mount is not enough. Markdown, cards, images and fonts all
// settle after the first paint, and every one of them makes the list taller
// afterwards, leaving a one-shot scroll parked in the middle of the history. So
// the height is watched rather than the message count, and each growth re-pins.
//
// The two shapes this runs in differ: in the call window the list is unbounded
// and an ancestor scrolls, in the reading bubble the list is capped and scrolls
// itself. Hence the walk for the scrolling element starts at the list and
// includes it, and a growth of a capped list shows up on its children, not on
// itself — so the children are observed too.
//
// A list can also be one that is remembered: `restore`/`remember` hand the
// position to a store that outlives the binding (common/scroll-memory.ts), so a
// transcript that unmounts and comes back opens where the reader left it. The
// place is written only once the list is tall enough to hold it: at the first
// paint it is still shorter, and a write clamped to that height parks the reader
// at a position nobody chose. So the restore waits through the settling and
// lands whole, and while it waits the list is one with no memory: pinned to the
// bottom, following every growth. The reader sees the newest message for the
// frames the settling takes and is then moved to their place; a transcript that
// comes back too short for the place never moves them at all, which is where a
// list with no memory leaves them anyway. A window of a couple of seconds still
// ends the wait: past it the place is dropped and the bottom recorded in its
// stead. Without the three seams this module behaves as it did before them.

/** The part of a scroll container this needs. An Element satisfies it. */
export interface ScrollHost {
	scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
	addEventListener(type: "scroll", handler: () => void): void;
	removeEventListener(type: "scroll", handler: () => void): void;
}

/** A place in the list, as the pin thinks of it. */
export interface StickPosition {
	top: number;
	// At the bottom is a state, not a place: it comes back as the pin, so a reply
	// that streamed while the reader was away is visible.
	stuck: boolean;
}

export interface StickOptions {
	/** How far above the bottom still counts as being at the bottom, in px. */
	threshold?: number;
	/** The scrolling element. Injected by the tests; found by the walk otherwise. */
	resolveHost?(list: Element): ScrollHost | null;
	/** Subscribes to whatever changes the rendered height. Injected by the tests. */
	observeContent?(list: Element, onChange: () => void): () => void;
	/** The clock the restore's window is measured on. Injected by the tests. */
	now?(): number;
	/** Where this list was left, if it is one that is remembered. Null = the bottom. */
	restore?(): StickPosition | null;
	/** Records where the reader is. Called on every scroll of theirs. */
	remember?(at: StickPosition): void;
}

const DEFAULT_THRESHOLD = 40;

// How long a restore keeps trying before the place is treated as gone. Settling
// after the first paint takes a few hundred milliseconds; a transcript that came
// back shorter than the place it is going to stays short for good.
const RESTORE_WINDOW_MS = 2000;

// How far off the echo of a write may land and still be recognised as this
// module's own. The marker is the position read back immediately after the
// write, so it matches exactly unless something moved the list in between, and a
// pixel of slack is what covers that.
const SELF_WRITE_SLACK = 1;

// How far the metrics may fall short of a remembered place and still count as
// tall enough to hold it. scrollHeight and clientHeight are rounded and
// scrollTop is not, so a list that does hold the place can report a maximum a
// fraction below it.
const REACH_SLACK = 1;

const SCROLLABLE = new Set(["auto", "scroll", "overlay"]);

// Whether this element is the one that scrolls: it must both be allowed to and
// have something to scroll. The allowance alone is not a test — the list itself
// always carries overflow-y:auto, and in the call window it is the ancestor that
// is height-constrained and therefore the one that actually scrolls.
function scrolls(el: Element): boolean {
	const view = el.ownerDocument?.defaultView;
	if (!view) return false;
	const overflowY = view.getComputedStyle(el).overflowY;
	return SCROLLABLE.has(overflowY) && el.scrollHeight > el.clientHeight;
}

/**
 * The nearest element that scrolls, starting at `el` itself. Falls back to the
 * document's scrolling element when the page as a whole is what moves.
 */
export function scrollableAncestor(el: Element): Element | null {
	for (let node: Element | null = el; node; node = node.parentElement) {
		if (scrolls(node)) return node;
	}
	return el.ownerDocument?.scrollingElement ?? null;
}

// The default height watcher: the list's own box, plus each child's, because a
// capped list stays the same size while its content grows inside it. The child
// set is re-taken whenever rows are added or removed, and re-observing reports
// each target once, which re-pins after a new message lands.
function observeContentDefault(list: Element, onChange: () => void): () => void {
	if (typeof ResizeObserver === "undefined") return () => {};
	const ro = new ResizeObserver(() => onChange());
	const sync = () => {
		ro.disconnect();
		ro.observe(list);
		for (const child of Array.from(list.children)) ro.observe(child);
	};
	sync();
	const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(sync);
	mo?.observe(list, { childList: true });
	return () => {
		ro.disconnect();
		mo?.disconnect();
	};
}

/**
 * Keeps `list` scrolled to its bottom while the reader has not scrolled away.
 * Returns the teardown.
 */
export function stickToBottom(list: Element, options: StickOptions = {}): () => void {
	const threshold = options.threshold ?? DEFAULT_THRESHOLD;
	const resolveHost = options.resolveHost ?? ((el: Element) => scrollableAncestor(el) as ScrollHost | null);
	const observeContent = options.observeContent ?? observeContentDefault;
	const now = options.now ?? Date.now;

	const saved = options.restore?.() ?? null;
	let host: ScrollHost | null = null;
	// Whether the list follows its newest content. Written here from the memory,
	// in onScroll from a scroll of the reader's, and in applyRestore: on for the
	// wait and for the give-up, off for a landing. The landing says so outright
	// rather than reading the distance back — the offset it lands on is the
	// reader's place, not a pin they chose, and a pin read off it turns every
	// later growth into a yank to the newest message.
	let stuck = saved ? saved.stuck : true;
	// Where to go back to, while the list is still too short to hold it. Null once
	// it lands, once the reader takes over, once the window runs out, and whenever
	// the memory says the bottom.
	let pending = saved && !saved.stuck ? saved.top : null;
	// When the restore stops trying. Armed from the bind rather than counted in
	// attempts: the height watcher reports every target it is given once, right
	// after the bind and all at the same height, so a count cannot tell a list
	// that is still settling from one that will never reach the place.
	const restoreUntil = now() + RESTORE_WINDOW_MS;
	// The height the last event or write of this module's own measured against. A
	// scroll that comes with a changed height came from the content, not from the
	// reader, so every write refreshes it: left stale across one, the reader's
	// next scroll reads as one more growth and is discarded.
	let seenHeight = 0;
	// The position this module last wrote itself, kept until the browser echoes it
	// back, and compared by value within a pixel rather than armed as a flag. Two
	// rules keep it from swallowing a scroll of the reader's: only a write that
	// actually moved the list arms it, because a write that changes nothing fires
	// no event and would leave the marker standing at that position for good; and
	// whatever event arrives next spends it, matched or not.
	let selfTop: number | null = null;

	function applyRestore() {
		if (!host || pending === null) return;
		// The window is tested before the host is touched, or it bounds nothing: a
		// growth that arrives long after the place is gone would still yank the
		// reader to it and only then find the clock.
		if (now() >= restoreUntil) {
			// A place that cannot be reached in time is gone, so the list opens the
			// way one with no memory opens: pinned to the newest message. That is also
			// recorded as the place, or a reader who swaps out to the page and back
			// pays the same failed restore every time.
			pending = null;
			stuck = true;
			toBottom();
			options.remember?.({ top: host.scrollTop, stuck });
			return;
		}
		// The place is not written while the list is too short to hold it: a write
		// clamped to the current height leaves the reader at an offset nobody chose,
		// and moves them again on every growth until the place fits. The wait is
		// spent the way a list with no memory spends it, pinned and following the
		// settling, so a place the list never grows into needs no clock to leave the
		// reader somewhere sensible.
		if (host.scrollHeight - host.clientHeight < pending - REACH_SLACK) {
			stuck = true;
			toBottom();
			return;
		}
		const before = host.scrollTop;
		// Written whole and read back rather than clamped here: the browser has
		// already clamped it, and a maximum computed from the rounded metrics misses
		// where the write really landed by a fraction — enough for the echo to read
		// as the reader taking over, which drops the place for good.
		host.scrollTop = pending;
		const landed = host.scrollTop;
		selfTop = landed === before ? null : landed;
		seenHeight = host.scrollHeight;
		// The pin the wait ran under ends here: the place is the reader's, and
		// following the newest message from it would drag them straight off it.
		stuck = false;
		pending = null;
	}

	const onScroll = () => {
		if (!host) return;
		const height = host.scrollHeight;
		const grew = height !== seenHeight;
		seenHeight = height;
		// A pinned list whose height moved under it: the browser may report that as
		// a scroll (anchoring), and reading the distance then would unpin it.
		if (grew && stuck) {
			toBottom();
			return;
		}
		// The browser echoing back a scroll this module performed. Events are
		// ordered, so the echo of a move is the next one to arrive; a scroll of the
		// reader's coalesced into the same frame arrives at their position instead,
		// does not match, and is read as theirs. Either way the marker is spent.
		const echo = selfTop !== null && Math.abs(host.scrollTop - selfTop) <= SELF_WRITE_SLACK;
		selfTop = null;
		if (echo) return;
		if (pending !== null) {
			// A restore that has not landed yet, and the content moving under it: the
			// same rule the rest of this file runs on — a scroll that comes with a
			// changed height came from the content, not from the reader. The wait's
			// own pin measures the height it writes at, so changed means since that
			// wave and not since the bind.
			if (grew) return;
			// A scroll at an unchanged height is the reader taking over.
			pending = null;
		}
		stuck = host.scrollHeight - host.clientHeight - host.scrollTop <= threshold;
		// The one place the position is both the reader's and known to belong to
		// the key this binding was made with. Teardown cannot do it: React runs the
		// old cleanup after the next conversation's rows are already in the DOM.
		options.remember?.({ top: host.scrollTop, stuck });
	};

	const bind = (next: ScrollHost | null) => {
		if (next === host) return;
		host?.removeEventListener("scroll", onScroll);
		host = next;
		host?.addEventListener("scroll", onScroll);
		seenHeight = host?.scrollHeight ?? 0;
		selfTop = null;
	};

	function toBottom() {
		if (!host) return;
		const before = host.scrollTop;
		// Assigning scrollTop is the instant scroll; scrollIntoView would animate
		// under `scroll-behavior: smooth` and never catch a list that keeps growing.
		host.scrollTop = host.scrollHeight - host.clientHeight;
		const landed = host.scrollTop;
		// Read back and kept for the same reason the restore does it: the echo of
		// this write is a scroll event like any other, and without the marker it is
		// recorded as a place the reader chose.
		selfTop = landed === before ? null : landed;
		seenHeight = host.scrollHeight;
	}

	// The host is re-resolved while the walk has only found the page: on mount
	// nothing has been laid out yet, so no element overflows and the real
	// container cannot be told from the list above it.
	const settleHost = () => {
		const doc = list.ownerDocument?.scrollingElement ?? null;
		if (host && host !== doc) return;
		bind(resolveHost(list));
	};

	const onContentChange = () => {
		settleHost();
		if (pending !== null) applyRestore();
		else if (stuck) toBottom();
	};

	onContentChange();
	const unobserve = observeContent(list, onContentChange);

	return () => {
		unobserve();
		bind(null);
	};
}
