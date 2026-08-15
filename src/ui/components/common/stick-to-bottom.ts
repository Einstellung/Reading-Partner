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

/** The part of a scroll container this needs. An Element satisfies it. */
export interface ScrollHost {
	scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
	addEventListener(type: "scroll", handler: () => void): void;
	removeEventListener(type: "scroll", handler: () => void): void;
}

export interface StickOptions {
	/** How far above the bottom still counts as being at the bottom, in px. */
	threshold?: number;
	/** The scrolling element. Injected by the tests; found by the walk otherwise. */
	resolveHost?(list: Element): ScrollHost | null;
	/** Subscribes to whatever changes the rendered height. Injected by the tests. */
	observeContent?(list: Element, onChange: () => void): () => void;
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

	let host: ScrollHost | null = null;
	let stuck = true;
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
		if (stuck) toBottom();
	};

	onContentChange();
	const unobserve = observeContent(list, onContentChange);

	return () => {
		unobserve();
		bind(null);
	};
}
