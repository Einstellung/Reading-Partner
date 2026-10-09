// Which topic the intake card suggests (src/reading/ingest/topic-choice.ts): a
// model's pick by number where it made one, else a name found in the link or the
// reader's words, else none. Pure.
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

test("with no name in the link nothing is suggested, however recently a topic was used", () => {
  expect(suggestTopic(TOPICS, "https://news.test/story/123")).toBeNull();
  // The walkthrough's case: nanoGPT fits none of the names, and the topic used
  // last is not a suggestion.
  expect(suggestTopic([topic("rl", "robot learn", 1, [{ path: "a", name: "a", addedAt: 900 }]), ...TOPICS], "https://github.com/karpathy/nanoGPT")).toBeNull();
  expect(suggestTopic([], "https://news.test/story/123")).toBeNull();
});

test("of two names in the link, the longer match wins, and a tie goes to the one used last", () => {
  expect(lastUsed(TOPICS[0]!)).toBe(500);
  expect(lastUsed(TOPICS[1]!)).toBe(300);
  expect(lastUsed(TOPICS[2]!)).toBe(30);
  const tie = [topic("old", "agents old", 1), topic("new", "agents new", 2, [{ path: "a", name: "a", addedAt: 50 }])];
  expect(suggestTopic(tie, "https://blog.test/agents")?.id).toBe("new");
});

test("short or common words in a name do not match on their own", () => {
  const topics = [topic("ai", "AI", 1), topic("the", "The Notes", 2)];
  // "ai" is in "mail" but is not a three-letter word; "the" is a stop word.
  expect(suggestTopic(topics, "https://mail.test/the-story")).toBeNull();
  expect(suggestTopic([topic("ai", "AI", 5), topic("x", "Other", 1)], "https://mail.test/")).toBeNull();
});

test("the card's list is numbered in shelf order, and a model's pick by number is the suggestion", () => {
  const choices = topicChoicesOf(TOPICS, { url: "https://news.test/story" });
  expect(choices.topics).toEqual([
    { index: 1, id: "brief", name: "Brief" },
    { index: 2, id: "pi", name: "pi-durable agents" },
    { index: 3, id: "zh", name: "智能简史" },
  ]);
  expect(choices.suggested).toBeNull();
  expect(topicChoicesOf(TOPICS, { url: "https://news.test/story" }, 3).suggested).toBe("zh");
  // The pick beats a name in the link.
  expect(topicChoicesOf(TOPICS, { url: "https://github.com/robotbird/pi-durable-book" }, 1).suggested).toBe("brief");
  // A number off the list is no pick: a name match, or nothing.
  expect(topicChoicesOf(TOPICS, { url: "https://news.test/story" }, 9).suggested).toBeNull();
  expect(topicChoicesOf(TOPICS, { url: "https://github.com/robotbird/pi-durable-book" }, 1.5).suggested).toBe("pi");
  expect(topicMenu(choices)).toBe("1. Brief\n2. pi-durable agents\n3. 智能简史");
  expect(topicChoicesOf([], { url: "https://news.test/story" })).toEqual({ topics: [], suggested: null });
});
