// The pure reading-episode signal builder (src/observation/assemble.ts): it distills
// per-topic observation indexes into a short, recency-ordered plain-text summary of
// what the reader is reading and stuck on, honoring a character budget. Run: bun test.

import { expect, test } from "bun:test";
import { assembleReadingSignal, type TopicObservationSignal } from "../../src/observation/assemble";
import type { ObservationIndexEntry } from "../../src/observation/record/types";

function e(
  type: ObservationIndexEntry["type"],
  summary: string,
  updated: string,
): ObservationIndexEntry {
  return { id: `m-${summary.slice(0, 4)}`, type, summary, updated };
}

test("empty input yields an empty signal", () => {
  expect(assembleReadingSignal([])).toBe("");
  expect(assembleReadingSignal([{ topicName: "T", entries: [] }])).toBe("");
});

test("groups reading positions and stuck points under labeled sections", () => {
  const topics: TopicObservationSignal[] = [
    {
      topicName: "Embodied AI",
      entries: [
        e("reading-position", "on ch.4 of the manipulation survey", "2026-07-20"),
        e("stuck-point", "confused about the value of world models", "2026-07-19"),
      ],
    },
  ];
  const out = assembleReadingSignal(topics);
  expect(out).toContain("Reading recently:");
  expect(out).toContain("- Embodied AI: on ch.4 of the manipulation survey");
  expect(out).toContain("Open questions and stuck points:");
  expect(out).toContain("- Embodied AI: confused about the value of world models");
});

test("ignores observation types that are not part of the signal", () => {
  const topics: TopicObservationSignal[] = [
    {
      topicName: "T",
      entries: [
        e("understood-concept", "grasped backprop", "2026-07-20"),
        e("belief", "thinks RL is overhyped", "2026-07-20"),
        e("correction", "not a chemist", "2026-07-20"),
      ],
    },
  ];
  expect(assembleReadingSignal(topics)).toBe("");
});

test("newest entries win under a tight budget, oldest dropped", () => {
  const topics: TopicObservationSignal[] = [
    {
      topicName: "T",
      entries: [
        e("reading-position", "NEW recent position", "2026-07-22"),
        e("reading-position", "OLD stale position", "2026-05-01"),
      ],
    },
  ];
  const out = assembleReadingSignal(topics, { budget: 40 });
  expect(out).toContain("NEW recent position");
  expect(out).not.toContain("OLD stale position");
});

test("at least one line survives even when it exceeds the budget", () => {
  const topics: TopicObservationSignal[] = [
    { topicName: "T", entries: [e("reading-position", "a very long reading position line", "2026-07-22")] },
  ];
  const out = assembleReadingSignal(topics, { budget: 5 });
  expect(out).toContain("a very long reading position line");
});

test("skips blank summaries and empty topic names fall back to Untitled", () => {
  const topics: TopicObservationSignal[] = [
    {
      topicName: "  ",
      entries: [e("reading-position", "position here", "2026-07-22"), e("stuck-point", "   ", "2026-07-22")],
    },
  ];
  const out = assembleReadingSignal(topics);
  expect(out).toContain("- Untitled: position here");
  expect(out).not.toContain("Open questions");
});
