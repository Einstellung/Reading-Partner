// Unit tests for which generated decks a topic claims
// (src/ui/components/library/topic/topic-talks.ts). talks.json is global and a
// talk carries book ids, not a topic id, so the answer is an intersection.
// Run: bun test.

import { expect, test } from "bun:test";
import type { Topic } from "../../../src/platform/app/topics";
import type { TalkEntry } from "../../../src/reading/slides";
import {
  talkBooksLabel,
  talksForTopic,
  topicBookIds,
} from "../../../src/ui/components/library/topic/topic-talks";

function topic(hashes: (string | undefined)[]): Topic {
  return {
    id: "t1",
    name: "what makes JITs fast",
    createdAt: 1,
    files: hashes.map((hash, i) => ({ path: `/p/${i}.pdf`, name: `${i}.pdf`, addedAt: i, hash })),
  };
}

function talk(file: string, bookIds: string[], createdAt = 0): TalkEntry {
  return { title: file, file, createdAt, bookIds, instruction: "" };
}

test("a file added but never opened has no hash and claims nothing", () => {
  expect([...topicBookIds(topic(["a", undefined, "b"]))]).toEqual(["a", "b"]);
});

test("a talk belongs to the topic when the two sets intersect at all", () => {
  const talks = [talk("one.html", ["a"]), talk("two.html", ["z", "b"]), talk("three.html", ["z"])];
  expect(talksForTopic(talks, topic(["a", "b"])).map((t) => t.file)).toEqual([
    "one.html",
    "two.html",
  ]);
});

// The talk spans two topics; until that is decided it shows under both rather
// than under neither (docs/31).
test("a cross-topic talk is claimed by every topic it touches", () => {
  const t = talk("mixed.html", ["a", "z"]);
  expect(talksForTopic([t], topic(["a"]))).toHaveLength(1);
  expect(talksForTopic([t], topic(["z"]))).toHaveLength(1);
});

test("a talk with no book ids belongs to no topic", () => {
  expect(talksForTopic([talk("empty.html", [])], topic(["a"]))).toEqual([]);
});

test("a topic whose files have no hashes yet lists nothing", () => {
  expect(talksForTopic([talk("one.html", ["a"])], topic([undefined]))).toEqual([]);
});

test("newest first, whatever order the registry came in", () => {
  const talks = [
    talk("old.html", ["a"], 100),
    talk("new.html", ["a"], 300),
    talk("mid.html", ["a"], 200),
  ];
  expect(talksForTopic(talks, topic(["a"])).map((t) => t.file)).toEqual([
    "new.html",
    "mid.html",
    "old.html",
  ]);
});

test("the input list is not reordered", () => {
  const talks = [talk("old.html", ["a"], 100), talk("new.html", ["a"], 300)];
  talksForTopic(talks, topic(["a"]));
  expect(talks.map((t) => t.file)).toEqual(["old.html", "new.html"]);
});

test("the book count is deduplicated and singular at one", () => {
  expect(talkBooksLabel(talk("x.html", ["a"]))).toBe("1 book");
  expect(talkBooksLabel(talk("x.html", ["a", "a", "b"]))).toBe("2 books");
  expect(talkBooksLabel(talk("x.html", []))).toBe("0 books");
});
