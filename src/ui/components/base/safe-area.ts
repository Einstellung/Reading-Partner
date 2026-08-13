// The safe-area insets as numbers, for the overlays whose clamping happens in
// JS instead of CSS.
//
// A centred overlay clamps itself in CSS (`overlay-safe`), so it never needs
// this. An anchored one cannot: Radix's popper decides where the box goes and
// takes its margin from the viewport as a JS number (`collisionPadding`). JS
// cannot read `env()` — a custom property holding `env(safe-area-inset-top)`
// comes back from getComputedStyle as that unresolved token stream. What can be
// read is a resolved length, so a hidden probe element carries the insets as
// padding (`.safe-probe` in styles.css) and its computed padding is the answer.

export interface SafeAreaInsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export const NO_SAFE_AREA: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

// A computed length as getComputedStyle hands it over: "0px", "44px", "" on a
// document that never laid the probe out. Anything unparseable is no inset,
// which is what every desktop browser reports anyway.
function px(value: string): number {
	const n = Number.parseFloat(value);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export function insetsFromPadding(padding: {
	paddingTop: string;
	paddingRight: string;
	paddingBottom: string;
	paddingLeft: string;
}): SafeAreaInsets {
	return {
		top: px(padding.paddingTop),
		right: px(padding.paddingRight),
		bottom: px(padding.paddingBottom),
		left: px(padding.paddingLeft),
	};
}

// The gap an overlay keeps from the viewport edge where there is no inset. Same
// 2 spacing units the `anchor-safe` utility uses, and taken as max() rather than
// added to the inset for the reason given in styles.css: an inset already clears
// the notch or the home indicator.
export const OVERLAY_GUTTER = 8;

export function safeCollisionPadding(insets: SafeAreaInsets, gutter = OVERLAY_GUTTER): SafeAreaInsets {
	return {
		top: Math.max(insets.top, gutter),
		right: Math.max(insets.right, gutter),
		bottom: Math.max(insets.bottom, gutter),
		left: Math.max(insets.left, gutter),
	};
}

export function sameInsets(a: SafeAreaInsets, b: SafeAreaInsets): boolean {
	return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

// One forced layout per call. Callers measure on mount and on resize, not per
// frame, and compare with sameInsets before re-rendering anything.
export function measureSafeAreaInsets(doc: Document = document): SafeAreaInsets {
	const host = doc.body ?? doc.documentElement;
	if (!host) return NO_SAFE_AREA;
	const probe = doc.createElement("div");
	probe.className = "safe-probe";
	probe.setAttribute("aria-hidden", "true");
	host.appendChild(probe);
	try {
		return insetsFromPadding(getComputedStyle(probe));
	} finally {
		probe.remove();
	}
}
