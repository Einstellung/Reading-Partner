// The rehearsal panel, pinned by a static render (docs/44): one block of the
// note on screen, the through-line above it, and where the talk goes next below
// it. What any of it means is decided in
// src/ui/components/rehearsal/outline-run.ts and tested there. Run: bun test.

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

test("the panel opens on the first block, with the through-line above it", () => {
  const html = render([
    segment({ id: "a", body: "## Opening\n\nAttention replaced recurrence" }),
    segment({ id: "b", body: "## The turn\n\nand it cost quadratic time" }),
  ]);
  expect(html).toContain("Recurrence was the bottleneck.");
  expect(html).toContain("Attention replaced recurrence");
  // One block at a time: the next one is not on screen with it.
  expect(html).not.toContain("and it cost quadratic time");
});

// The hard part of giving a talk is the turn, so where it goes next is on screen
// the whole time the current segment is being said (docs/44).
test("the panel says what comes next, and says when nothing does", () => {
  expect(render([segment({ id: "a" }), segment({ id: "b", body: "## The turn" })])).toContain(
    "Next: The turn",
  );
  expect(render([segment({ id: "a" })])).toContain("Last segment");
});

test("a talk with nothing arranged on it says so rather than showing a blank", () => {
  expect(render([])).toContain("no segments yet");
});
