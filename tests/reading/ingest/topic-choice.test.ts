// Which topic the intake card suggests (src/reading/ingest/topic-choice.ts): a
// name found in the link or the reader's words, else the topic used last; a
// model's pick by number where it made one. Pure.
// Run: scripts/t.sh tests/reading/ingest/topic-choice.test.ts

import { expect, test } from "bun:test";
import { lastUsed, suggestTopic, topicChoicesOf, topicMenu } from "../../../src/reading/ingest/topic-choice";
import type { Topic } from "../../../src/platform/app/topics";

function topic(id: string, name: string, createdAt: number, files: Topic["files"] = []): Topic {
  return { id, name, createdAt, files };
}

const TOPICS: Topic[] = [
  topic("brief", "Brief", 10, [{ path: "a", name: "a", addedAt: 500 }]),
  topic("pi", "pi-durable agents", 20, [{ path: "b", name: "b", addedAt: 100, lastOpenedAt: 300 }]),
  topic("zh", "智能简史", 30),
];

test("a topic named in the link is suggested", () => {
  expect(suggestTopic(TOPICS, "https://github.com/robotbird/pi-durable-book")?.id).toBe("pi");
  expect(suggestTopic(TOPICS, "https://a.test/x", "和智能简史第三章对照")?.id).toBe("zh");
  // A word of the name, as a whole word.
  expect(suggestTopic(TOPICS, "https://blog.test/building-agents-that-last")?.id).toBe("pi");
});

test("with no name in the link, the topic used most recently", () => {
  expect(lastUsed(TOPICS[0]!)).toBe(500);
  expect(lastUsed(TOPICS[1]!)).toBe(300);
  expect(lastUsed(TOPICS[2]!)).toBe(30);
  expect(suggestTopic(TOPICS, "https://news.test/story/123")?.id).toBe("brief");
  expect(suggestTopic([], "https://news.test/story/123")).toBeNull();
});

test("short or common words in a name do not match on their own", () => {
  const topics = [topic("ai", "AI", 1), topic("the", "The Notes", 2)];
  // "ai" is in "mail" but is not a three-letter word; "the" is a stop word.
  expect(suggestTopic(topics, "https://mail.test/the-story")?.id).toBe("the");
  expect(suggestTopic([topic("ai", "AI", 5), topic("x", "Other", 1)], "https://mail.test/")?.id).toBe("ai");
});

test("the card's list is numbered in shelf order, and a model's pick by number wins", () => {
  const choices = topicChoicesOf(TOPICS, { url: "https://news.test/story" });
  expect(choices.topics).toEqual([
    { index: 1, id: "brief", name: "Brief" },
    { index: 2, id: "pi", name: "pi-durable agents" },
    { index: 3, id: "zh", name: "智能简史" },
  ]);
  expect(choices.suggested).toBe("brief");
  expect(topicChoicesOf(TOPICS, { url: "https://news.test/story" }, 3).suggested).toBe("zh");
  // A number off the list leaves the program's suggestion.
  expect(topicChoicesOf(TOPICS, { url: "https://news.test/story" }, 9).suggested).toBe("brief");
  expect(topicChoicesOf(TOPICS, { url: "https://news.test/story" }, 1.5).suggested).toBe("brief");
  expect(topicMenu(choices)).toBe("1. Brief\n2. pi-durable agents\n3. 智能简史");
  expect(topicChoicesOf([], { url: "https://news.test/story" })).toEqual({ topics: [], suggested: null });
});
