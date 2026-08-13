// Where a floating panel goes: given an anchor, the panel's measured size and
// the usable viewport, this returns the viewport coordinates of its top-left
// corner. Every floating panel that escapes its container (see
// docs/pitfall/68-overflow-x-auto-clips-the-other-axis.md) is `position: fixed`
// and has to place itself, so the arithmetic lives here instead of once per
// component.
//
// Coordinates are the ones `position: fixed` uses and `getBoundingClientRect()`
// returns. The viewport passed in is the usable one — on a device with a soft
// keyboard that is the visual viewport, which is shorter (useViewportSize).

import type { SafeAreaInsets } from "./safe-area";

// An anchor is anything with the four edges of a DOMRect, so a measured element
// goes in unchanged. A caret or a mark's corner is a zero-size rect: pointAnchor.
export interface AnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface PanelSize {
	width: number;
	height: number;
}

export interface ViewportSize {
	width: number;
	height: number;
}

// "below" hangs the panel under the anchor, centred on it, and flips above when
// it would overflow the bottom. "right" opens it beside the anchor, top-aligned,
// and flips to the other side when it would overflow the right edge.
export type Placement = "below" | "right";

export interface PlacePanelOptions {
	anchor: AnchorRect;
	panel: PanelSize;
	viewport: ViewportSize;
	placement?: Placement;
	// Distance from the anchor to the panel.
	gap?: number;
	// Smallest distance from the panel to a viewport edge. One number is the same
	// distance on all four; SafeAreaInsets is the per-edge form a device with a
	// notch or a home indicator needs, and is what useOverlaySafePadding hands
	// over (docs/pitfall/74). Where there is no inset that hook already reports
	// the 8px gutter, so a per-edge margin degrades to the uniform one.
	margin?: number | SafeAreaInsets;
}

function edges(margin: number | SafeAreaInsets): SafeAreaInsets {
	return typeof margin === "number"
		? { top: margin, right: margin, bottom: margin, left: margin }
		: margin;
}

export function pointAnchor(x: number, y: number): AnchorRect {
	return { left: x, top: y, right: x, bottom: y };
}

// A panel larger than the viewport cannot honour both margins. The start edge
// wins: it stays on screen and the overflow goes off the far side, where a
// scroll or a rotate can still reach it.
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

export function placePanel({
	anchor,
	panel,
	viewport,
	placement = "below",
	gap = 0,
	margin = 0,
}: PlacePanelOptions): { left: number; top: number } {
	const m = edges(margin);
	const maxLeft = viewport.width - panel.width - m.right;
	const maxTop = viewport.height - panel.height - m.bottom;

	if (placement === "below") {
		const centre = (anchor.left + anchor.right) / 2;
		const left = clamp(centre - panel.width / 2, m.left, maxLeft);
		let top = anchor.bottom + gap;
		if (top > maxTop) {
			// No room below. Above the anchor if the panel fits there whole,
			// otherwise as low as the viewport allows.
			const above = anchor.top - gap - panel.height;
			top = above >= m.top ? above : maxTop;
		}
		return { left, top: clamp(top, m.top, maxTop) };
	}

	let left = anchor.right + gap;
	if (left > maxLeft) {
		const before = anchor.left - gap - panel.width;
		left = before >= m.left ? before : maxLeft;
	}
	return { left: clamp(left, m.left, maxLeft), top: clamp(anchor.top, m.top, maxTop) };
}

// A fixed-width panel shrunk to fit a viewport narrower than it (a phone). Never
// negative, so a degenerate viewport reading cannot produce an invalid width.
export function fitPanelWidth(
	preferred: number,
	viewportWidth: number,
	margin: number | SafeAreaInsets = 0,
): number {
	const m = edges(margin);
	return Math.max(0, Math.min(preferred, viewportWidth - m.left - m.right));
}
