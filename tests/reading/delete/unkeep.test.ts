// Un-keeping an article (src/reading/delete/unkeep.ts): the record, and the
// document its keep built off the record's topic.
// Run: bash scripts/t.sh tests/reading/delete/unkeep.test.ts

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import { unkeepArticle, type UnkeepDeps } from "../../../src/reading/delete/unkeep";
import type { SavedArticle } from "../../../src/reading/saved/saved-articles";

const DOC = "0123456789abcdef0123456789abcdef";

function record(over: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: "a",
    topicId: "brief",
    url: "https://example.com/a",
    title: "A",
    source: "",
    sourceName: "",
    publishedAt: "",
    savedAt: 1,
    summaryOnly: false,
    bodyHash: "",
    textChars: 0,
    ...over,
  };
}

const ROW: FileRef = { path: `library/${DOC}/A.epub`, name: "A.epub", addedAt: 0, hash: DOC };

function deps(records: SavedArticle[], topics: Topic[], calls: string[]): UnkeepDeps {
  return {
    loadSavedArticles: async () => records,
    removeSavedArticle: async (id) => {
      calls.push(`record ${id}`);
    },
    listTopics: async () => topics,
    removeFromTopic: async (topicId, file) => {
      calls.push(`row ${topicId} ${file.path}`);
    },
  };
}

test("un-keeping takes the record, then the document's row in the record's topic", async () => {
  const calls: string[] = [];
  const topics = [
    { id: "brief", name: "Brief", createdAt: 0, files: [ROW] },
    { id: "t1", name: "t1", createdAt: 0, files: [ROW] },
  ];
  await unkeepArticle("a", deps([record({ documentHash: DOC })], topics, calls));
  // The other topic's row is the reader's own filing and stays.
  expect(calls).toEqual(["record a", `row brief ${ROW.path}`]);
});

test("a record with no document is only the record", async () => {
  const calls: string[] = [];
  const topics = [{ id: "brief", name: "Brief", createdAt: 0, files: [ROW] }];
  await unkeepArticle("a", deps([record()], topics, calls));
  expect(calls).toEqual(["record a"]);
});

test("an id with no record still asks the store to remove it", async () => {
  const calls: string[] = [];
  await unkeepArticle("gone", deps([], [], calls));
  expect(calls).toEqual(["record gone"]);
});
