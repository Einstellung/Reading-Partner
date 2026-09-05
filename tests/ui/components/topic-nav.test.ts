// The topic's sections (src/ui/components/base/topic-nav.ts): which ones there
// are, in which order, and which one a topic opens on. Run: bun test.

import { expect, test } from "bun:test";
import {
  DEFAULT_SECTION,
  TOPIC_SECTIONS,
} from "../../../src/ui/components/base/topic-nav";

test("the topic has exactly the four sections, Materials first", () => {
  expect(TOPIC_SECTIONS.map((s) => s.id)).toEqual([
    "materials",
    "retell",
    "rehearsal",
    "observations",
  ]);
  expect(TOPIC_SECTIONS.map((s) => s.label)).toEqual([
    "Materials",
    "Retell",
    "Rehearsal",
    "AI observations",
  ]);
});

// A topic is entered to read. Retell and Rehearsal are where you go on purpose.
test("a topic opens on Materials", () => {
  expect(DEFAULT_SECTION).toBe("materials");
  expect(TOPIC_SECTIONS.some((s) => s.id === DEFAULT_SECTION)).toBe(true);
});
