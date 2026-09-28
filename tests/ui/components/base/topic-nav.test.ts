// The topic's sections (src/ui/components/base/topic-nav.ts): which ones there
// are, in which order, and which one a topic opens on. Run: bun test.

import { expect, test } from "bun:test";
import {
  DEFAULT_SECTION,
  TOPIC_SECTIONS,
} from "../../../../src/ui/components/base/topic-nav";

// The label for each id lives in the library catalog now (library.section.*,
// docs/ui/81), drawn through useT() in TopicNav so it redraws with the
// language setting; see tests/ui/components/library/topic-nav-render.test.tsx
// for the rendered English text.
test("the topic has exactly the four sections, Materials first", () => {
  expect(TOPIC_SECTIONS.map((s) => s.id)).toEqual([
    "materials",
    "retell",
    "rehearsal",
    "observations",
  ]);
});

// A topic is entered to read. Retell and Rehearsal are where you go on purpose.
test("a topic opens on Materials", () => {
  expect(DEFAULT_SECTION).toBe("materials");
  expect(TOPIC_SECTIONS.some((s) => s.id === DEFAULT_SECTION)).toBe(true);
});
