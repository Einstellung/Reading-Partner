// Reading a rendered reply off the DOM and putting a mark back on it
// (src/ui/components/chat/chat-mark-dom.ts).
//
// The one thing this has to get right is that the two directions agree: the
// string a mark's words are taken from when the pen draws is the string they
// are looked for in when the reply is drawn again, and an offset in it names
// the same characters both times. Selection.toString() is not that string — it
// puts a newline between block elements — so a round trip is asserted rather
// than assumed.
//
// Geometry is pure and asserted directly: a headless DOM lays nothing out, so
// the rects a Range would report are supplied.
//
// Run: bun test.
import { expect, test } from "bun:test";
import {
  boxesHold,
  indexRendered,
  markFill,
  offsetOf,
  paintBoxes,
  pointAt,
  rangeOfSpan,
  toBoxes,
  underlineBoxes,
  withAlpha,
  UNDERLINE_THICKNESS,
} from "../../../src/ui/components/chat/chat-mark-dom";
import { locateChatMark, occurrenceAt } from "../../../src/reading/chat-marks";
import { useDom } from "../../support/dom";

await useDom();

function body(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

test("the rendering is every text node in order, and nothing between the blocks", () => {
  const el = body("<p>attention heads</p><p>are three matrices</p>");
  const index = indexRendered(el);
  // No newline: a walk is what draws marks back, so it is what the pen counts
  // against. Selection.toString() would put one here and name a string the
  // rendering does not hold.
  expect(index.text).toBe("attention headsare three matrices");
  expect(index.runs).toHaveLength(2);
});

test("an empty text node claims no position", () => {
  const el = body("<p>one</p>");
  el.querySelector("p")!.appendChild(document.createTextNode(""));
  const index = indexRendered(el);
  expect(index.text).toBe("one");
  expect(index.runs).toHaveLength(1);
});

test("every offset survives the trip out to the DOM and back", () => {
  const el = body("<p>query <em>vector</em></p><p> and key</p>");
  const index = indexRendered(el);
  for (let at = 0; at <= index.text.length; at++) {
    const point = pointAt(index, at);
    expect(point).not.toBeNull();
    expect(offsetOf(index, point!.node, point!.offset)).toBe(at);
  }
});

test("a span becomes the Range over exactly those words", () => {
  const el = body("<p>query <em>vector</em> and key</p>");
  const index = indexRendered(el);
  const span = locateChatMark(index.text, { text: "vector and", occurrence: 0 });
  expect(span).not.toBeNull();
  const range = rangeOfSpan(index, span!, document)!;
  expect(range.toString()).toBe("vector and");
});

// A drag over a whole paragraph reports its endpoints as (element, childIndex),
// not as text-node positions. That is the shape the pen has to read a stroke
// from most often, so it is the one that must not come back null.
test("an element endpoint resolves to the words it stands in front of", () => {
  const el = body("<p>first line</p><p>second line</p>");
  const index = indexRendered(el);
  const first = el.querySelector("p")!;
  expect(offsetOf(index, first, 0)).toBe(0);
  // One past the last child: the end of that element's own words.
  expect(offsetOf(index, first, 1)).toBe("first line".length);
  expect(offsetOf(index, el, 1)).toBe("first line".length);
});

test("a position outside the rendering is not a position in it", () => {
  const index = indexRendered(body("<p>inside</p>"));
  const stray = document.createElement("p");
  stray.textContent = "elsewhere";
  expect(offsetOf(index, stray.firstChild, 0)).toBeNull();
  expect(pointAt(index, 99)).toBeNull();
});

// What the pen stores and what redraws the mark are the two halves of one
// round trip, and this is the case that breaks a naive one: the same phrase
// twice, and the second copy marked.
test("the copy that was drawn over is the copy that is drawn back", () => {
  const el = body("<p>a head is a head</p>");
  const index = indexRendered(el);
  const at = index.text.lastIndexOf("a head");
  const occurrence = occurrenceAt(index.text, "a head", at);
  expect(occurrence).toBe(1);
  const span = locateChatMark(index.text, { text: "a head", occurrence })!;
  expect(span.start).toBe(at);
  expect(rangeOfSpan(index, span, document)!.toString()).toBe("a head");
});

// --- what a mark is painted as ---------------------------------------------

const line = { left: 120, top: 240, width: 80, height: 20 };

test("the boxes are the rects moved into the drawing element's corner", () => {
  const boxes = toBoxes([line], { left: 100, top: 200 });
  expect(boxes).toEqual([{ left: 20, top: 40, width: 80, height: 20 }]);
});

// A Range that ends at a line break reports an empty rect, which would paint a
// dot where no words are.
test("an empty rect paints nothing", () => {
  expect(toBoxes([{ left: 0, top: 0, width: 0, height: 12 }], { left: 0, top: 0 })).toEqual([]);
});

test("a highlight fills the line and an underline rules under it", () => {
  const boxes = toBoxes([line], { left: 0, top: 0 });
  expect(paintBoxes(boxes, "highlight")).toEqual(boxes);
  const ruled = underlineBoxes(boxes);
  expect(ruled).toEqual([
    { left: 120, top: 240 + 20 - UNDERLINE_THICKNESS, width: 80, height: UNDERLINE_THICKNESS },
  ]);
  // The AI pen draws the same stroke the underline pen does.
  expect(paintBoxes(boxes, "ai")).toEqual(ruled);
  expect(paintBoxes(boxes, "underline")).toEqual(ruled);
});

test("a highlight is drawn through and the two underlines solid", () => {
  expect(markFill("#ffd400", "highlight")).toBe("rgba(255, 212, 0, 0.42)");
  expect(markFill("#ffd400", "underline")).toBe("#ffd400");
  expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  // A color from a build with another palette still has to draw something.
  expect(withAlpha("rebeccapurple", 0.5)).toBe("rebeccapurple");
});

// The 2px rule is not a target: what the reader presses is the words above it,
// so the press is tested against the line box and not against the paint.
test("a press lands on the line, not on the stroke", () => {
  const boxes = toBoxes([line], { left: 0, top: 0 });
  expect(boxesHold(boxes, 160, 245)).toBe(true);
  expect(boxesHold(boxes, 160, 259)).toBe(true);
  expect(boxesHold(boxes, 160, 300)).toBe(false);
  expect(boxesHold(boxes, 10, 245)).toBe(false);
});
