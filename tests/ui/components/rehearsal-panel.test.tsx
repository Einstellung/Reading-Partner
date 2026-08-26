// The rehearsal surface, pinned by a static render (docs/44): the whole note in
// order on one page, the through-line above it, and nothing that pages or moves
// it. What a pass does with what was said is decided in
// src/ui/components/rehearsal/rehearsal.ts and tested there. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Rehearsal } from "../../../src/reading/rehearsal";
import type { TalkOutline, TalkSegment } from "../../../src/reading/talk";
import { emptySpine } from "../../../src/reading/talk";
import { useDom } from "../../support/dom";

// Same reason as outline-pane.test.tsx: the view pulls react-dom's client
// bundle in through its primitives, and react-dom decides at module evaluation
// whether it is in a browser and never reconsiders (docs/pitfall/121, 175).
await useDom();

const { default: RehearsalView } = await import(
  "../../../src/ui/components/rehearsal/RehearsalView"
);

const rehearsal: Rehearsal = {
  version: 1,
  id: "1754400000000",
  topicId: "t1",
  name: "Attention",
  outlineId: "o1",
  retellId: null,
  createdAt: 0,
  updatedAt: 0,
};

function segment(over: Partial<TalkSegment> = {}): TalkSegment {
  return { id: "s1", body: "## Opening", updatedAt: 0, ...over };
}

function outline(segments: TalkSegment[], thesis = "Recurrence was the bottleneck."): TalkOutline {
  return {
    version: 1,
    id: "o1",
    topicId: "t1",
    retellId: null,
    name: "A short talk",
    spine: { ...emptySpine(), thesis },
    segments,
    createdAt: 0,
    updatedAt: 0,
  };
}

function render(segments: TalkSegment[], thesis?: string): string {
  return renderToStaticMarkup(
    <RehearsalView
      rehearsal={rehearsal}
      outline={outline(segments, thesis)}
      backLabel="Back to the topic"
      onExit={() => {}}
      onSaved={() => {}}
    />,
  );
}

const NOTE = [
  segment({ id: "a", body: "## Opening\n\nAttention replaced recurrence" }),
  segment({ id: "b", body: "## The turn\n\nand it cost quadratic time" }),
  segment({ id: "c", body: "## Closing\n\nso here is where that leaves us" }),
];

// The whole point of the surface: the reader can see where they are going and
// start or stop anywhere, which needs every block on the page at once.
test("the note is on the page whole, in the order it is given", () => {
  const html = render(NOTE);
  expect(html).toContain("Recurrence was the bottleneck.");
  const at = (text: string) => html.indexOf(text);
  expect(at("Attention replaced recurrence")).toBeGreaterThan(0);
  expect(at("and it cost quadratic time")).toBeGreaterThan(at("Attention replaced recurrence"));
  expect(at("so here is where that leaves us")).toBeGreaterThan(at("and it cost quadratic time"));
});

// A block is told from the next one by the space between them. A frame, a
// number or a status chip would make the note a list of cards, which is the
// shape that was just taken out.
test("the blocks carry no numbering and no chrome of their own", () => {
  const html = render(NOTE);
  expect(html).not.toContain("Next:");
  expect(html).not.toContain("Segments");
  expect(html).not.toContain(">Next<");
  expect(html).not.toContain("Last segment");
  expect(html).not.toContain("1 / 3");
});

// The bar is what stays: the way out, what this talk is, how long it has been
// going, and the way to stop.
test("the bar holds the way out, the name and the clock", () => {
  const html = render(NOTE);
  expect(html).toContain("Back to the topic");
  expect(html).toContain("A short talk");
  expect(html).toContain("0:00");
  expect(html).toContain("End the rehearsal");
});

// A formula wider than the measure scrolls in its own box rather than taking the
// page sideways with it, which would lose the reader's place in every block.
test("a display formula scrolls inside itself", () => {
  expect(render(NOTE)).toContain("katex-display]:overflow-x-auto");
});

test("a talk with nothing arranged on it says so rather than showing a blank", () => {
  expect(render([])).toContain("no segments yet");
});
