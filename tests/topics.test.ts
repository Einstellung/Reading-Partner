// The two pure selectors over the topic library (src/platform/app/topics.ts).
// They decide what the vestibule's "Continue reading" opens and the order the
// library screen lists a topic's files in. Breakage is silent — the wrong book
// opens and nothing is logged — so the fallbacks are pinned here. The rest of
// the module is fs-backed and covered by its callers. Run: bun test.

import { expect, test } from "bun:test";
import { mostRecentlyOpened, sortedFiles, type Topic } from "../src/platform/app/topics";

function file(name: string, addedAt: number, lastOpenedAt?: number) {
  return { path: `/books/${name}`, name, addedAt, ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }) };
}

function topic(id: string, files: ReturnType<typeof file>[]): Topic {
  return { id, name: `topic ${id}`, createdAt: 0, files };
}

test("mostRecentlyOpened picks the newest open across topics and names its topic", () => {
  const a = topic("a", [file("old.pdf", 1, 100), file("newest.pdf", 1, 300)]);
  const b = topic("b", [file("middle.pdf", 1, 200)]);
  const hit = mostRecentlyOpened([a, b]);
  expect(hit?.topic.id).toBe("a");
  expect(hit?.file.name).toBe("newest.pdf");
});

// The guard is `lastOpenedAt === undefined`, not a `?? 0` fallback: a file that
// was added but never opened must never be offered as "continue reading", even
// when it is the only file in the library and was added recently.
test("a file that was never opened never wins, even as the only file", () => {
  expect(mostRecentlyOpened([topic("a", [file("unread.pdf", 999)])])).toBeNull();
  const hit = mostRecentlyOpened([topic("a", [file("unread.pdf", 999), file("read.pdf", 1, 5)])]);
  expect(hit?.file.name).toBe("read.pdf");
});

test("mostRecentlyOpened is null for an empty library and for topics with no files", () => {
  expect(mostRecentlyOpened([])).toBeNull();
  expect(mostRecentlyOpened([topic("a", [])])).toBeNull();
});

test("sortedFiles is most-recently-opened first, falling back to addedAt", () => {
  // never-opened but added late (50) outranks opened-long-ago (10).
  const t = topic("a", [file("opened-early.pdf", 1, 10), file("added-late.pdf", 50), file("opened-late.pdf", 1, 90)]);
  expect(sortedFiles(t).map((f) => f.name)).toEqual([
    "opened-late.pdf",
    "added-late.pdf",
    "opened-early.pdf",
  ]);
});

test("sortedFiles leaves the topic's own array alone", () => {
  const t = topic("a", [file("b.pdf", 1, 10), file("a.pdf", 1, 90)]);
  const before = t.files.map((f) => f.name);
  sortedFiles(t);
  expect(t.files.map((f) => f.name)).toEqual(before);
});
