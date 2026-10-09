// A kept article and the document its keep built, held together
// (src/reading/saved/kept-document.ts). What is pinned: the shelf shows one row
// per kept article, a move takes the document along, and removing the document's
// row takes the record with it.
// Run: bash scripts/t.sh tests/reading/saved/kept-document.test.ts

import { expect, test } from "bun:test";
import type { LibraryEntry } from "../../../src/platform/app/library";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import {
  filesLeavingWithTopic,
  forgetKeptArticlesOfDocument,
  keptArticleOpening,
  keptDocumentFile,
  keptRecordsOfDocument,
  moveKeptArticle,
  recordsWithoutListedDocument,
  type KeptDocumentDeps,
  moveDocumentToTopic,
} from "../../../src/reading/saved/kept-document";
import type { SavedArticle } from "../../../src/reading/saved/saved-articles";

const DOC = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const PATH = `library/${DOC}/A kept article.epub`;

function record(over: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: "https://example.com/a",
    topicId: "brief",
    url: "https://example.com/a",
    title: "A kept article",
    source: "src",
    sourceName: "Source",
    publishedAt: "",
    savedAt: 1,
    summaryOnly: false,
    bodyHash: "",
    textChars: 0,
    documentHash: DOC,
    ...over,
  };
}

function file(hash: string, path = `library/${hash}/x.epub`): FileRef {
  return { path, name: path.slice(path.lastIndexOf("/") + 1), addedAt: 0, hash };
}

function topic(id: string, files: FileRef[] = []): Topic {
  return { id, name: id, createdAt: 0, files };
}

// --- pure ----------------------------------------------------------------------

test("keptDocumentFile prefers the record's own topic, then any topic that lists it", () => {
  const own = topic("brief", [file(DOC, PATH)]);
  const elsewhere = topic("t1", [file(DOC, "library/x/elsewhere.epub")]);
  expect(keptDocumentFile(record(), [elsewhere, own])?.topicId).toBe("brief");
  expect(keptDocumentFile(record(), [elsewhere])?.file.path).toBe("library/x/elsewhere.epub");
  expect(keptDocumentFile(record(), [topic("brief")])).toBeNull();
  expect(keptDocumentFile(record({ documentHash: undefined }), [own])).toBeNull();
});

test("a record whose document the topic lists is not shown as a second row", () => {
  const records = [
    record(),
    record({ id: "b", documentHash: undefined }),
    record({ id: "c", documentHash: OTHER }),
  ];
  const shown = recordsWithoutListedDocument(records, topic("brief", [file(DOC, PATH)]));
  expect(shown.map((a) => a.id)).toEqual(["b", "c"]);
});

test("keptRecordsOfDocument names the records of one topic that point at the document", () => {
  const records = [record(), record({ id: "b", topicId: "t1" }), record({ id: "c", documentHash: OTHER })];
  expect(keptRecordsOfDocument(records, "brief", DOC).map((a) => a.id)).toEqual([
    "https://example.com/a",
  ]);
});

test("a deleted topic does not offer a kept article's document for deletion; Brief does", () => {
  const files = [file(DOC, PATH), file(OTHER)];
  const records = [record({ topicId: "t1" })];
  expect(filesLeavingWithTopic(files, records, "t1").map((f) => f.hash)).toEqual([OTHER]);
  expect(filesLeavingWithTopic(files, [record()], "brief").map((f) => f.hash)).toEqual([DOC, OTHER]);
});

test("keptArticleOpening opens the listed document under the article's own title", () => {
  expect(keptArticleOpening(record(), [topic("brief", [file(DOC, PATH)])])).toEqual({
    bookId: DOC,
    name: "A kept article",
    topicId: "brief",
    path: PATH,
  });
  expect(keptArticleOpening(record({ documentHash: undefined }), [topic("brief")])).toBeNull();
});

// --- with the stores --------------------------------------------------------------

interface World {
  records: SavedArticle[];
  topics: Topic[];
  library: Record<string, LibraryEntry>;
  ensured: number;
}

function fakeDeps(world: World): KeptDocumentDeps {
  return {
    loadSavedArticles: async () => world.records.map((a) => ({ ...a })),
    setSavedArticleTopic: async (id, topicId) => {
      const a = world.records.find((r) => r.id === id);
      if (!a) return false;
      a.topicId = topicId;
      return true;
    },
    removeSavedArticle: async (id) => {
      world.records = world.records.filter((a) => a.id !== id);
    },
    listTopics: async () => world.topics.map((t) => ({ ...t, files: [...t.files] })),
    ensureBriefTopic: async () => {
      world.ensured++;
      if (!world.topics.some((t) => t.id === "brief")) world.topics.push(topic("brief"));
    },
    getLibraryEntry: async (hash) => world.library[hash] ?? null,
    addFileToTopic: async (topicId, path, hash) => {
      const t = world.topics.find((x) => x.id === topicId);
      if (t && !t.files.some((f) => f.path === path)) t.files.push(file(hash, path));
    },
    // The store's move: the row as it stands, off every other topic.
    moveFileToTopic: async (hash, topicId) => {
      const to = world.topics.find((x) => x.id === topicId);
      const row = world.topics.flatMap((t) => t.files).find((f) => f.hash === hash);
      const from = world.topics.find((t) => t.files.some((f) => f.hash === hash));
      if (!to || !row || !from || to.files.some((f) => f.hash === hash)) return null;
      for (const t of world.topics) t.files = t.files.filter((f) => f.hash !== hash);
      to.files.push(row);
      return { hash, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name } };
    },
  };
}

function entry(hash: string, name: string): LibraryEntry {
  return { hash, title: name, originalFilename: name, addedAt: 0, format: "epub", kind: "article" };
}

test("moving a kept article moves its document under the same reference", async () => {
  const world: World = {
    records: [record()],
    topics: [topic("brief", [file(DOC, PATH)]), topic("t1")],
    library: { [DOC]: entry(DOC, "A kept article.epub") },
    ensured: 0,
  };
  expect(await moveKeptArticle("https://example.com/a", "t1", fakeDeps(world))).toBe(true);
  expect(world.records[0].topicId).toBe("t1");
  expect(world.topics.find((t) => t.id === "t1")?.files.map((f) => f.path)).toEqual([PATH]);
  expect(world.topics.find((t) => t.id === "brief")?.files).toEqual([]);
});

test("moving a document off the shelf takes its kept record along", async () => {
  const world: World = {
    records: [record({ topicId: "brief" })],
    topics: [topic("brief", [file(DOC, PATH)]), topic("t1")],
    library: {},
    ensured: 0,
  };
  const move = await moveDocumentToTopic(DOC, "t1", fakeDeps(world));
  expect(move?.from.id).toBe("brief");
  expect(world.records[0].topicId).toBe("t1");
  expect(world.topics.find((t) => t.id === "t1")?.files.map((f) => f.path)).toEqual([PATH]);
  // Already there: nothing moves.
  expect(await moveDocumentToTopic(DOC, "t1", fakeDeps(world))).toBeNull();
});

test("a document no topic lists is filed from its library entry", async () => {
  const world: World = {
    records: [record()],
    topics: [topic("brief"), topic("t1")],
    library: { [DOC]: entry(DOC, "A kept article.epub") },
    ensured: 0,
  };
  await moveKeptArticle("https://example.com/a", "t1", fakeDeps(world));
  expect(world.topics.find((t) => t.id === "t1")?.files.map((f) => f.path)).toEqual([PATH]);
});

test("moving to Brief brings Brief back first; a record with no document only moves", async () => {
  const world: World = {
    records: [record({ topicId: "t1" }), record({ id: "b", topicId: "t1", documentHash: undefined })],
    topics: [topic("t1", [file(DOC, PATH)])],
    library: {},
    ensured: 0,
  };
  const deps = fakeDeps(world);
  await moveKeptArticle("https://example.com/a", "brief", deps);
  await moveKeptArticle("b", "brief", deps);
  expect(world.ensured).toBe(1);
  expect(world.records.map((a) => a.topicId)).toEqual(["brief", "brief"]);
  expect(world.topics.find((t) => t.id === "brief")?.files.map((f) => f.hash)).toEqual([DOC]);
  expect(world.topics.find((t) => t.id === "t1")?.files).toEqual([]);
});

test("a move of a record that is not there moves nothing", async () => {
  const world: World = { records: [], topics: [topic("brief", [file(DOC, PATH)])], library: {}, ensured: 0 };
  expect(await moveKeptArticle("nope", "t1", fakeDeps(world))).toBe(false);
  expect(world.topics[0].files.length).toBe(1);
});

test("removing a document's row un-keeps the articles of that topic that point at it", async () => {
  const world: World = {
    records: [record(), record({ id: "b", topicId: "t1" }), record({ id: "c", documentHash: OTHER })],
    topics: [],
    library: {},
    ensured: 0,
  };
  await forgetKeptArticlesOfDocument("brief", DOC, fakeDeps(world));
  expect(world.records.map((a) => a.id)).toEqual(["b", "c"]);
});
