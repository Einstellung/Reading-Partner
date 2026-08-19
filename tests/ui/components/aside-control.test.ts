// Where the control a selection raises is placed
// (src/ui/components/chat/aside-control.ts). The one thing this has to get
// right is invisible to the page it runs in: WebKit's own callout bar is a
// native view, so the only guard against overlapping it is arithmetic against
// the band it was measured to take (docs/pitfall/119).
//
// Run: bun test.
import { expect, test } from "bun:test";
import {
	asideControlAnchor,
	ASIDE_CONTROL_GAP,
	ASIDE_CONTROL_HEIGHT,
	ASIDE_CONTROL_WIDTH,
	CALLOUT_BAND,
	CALLOUT_BAR_GAP,
	CALLOUT_BAR_HEIGHT,
} from "../../../src/ui/components/chat/aside-control";

// One word on one line, the shape a long press produces.
const WORD = { left: 197, right: 231, bottom: 583 };

test("the control is centred on the selection", () => {
	const at = asideControlAnchor(WORD);
	expect(at.x + ASIDE_CONTROL_WIDTH / 2).toBe((WORD.left + WORD.right) / 2);
});

test("the control clears the band the callout takes below the selection", () => {
	const at = asideControlAnchor(WORD);
	const callout = { top: WORD.bottom + CALLOUT_BAR_GAP, bottom: WORD.bottom + CALLOUT_BAND };
	expect(at.y).toBeGreaterThanOrEqual(callout.bottom);
	expect(at.y - callout.bottom).toBe(ASIDE_CONTROL_GAP);
});

// The same selection with the bar on the other side: it takes the band above
// instead, which the control is nowhere near.
test("the control clears the band the callout takes above the selection", () => {
	const at = asideControlAnchor(WORD);
	const top = WORD.bottom - 20;
	const callout = { top: top - CALLOUT_BAND, bottom: top - CALLOUT_BAR_GAP };
	expect(at.y).toBeGreaterThan(callout.bottom);
});

// The regression this exists for: 8px under the selection put the control
// inside the bar for its whole width and all but 7px of its height.
test("a control placed straight under the selection would be covered", () => {
	const naive = WORD.bottom + ASIDE_CONTROL_GAP;
	const callout = { top: WORD.bottom + CALLOUT_BAR_GAP, bottom: WORD.bottom + CALLOUT_BAND };
	const covered = Math.min(naive + ASIDE_CONTROL_HEIGHT, callout.bottom) - Math.max(naive, callout.top);
	expect(covered).toBe(37);
	expect(asideControlAnchor(WORD).y).toBeGreaterThan(callout.bottom);
});

test("the callout's band is its height plus its distance from the selection", () => {
	expect(CALLOUT_BAND).toBe(CALLOUT_BAR_GAP + CALLOUT_BAR_HEIGHT);
});
