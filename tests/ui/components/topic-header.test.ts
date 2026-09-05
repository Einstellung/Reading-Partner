// The line under a topic's name (src/ui/components/library/topic/topic-header.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import type { Topic } from "../../../src/platform/app/topics";
import {
  lastReadAt,
  relativeDayLabel,
  topicHeaderLine,
  totalMarks,
} from "../../../src/ui/components/library/topic/topic-header";

const NOW = new Date(2026, 8, 5, 10, 0);

function topicWith(files: { path: string; lastOpenedAt?: number }[]): Topic {
  return {
    id: "t",
    name: "agent loops",
    createdAt: 0,
    files: files.map((f) => ({ path: f.path, name: f.path, addedAt: 0, lastOpenedAt: f.lastOpenedAt })),
  };
}

test("the last read is the most recent file, and null when nothing was opened", () => {
  const at = new Date(2026, 8, 4, 23, 50).getTime();
  expect(lastReadAt(topicWith([{ path: "a", lastOpenedAt: 1 }, { path: "b", lastOpenedAt: at }]))).toBe(at);
  expect(lastReadAt(topicWith([{ path: "a" }]))).toBe(null);
});

// Calendar days, not elapsed time: something read at 23:50 was read yesterday
// at 00:10, whatever the clock says about the twenty minutes.
test("the relative label counts calendar days", () => {
  const midnight = new Date(2026, 8, 5, 0, 10);
  expect(relativeDayLabel(new Date(2026, 8, 4, 23, 50).getTime(), midnight)).toBe("yesterday");
  expect(relativeDayLabel(new Date(2026, 8, 5, 9, 0).getTime(), NOW)).toBe("today");
  expect(relativeDayLabel(new Date(2026, 8, 1).getTime(), NOW)).toBe("4 days ago");
  expect(relativeDayLabel(new Date(2026, 7, 22).getTime(), NOW)).toBe("2 weeks ago");
  expect(relativeDayLabel(new Date(2026, 5, 5).getTime(), NOW)).toBe("3 months ago");
  expect(relativeDayLabel(new Date(2024, 8, 5).getTime(), NOW)).toBe("2 years ago");
});

// A file whose meta has not landed yet contributes nothing, which is an
// unfinished count rather than a wrong one.
test("marks are summed over the files that answered", () => {
  const topic = topicWith([{ path: "a" }, { path: "b" }]);
  expect(totalMarks(topic, { a: { marks: 3 } })).toBe(3);
  expect(totalMarks(topic, { a: { marks: 3 }, b: { marks: 21 } })).toBe(24);
});

test("the header line is files, marks and when it was last read", () => {
  const topic = topicWith([
    { path: "a", lastOpenedAt: new Date(2026, 8, 5, 9).getTime() },
    { path: "b" },
  ]);
  expect(topicHeaderLine(topic, { a: { marks: 24 } }, NOW)).toBe(
    "2 files · 24 marks · last read today",
  );
});

// Nothing is claimed about a topic nobody has read: no marks, no last read.
test("an untouched topic says only how many files it holds", () => {
  expect(topicHeaderLine(topicWith([{ path: "a" }]), {}, NOW)).toBe("1 file");
});
