// Where a chat transcript's scroll position goes, and when it moves on its own.
//
// Opening a chat lands on its newest message. Scrolling once on mount is not
// enough for that: markdown, cards, images and fonts all settle after the first
// paint and make the list taller, leaving a one-shot scroll in the middle of the
// history. So while the list is opening it is pinned: each growth takes it back
// to the bottom, until the reader scrolls up, and coming back to the bottom pins
// it again. The opening ends when the conversation itself changes (`release`,
// called by the list when a row is added or the last one changes).
//
// After that nothing that arrives moves the list. A reply streaming in, a new
// message or a card landing below the visible area leaves the reader where they
// are reading, and turns on "new content below" (`onBelow`) instead, which the
// list draws as a down-arrow. Tapping it (`jumpToLatest`) scrolls to the bottom
// once and clears it; reaching the bottom by hand clears it too. Neither pins
// the list again: later growth turns the arrow back on.
//
// The one move the list makes for a new message is when the reader sends one
// (`revealSent`): it scrolls once so their message sits near the top, with room
// held open under it (`setRoom`) for the reply to write into. The room shrinks
// as the reply fills it, so the reply grows in view without the list moving; a
// reply longer than the room grows past the bottom edge and turns the arrow on.
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
// pins a list with nothing remembered, and the opening pin starts from the
// remembered state so that first growth does not drag the reader off the place.
// The browser echoes that write back as a scroll like any other: a write that
// landed whole records the place that was already stored, and a write clamped
// short — the list has not settled to its full height yet — records the bottom
// over it and leaves the reader on the newest message, where a list with no
// memory leaves them.
//
// The container can change size under a list too: the phone's soft keyboard
// shortens the whole shell (docs/pitfall/443), and the scroller loses height at
// its bottom with no scroll and no content change. That is layout, not new
// content: a list that was at its bottom is taken back to it, and one the reader
// scrolled up keeps its offset, which keeps what it showed at its top where it
// was.

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
	/** Subscribes to the scrolling element's own size. Injected by the tests. */
	observeHost?(host: ScrollHost, onChange: () => void): () => void;
	/** Where this list was left, if it is one that is remembered. Null = the bottom. */
	restore?(): StickPosition | null;
	/** Records where the reader is. Called on every scroll of theirs. */
	remember?(at: StickPosition): void;
	/** Told when content below what the reader can see appears or is reached. */
	onBelow?(below: boolean): void;
	/**
	 * Sizes the empty room under the last row that lets a sent message rise to
	 * the top. Absent where the list's height is its content's (the capped
	 * bubble): room there would only make the list taller.
	 */
	setRoom?(px: number): void;
	/** Where `el` starts in the host's content, in px. Injected by the tests. */
	offsetOf?(host: ScrollHost, el: Element): number;
	/** How far below the host's top a sent message is put. Injected by the tests. */
	topInset?(host: ScrollHost): number;
}

const DEFAULT_THRESHOLD = 40;

const SCROLLABLE = new Set(["auto", "scroll", "overlay"]);

// Whether this element is the one that scrolls: it must both be allowed to and
// have something to scroll. The allowance alone is not a test — an element can
// carry overflow-y:auto with nothing to scroll, while it is an ancestor that is
// height-constrained and therefore the one that actually scrolls.
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

// The bindings by the list they were made on, so a view can reach the one its
// element sits in: to hold it somewhere else (holdInView), to show a sent message
// (revealSent), to end its opening (releaseOpening) or to go to its newest
// content (jumpToLatest).
interface Pin {
	hold(place: (host: ScrollHost) => void): void;
	reveal(row: Element): void;
	release(): void;
	jump(smooth: boolean): void;
}
const pins = new WeakMap<Element, Pin>();

function pinOf(el: Element): Pin | null {
	for (let node: Element | null = el; node; node = node.parentElement) {
		const pin = pins.get(node);
		if (pin) return pin;
	}
	return null;
}

// Puts `el` in the middle of the host, by assigning scrollTop (instant, as in
// toBottom). The page's own scroller reports its box from the document's top.
function centre(host: ScrollHost, el: Element): void {
	if (!(host instanceof Element)) return;
	const box = el.getBoundingClientRect();
	const top = host === host.ownerDocument?.scrollingElement ? 0 : host.getBoundingClientRect().top;
	host.scrollTop += box.top - top - (host.clientHeight - box.height) / 2;
}

/**
 * Holds the pinned list `el` is in on `el` rather than on its newest content:
 * `el` is put in the middle now and again on every growth until the reader
 * scrolls, which hands the list back to them. Cards and markdown settling after
 * the scroll would otherwise take a list still counted as pinned back to the
 * bottom. A view opening a conversation at one of its rows uses this. Outside a
 * pinned list `el` is only scrolled into view. `place` is injected by the tests.
 */
export function holdInView(el: Element, place?: (host: ScrollHost) => void): void {
	const pin = pinOf(el);
	if (pin) pin.hold(place ?? ((host) => centre(host, el)));
	else el.scrollIntoView({ block: "center" });
}

/**
 * Ends the opening of the list `list`: from here on growth never moves it. The
 * list calls this when the conversation changes, which settling never does.
 */
export function releaseOpening(list: Element): void {
	pins.get(list)?.release();
}

/**
 * Scrolls once so `row`, the message the reader just sent, sits near the top of
 * its list, and keeps room open under it for the reply. Ends the opening.
 */
export function revealSent(row: Element): void {
	const pin = pinOf(row);
	if (pin) pin.reveal(row);
	else row.scrollIntoView({ block: "start" });
}

/**
 * Takes the list to its bottom and clears "new content below". Smooth unless the
 * reader asked for reduced motion; `smooth` is injected by the tests. The list is
 * not pinned by it: later growth turns the arrow back on.
 */
export function jumpToLatest(list: Element, smooth?: boolean): void {
	const view = list.ownerDocument?.defaultView;
	const reduced = view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	pins.get(list)?.jump(smooth ?? !reduced);
}

function observeHostDefault(host: ScrollHost, onChange: () => void): () => void {
	if (typeof ResizeObserver === "undefined" || !(host instanceof Element)) return () => {};
	const ro = new ResizeObserver(() => onChange());
	ro.observe(host);
	return () => ro.disconnect();
}

// Where `el` starts in the scrolling content of `host`, from the two boxes. The
// page's own scroller reports its box from the document's top.
function offsetOfDefault(host: ScrollHost, el: Element): number {
	if (!(host instanceof Element)) return 0;
	const top = host === host.ownerDocument?.scrollingElement ? 0 : host.getBoundingClientRect().top;
	return el.getBoundingClientRect().top - top + host.scrollTop;
}

// The host's own top padding: what the transcript keeps clear above its first
// row (the corner card in the call window) is what a sent message keeps clear.
function topInsetDefault(host: ScrollHost): number {
	if (!(host instanceof Element)) return 0;
	const view = host.ownerDocument?.defaultView;
	return view ? Number.parseFloat(view.getComputedStyle(host).paddingTop) || 0 : 0;
}

/**
 * Binds `list` to the contract above: pinned to its bottom while it opens, still
 * under new content after that. Returns the teardown.
 */
export function stickToBottom(list: Element, options: StickOptions = {}): () => void {
	const threshold = options.threshold ?? DEFAULT_THRESHOLD;
	const resolveHost = options.resolveHost ?? ((el: Element) => scrollableAncestor(el) as ScrollHost | null);
	const observeContent = options.observeContent ?? observeContentDefault;
	const observeHost = options.observeHost ?? observeHostDefault;
	const offsetOf = options.offsetOf ?? offsetOfDefault;
	const topInset = options.topInset ?? topInsetDefault;

	const saved = options.restore?.() ?? null;
	let host: ScrollHost | null = null;
	// Whether the list is still opening, the one time growth moves it.
	let opening = true;
	// While opening: whether the list follows its newest content. Seeded from the
	// memory: started at true it would drag a reader who left mid-history to the
	// newest message on the first growth after the place was written.
	let stuck = saved ? saved.stuck : true;
	// The place to go back to, until the first pass writes it. Null for a list left
	// at the bottom: that comes back as the pin, not as an offset.
	let place = saved && !saved.stuck ? saved.top : null;
	// The heights the last scroll event was measured against, the content's and
	// the container's. A scroll that comes with either changed came from the
	// layout, not from the reader.
	let seenHeight = 0;
	let seenClient = 0;
	// The content height the last content change was measured against: growth is
	// what turns "new content below" on.
	let contentHeight = 0;
	// What the list is held on instead of its bottom (holdInView), and where the
	// hold last put it: the echo of that write is not the reader scrolling.
	let held: ((host: ScrollHost) => void) | null = null;
	let heldAt = 0;
	// Whether the reader was at the bottom when last looked: a container that
	// shrinks under a reader at the bottom keeps them there.
	let atBottom = stuck;
	let below = false;
	// The sent message the room under the last row is kept for, and its size.
	let anchor: Element | null = null;
	let room = 0;
	let unobserveHost = () => {};

	const distance = () => (host ? host.scrollHeight - host.clientHeight - host.scrollTop : 0);
	const setBelow = (next: boolean) => {
		if (next === below) return;
		below = next;
		options.onBelow?.(next);
	};
	// Reads where the reader is now. At the bottom there is nothing below.
	const look = () => {
		atBottom = distance() <= threshold;
		if (atBottom) setBelow(false);
	};
	const measured = () => {
		if (!host) return;
		seenHeight = host.scrollHeight;
		seenClient = host.clientHeight;
	};

	const onScroll = () => {
		if (!host) return;
		const height = host.scrollHeight;
		const client = host.clientHeight;
		const resized = client !== seenClient;
		const grew = height !== seenHeight || resized;
		const wasAtBottom = atBottom;
		seenHeight = height;
		seenClient = client;
		if (held) {
			if (grew) {
				toHeld();
				return;
			}
			if (Math.abs(host.scrollTop - heldAt) <= 1) return;
			// The reader scrolled: the list is theirs again.
			held = null;
		}
		// A pinned list whose height moved under it: the browser may report that as
		// a scroll (anchoring), and reading the distance then would unpin it.
		if (opening && grew && stuck) {
			toBottom();
			return;
		}
		// The container changed size under a reader at the bottom (the keyboard),
		// reported as a scroll before the resize is seen.
		if (!opening && resized && wasAtBottom) {
			fitRoom();
			toBottom();
			return;
		}
		look();
		if (opening) stuck = atBottom;
		// The one place the position is both the reader's and known to belong to
		// the key this binding was made with. Teardown cannot do it: React runs the
		// old cleanup after the next conversation's rows are already in the DOM.
		options.remember?.({ top: host.scrollTop, stuck: atBottom });
	};

	const bind = (next: ScrollHost | null) => {
		if (next === host) return;
		host?.removeEventListener("scroll", onScroll);
		unobserveHost();
		unobserveHost = () => {};
		host = next;
		host?.addEventListener("scroll", onScroll);
		if (host) unobserveHost = observeHost(host, onHostResize);
		seenHeight = host?.scrollHeight ?? 0;
		seenClient = host?.clientHeight ?? 0;
	};

	function onHostResize() {
		fitRoom();
		if (held) toHeld();
		else if (opening ? stuck : atBottom) toBottom();
	}
	function toHeld() {
		if (!host || !held) return;
		held(host);
		heldAt = host.scrollTop;
		measured();
		look();
	}

	function toBottom() {
		if (!host) return;
		// Assigning scrollTop is the instant scroll; scrollIntoView would animate
		// under `scroll-behavior: smooth` and never catch a list that keeps growing.
		host.scrollTop = host.scrollHeight - host.clientHeight;
		measured();
		atBottom = true;
		setBelow(false);
	}

	// Keeps the room under the last row just tall enough for the sent message to
	// sit at its place at the top: the reply fills the room as it grows, and the
	// content's height only moves once the reply is longer than the room.
	function fitRoom() {
		if (!host || !anchor || !options.setRoom) return;
		if (anchor.isConnected === false) anchor = null;
		const want = anchor ? offsetOf(host, anchor) - topInset(host) : 0;
		const bare = host.scrollHeight - room;
		const next = anchor ? Math.max(0, Math.ceil(want + host.clientHeight - bare)) : 0;
		if (next === room) return;
		room = next;
		options.setRoom(next);
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
		fitRoom();
		const height = host?.scrollHeight ?? 0;
		const grew = height > contentHeight;
		contentHeight = height;
		if (held) {
			toHeld();
			if (!opening && grew && !atBottom) setBelow(true);
			return;
		}
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
		if (opening) {
			if (stuck) toBottom();
			return;
		}
		if (!grew) return;
		look();
		if (!atBottom) setBelow(true);
	};

	onContentChange();
	const unobserve = observeContent(list, onContentChange);

	const release = () => {
		opening = false;
		stuck = false;
	};
	pins.set(list, {
		hold(at) {
			held = at;
			stuck = false;
			// A remembered place not yet written is overruled by the row asked for.
			place = null;
			settleHost();
			toHeld();
		},
		release,
		reveal(row) {
			release();
			held = null;
			place = null;
			settleHost();
			if (!host) return;
			anchor = row;
			fitRoom();
			host.scrollTop = offsetOf(host, row) - topInset(host);
			measured();
			look();
		},
		jump(smooth) {
			held = null;
			if (opening) stuck = true;
			setBelow(false);
			if (!host) return;
			const top = host.scrollHeight - host.clientHeight;
			if (smooth && host instanceof Element) host.scrollTo({ top, behavior: "smooth" });
			else toBottom();
		},
	});
	return () => {
		pins.delete(list);
		unobserve();
		bind(null);
		anchor = null;
		if (room) options.setRoom?.(0);
		room = 0;
	};
}

