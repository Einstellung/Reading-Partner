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
// place is read once at the bind and written once, in the same first pass that
// pins a list with nothing remembered, and the pin starts from the remembered
// state so that first growth does not drag the reader off the place. The browser
// echoes that write back as a scroll like any other: a write that landed whole
// records the place that was already stored, and a write clamped short — the
// list has not settled to its full height yet — records the bottom over it and
// leaves the reader on the newest message, where a list with no memory leaves
// them. Without the two seams this module is the pin it was before them.

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
	/** Where this list was left, if it is one that is remembered. Null = the bottom. */
	restore?(): StickPosition | null;
	/** Records where the reader is. Called on every scroll of theirs. */
	remember?(at: StickPosition): void;
}

const DEFAULT_THRESHOLD = 40;

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

	const saved = options.restore?.() ?? null;
	let host: ScrollHost | null = null;
	// Whether the list follows its newest content. Seeded from the memory: started
	// at true it would drag a reader who left mid-history to the newest message on
	// the first growth after the place was written.
	let stuck = saved ? saved.stuck : true;
	// The place to go back to, until the first pass writes it. Null for a list left
	// at the bottom: that comes back as the pin, not as an offset.
	let place = saved && !saved.stuck ? saved.top : null;
	// The height the last scroll event was measured against. A scroll that comes
	// with a changed height came from the content, not from the reader.
	let seenHeight = 0;

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
	};

	function toBottom() {
		if (!host) return;
		// Assigning scrollTop is the instant scroll; scrollIntoView would animate
		// under `scroll-behavior: smooth` and never catch a list that keeps growing.
		host.scrollTop = host.scrollHeight - host.clientHeight;
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
		// The place is written on the pass that pins a list with nothing remembered,
		// and let go of there. The pin is off from here, so the settling that
		// follows leaves the reader on the place.
		//
		// Never on the page the walk falls back to while nothing has been laid out
		// (settleHost above): spending the place there scrolls something that is not
		// the transcript, and the transcript opens at its oldest message. The next
		// pass, once the real container overflows, is the one that writes it.
		if (place !== null && host && host !== list.ownerDocument?.scrollingElement) {
			host.scrollTop = place;
			place = null;
			return;
		}
		if (stuck) toBottom();
	};

	onContentChange();
	const unobserve = observeContent(list, onContentChange);

	return () => {
		unobserve();
		bind(null);
	};
}
