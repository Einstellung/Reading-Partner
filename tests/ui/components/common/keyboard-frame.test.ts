// Where the keyboard leaves room, from readings taken in WKWebView: an iPhone 17
// Pro Max (956 tall, iOS 26 simulator) and an iPad Air 13 (1366 tall,
// docs/pitfall/392).

import { describe, expect, test } from "bun:test";
import { coveredPadding, keyboardFrame, keyboardInset, type ViewportReading } from "../../../../src/ui/components/common/keyboard-frame";

const at = (innerHeight: number, vvHeight: number, vvOffsetTop: number, vvScale = 1): ViewportReading => ({
	innerHeight,
	vvHeight,
	vvOffsetTop,
	vvScale,
});

const PHONE_REST = at(956, 956, 0);
// innerHeight shrinks with the visual viewport and the document scrolls up.
const PHONE_HARDWARE = at(888, 888, 68);
const PHONE_SOFTWARE = at(543, 543, 413);
// The iPad after an app switch: only the visual viewport shrinks.
const IPAD_UNSHRUNK = at(1366, 963, 0);
const IPAD_SHRUNK = at(963, 963, 403);

// The shell is laid out at the page's full height whatever the keyboard does.
const PHONE_H = 956;
const IPAD_H = 1366;

describe("keyboardFrame", () => {
	test("no keyboard, no frame", () => {
		expect(keyboardFrame(PHONE_REST, PHONE_H)).toBeNull();
		expect(keyboardFrame(at(800, 800, 0), 800)).toBeNull();
	});

	test("a scrolled document: the shell moves to where the scroll put the visible top", () => {
		expect(keyboardFrame(PHONE_SOFTWARE, PHONE_H)).toEqual({ top: 413, covered: 413 });
		expect(keyboardFrame(PHONE_HARDWARE, PHONE_H)).toEqual({ top: 68, covered: 68 });
		expect(keyboardFrame(IPAD_SHRUNK, IPAD_H)).toEqual({ top: 403, covered: 403 });
	});

	test("an unscrolled document with a short visual viewport: the shell stays, its bottom is covered", () => {
		expect(keyboardFrame(IPAD_UNSHRUNK, IPAD_H)).toEqual({ top: 0, covered: 403 });
		expect(keyboardFrame(at(956, 543, 0), PHONE_H)).toEqual({ top: 0, covered: 413 });
	});

	test("what is left uncovered, from the moved top, is exactly the visible part", () => {
		for (const [r, h] of [
			[PHONE_HARDWARE, PHONE_H],
			[PHONE_SOFTWARE, PHONE_H],
			[IPAD_UNSHRUNK, IPAD_H],
			[IPAD_SHRUNK, IPAD_H],
		] as const) {
			const frame = keyboardFrame(r, h);
			expect(frame).not.toBeNull();
			expect(h - frame!.covered).toBe(r.vvHeight);
			expect(frame!.top).toBe(r.vvOffsetTop);
		}
	});

	test("sub-pixel noise is not a keyboard", () => {
		expect(keyboardFrame(at(956, 955.5, 0.4), PHONE_H)).toBeNull();
	});

	test("a pinch-zoomed page is not a keyboard", () => {
		expect(keyboardFrame(at(956, 478, 120, 2), PHONE_H)).toBeNull();
	});
});

describe("keyboardInset", () => {
	test("0 when the document scroll already brought the bottom into view", () => {
		// Why the phone's composer never rose: the old padding was all this.
		expect(keyboardInset(PHONE_HARDWARE)).toBe(0);
		expect(keyboardInset(PHONE_SOFTWARE)).toBe(0);
		expect(keyboardInset(IPAD_SHRUNK)).toBe(0);
	});

	test("the covered height when only the visual viewport shrank", () => {
		expect(keyboardInset(IPAD_UNSHRUNK)).toBe(403);
	});

	test("0 with no keyboard (desktop, iPad at rest)", () => {
		expect(keyboardInset(PHONE_REST)).toBe(0);
		expect(keyboardInset(at(1366, 1366, 0))).toBe(0);
		expect(keyboardInset(at(956, 955.5, 0))).toBe(0);
	});
});

test("the docked view's padding leaves out the home indicator's inset it already ends above", () => {
	expect(coveredPadding(413)).toBe("max(0px, calc(413px - env(safe-area-inset-bottom)))");
});
