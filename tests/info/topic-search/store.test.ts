// hasTopicSearches: what X's sign-in row waits for (docs/info/88).

import { expect, test } from "bun:test";
import type { GuardedRead } from "../../../src/platform/app/atomic-fs";
import { hasTopicSearches, type TopicSearchIo } from "../../../src/info/topic-search/store";
import { topicSearchesFileBody, type ParsedTopicSearches } from "../../../src/info/topic-search/topic-searches";
import type { TopicSearch } from "../../../src/info/topic-search/types";

function search(id: string, over: Partial<TopicSearch> = {}): TopicSearch {
  return {
    id,
    name: id,
    concernId: null,
    scope: "AI used to do science",
    subtopics: [{ id: "st1", name: "Materials", picked: true }],
    want: [],
    avoid: [],
    judgments: [],
    anchors: ["AI for science"],
    queries: [{ id: "q1", subtopic: null, x: "AI for science", arxiv: null, ranking: "?", weight: 1 }],
    answers: [],
    status: "active",
    revision: 1,
    createdAt: 1,
    lastRunAt: null,
    ...over,
  };
}

// A disk holding one file body, no file, or a file that cannot be read at all.
function disk(body: string | null | "unreadable"): TopicSearchIo {
  return {
    async read(_file, validate): Promise<GuardedRead<ParsedTopicSearches>> {
      if (body === null) return { status: "missing" };
      if (body === "unreadable") return { status: "corrupt", savedAs: null };
      const value = validate(JSON.parse(body));
      return value ? { status: "ok", value } : { status: "corrupt", savedAs: "moved" };
    },
    async write() {
      throw new Error("hasTopicSearches must not write");
    },
    async quarantine() {
      return null;
    },
    reportCorrupt() {},
  };
}

test("any topic search counts, active or stopped", async () => {
  expect(await hasTopicSearches(disk(topicSearchesFileBody([search("ts-1")])))).toBe(true);
  expect(await hasTopicSearches(disk(topicSearchesFileBody([search("ts-1", { status: "stopped" })])))).toBe(true);
});

test("no file, an empty list, or a file that cannot be read is none", async () => {
  expect(await hasTopicSearches(disk(null))).toBe(false);
  expect(await hasTopicSearches(disk(topicSearchesFileBody([])))).toBe(false);
  expect(await hasTopicSearches(disk("unreadable"))).toBe(false);
});
