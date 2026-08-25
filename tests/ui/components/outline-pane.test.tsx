// The outline beside the retell, pinned by a static render: the running
// order is numbered, a cut entry stays visible without a number, and the ends of
// the list cannot be moved further out. What the rows mean is decided in
// src/reading/retell/outline.ts and tested there. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutlineRow } from "../../../src/reading/retell";
import { useDom } from "../../support/dom";

// The pane comes in after the window. It hangs a dropdown menu off its rows,
// and that Radix package reaches for a portal, which pulls react-dom's client
// bundle — and react-dom decides at module evaluation whether it is in a
// browser and never reconsiders (docs/pitfall/121).
//
// Static imports are evaluated before any top-level await,
// so importing it the ordinary way evaluates that bundle with no window in
// scope and every useDom() in the run then throws — harmless only for as long
// as this file happens to run late (docs/pitfall/175). Nothing below needs a
// DOM; the window is here so react-dom's feature detection lands where it would
// have landed if this file had never run.
await useDom();

const { default: OutlinePane } = await import("../../../src/ui/components/retell/OutlinePane");

const rows: OutlineRow[] = [
  {
    key: "b1#1",
    bookId: "b1",
    chapter: 1,
    title: "Openings",
    bookLabel: null,
    include: true,
    points: ["the 1962 data does the work"],
    figure: "[fig:3]",
    position: 1,
  },
  {
    key: "b1#2",
    bookId: "b1",
    chapter: 2,
    title: "Middlegame",
    bookLabel: null,
    include: false,
    points: [],
    position: null,
  },
  {
    key: "b2#1",
    bookId: "b2",
    chapter: 1,
    title: "Retina",
    bookLabel: "Vision",
    include: true,
    points: [],
    position: 2,
  },
];

function render(list: OutlineRow[]) {
  return renderToStaticMarkup(
    <OutlinePane
      rows={list}
      onMove={() => {}}
      onSetIncluded={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
    />,
  );
}

test("the entries are there with their points, figure and book", () => {
  const html = render(rows);
  expect(html).toContain("Openings");
  expect(html).toContain("the 1962 data does the work");
  expect(html).toContain("Figure: [fig:3]");
  // Only shown when the retell has more than one material.
  expect(html).toContain("Vision");
});

// A cut chapter is a settled question, so it stays in the list — but it has no
// number in the running order.
test("a cut entry keeps its place and loses its number", () => {
  const html = render(rows);
  expect(html.indexOf("Middlegame")).toBeGreaterThan(-1);
  expect(html).toContain("line-through");
  expect(html).toContain(">—<");
});

test("the ends of the list cannot be moved further out", () => {
  const html = render(rows);
  expect(html).toContain('aria-label="Move &quot;Openings&quot; up" disabled');
  expect(html).toContain('aria-label="Move &quot;Retina&quot; down" disabled');
});

test("an empty outline says what will land there, not nothing", () => {
  expect(render([])).toContain("Nothing settled yet");
});

// The rehearsals at the foot of the pane: a retell that has been given has
// somewhere to show it, and a retell that has not says so instead of hiding.
test("the passes through the retell are counted at the foot", () => {
  const run = {
    id: "r1",
    ordinal: 1,
    rehearsalId: "t1",
    deckFile: "slides/t1-x.html",
    startedAt: Date.now(),
    endedAt: null,
    lastMomentAt: Date.now(),
    segmentIds: [],
    spokenSegmentIds: [],
    wordsSpoken: 0,
  };
  const withRuns = renderToStaticMarkup(
    <OutlinePane
      rows={rows}
      runs={[run, { ...run, id: "r2", ordinal: 2 }]}
      onMove={() => {}}
      onSetIncluded={() => {}}
      onRemove={() => {}}
      onClose={() => {}}
    />,
  );
  expect(withRuns).toContain("Rehearsals (2)");
  expect(render(rows)).toContain("Rehearsals");
  expect(render(rows)).toContain("Give the talk once");
});
