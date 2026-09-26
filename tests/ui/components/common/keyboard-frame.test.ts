// Where the keyboard leaves room, from readings taken in WKWebView: an iPhone 17
// Pro Max (956 tall, iOS 26 simulator) and an iPad Air 13 (1366 tall,
// docs/pitfall/392).

import { describe, expect, test } from "bun:test";
import { keyboardFrame, keyboardInset, type ViewportReading } from "../../../../src/ui/components/common/keyboard-frame";

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

describe("keyboardFrame", () => {
	test("no keyboard, no frame", () => {
		expect(keyboardFrame(PHONE_REST)).toBeNull();
		expect(keyboardFrame(at(800, 800, 0))).toBeNull();
	});

	test("a scrolled document: the frame starts where the scroll put the visible top", () => {
		expect(keyboardFrame(PHONE_SOFTWARE)).toEqual({ top: 413, height: 543 });
		expect(keyboardFrame(PHONE_HARDWARE)).toEqual({ top: 68, height: 888 });
		expect(keyboardFrame(IPAD_SHRUNK)).toEqual({ top: 403, height: 963 });
	});

	test("an unscrolled document with a short visual viewport: the frame starts at 0", () => {
		expect(keyboardFrame(IPAD_UNSHRUNK)).toEqual({ top: 0, height: 963 });
		expect(keyboardFrame(at(956, 543, 0))).toEqual({ top: 0, height: 543 });
	});

	test("the frame always ends on the keyboard's top edge", () => {
		for (const r of [PHONE_HARDWARE, PHONE_SOFTWARE, IPAD_UNSHRUNK, IPAD_SHRUNK]) {
			const frame = keyboardFrame(r);
			expect(frame).not.toBeNull();
			expect(frame!.top + frame!.height).toBe(r.vvOffsetTop + r.vvHeight);
		}
	});

	test("sub-pixel noise is not a keyboard", () => {
		expect(keyboardFrame(at(956, 955.5, 0.4))).toBeNull();
	});

	test("a pinch-zoomed page is not a keyboard", () => {
		expect(keyboardFrame(at(956, 478, 120, 2))).toBeNull();
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
