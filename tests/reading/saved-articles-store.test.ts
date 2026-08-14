// What the saved-articles file is allowed to lose (src/reading/saved-articles.ts).
//
// The store used to read the file inside a bare `catch { return [] }` and the
// next keep/un-keep serialised that empty list back over it. One failed read —
// no race needed — and every article the reader had kept was gone, the same
// shape that emptied a book's conversations in docs/13. So the rule under test
// is the one library.ts already follows: a file that could not be read is not
// written over, and content that could not be parsed is moved aside before
// anything replaces it.
//
// The real store runs here against an in-memory AppData handed in as its io
// (tests/support/guarded-appdata.ts), which answers with the same GuardedRead
// contract readGuardedJson does.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
// parseSavedArticles sanitizes on read, and the sanitizer parses with a
// DOMParser that bun does not have.
import "../support/dom-parser";
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../support/guarded-appdata";
import {
  SAVED_ARTICLES_FILE,
  loadSavedArticles,
  removeSavedArticle,
  saveArticle,
  type SavedArticle,
  type SavedArticleInput,
} from "../../src/reading/saved-articles";

const FILE = SAVED_ARTICLES_FILE;
const ASIDE = `${FILE}${CORRUPT_SUFFIX}`;

let io: FakeAppData;
function record(over: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: "https://example.com/a",
    topicId: "brief",
    url: "https://example.com/a",
    title: "A title",
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-08-01",
    savedAt: 1,
    summaryOnly: false,
    text: "body",
    html: "<p>body</p>",
    ...over,
  };
}

const KEPT = [
  record(),
  record({ id: "https://example.com/b", url: "https://example.com/b", title: "B" }),
  record({ id: "https://example.com/c", url: "https://example.com/c", title: "C" }),
];

function input(): SavedArticleInput {
  return {
    topicId: "brief",
    url: "https://example.com/new",
    title: "New",
    source: "src",
    sourceName: "Source",
    publishedAt: "",
    summaryOnly: false,
    text: "n",
    html: "<p>n</p>",
  };
}

function idsOnDisk(path = FILE): string[] {
  return (io.json(path) as SavedArticle[]).map((a) => a.id);
}

beforeEach(() => {
  io = createFakeAppData();
});

// --- the read that fails ----------------------------------------------------

test("un-keeping after a failed read leaves every kept article on disk", async () => {
  const bytes = JSON.stringify(KEPT);
  io.files.set(FILE, bytes);
  io.readFails = true;

  await removeSavedArticle("https://example.com/b", io);

  // Nothing was written, and nothing was moved aside: the bytes are fine, it is
  // this process that could not read them.
  expect(io.files.get(FILE)).toBe(bytes);
  expect(io.files.has(ASIDE)).toBe(false);
});

test("keeping an article after a failed read writes nothing and says so", async () => {
  const bytes = JSON.stringify(KEPT);
  io.files.set(FILE, bytes);
  io.readFails = true;

  // Null, the same answer as an article with no identity: the caller must not
  // show it as kept.
  expect(await saveArticle(input(), io)).toBeNull();
  expect(io.files.get(FILE)).toBe(bytes);
});

// --- the bytes that will not parse ------------------------------------------

test("un-keeping after an unparseable read keeps the bytes and does not blank them", async () => {
  const bytes = `[{"id":"https://example.com/a","title":"A"`;
  io.files.set(FILE, bytes);

  await removeSavedArticle("https://example.com/b", io);

  // The half-written file is preserved under its own name, so the records in it
  // can still be recovered by hand.
  expect(io.files.get(ASIDE)).toBe(bytes);
  // What replaces it is the empty list, not one article dressed up as the file.
  expect(io.json(FILE)).toEqual([]);
});

test("keeping an article after an unparseable read starts a new file beside the old bytes", async () => {
  const bytes = "{ not json";
  io.files.set(FILE, bytes);

  const saved = await saveArticle(input(), io);

  expect(saved?.id).toBe("https://example.com/new");
  expect(io.files.get(ASIDE)).toBe(bytes);
  expect(idsOnDisk()).toEqual(["https://example.com/new"]);
});

test("a file that is not an array of records is moved aside, not overwritten in place", async () => {
  const bytes = JSON.stringify({ articles: KEPT });
  io.files.set(FILE, bytes);

  await removeSavedArticle("https://example.com/a", io);

  expect(io.files.get(ASIDE)).toBe(bytes);
});

// --- the records inside the file --------------------------------------------

test("a record this build does not understand survives an un-keep", async () => {
  // An extra field, and a record with no id but a url: neither is something
  // saveArticle wrote, and both are still the reader's article.
  io.files.set(
    FILE,
    JSON.stringify([
      { ...record(), mood: "curious" },
      { url: "https://example.com/no-id", title: "no id" },
      record({ id: "https://example.com/c", url: "https://example.com/c", title: "C" }),
    ]),
  );

  await removeSavedArticle("https://example.com/c", io);

  expect(idsOnDisk()).toEqual(["https://example.com/a", "https://example.com/no-id"]);
  // The unknown field came back out with the record.
  expect((io.json(FILE) as { mood?: string }[])[0].mood).toBe("curious");
  // Nothing had to be left behind, so nothing was set aside.
  expect(io.files.has(ASIDE)).toBe(false);
});

test("an entry with no identity is set aside before the write that drops it", async () => {
  // Nothing here can carry this one: the sync merge turns down a whole file
  // holding a record with no id, so writing it back would cost the other
  // records on the next sync.
  const bytes = JSON.stringify([record(), { savedAt: 7, text: "orphan" }, KEPT[2]]);
  io.files.set(FILE, bytes);

  await removeSavedArticle("https://example.com/c", io);

  expect(io.files.get(ASIDE)).toBe(bytes);
  expect(idsOnDisk()).toEqual(["https://example.com/a"]);
});

test("a repair that cannot be set aside is refused rather than written", async () => {
  const bytes = JSON.stringify([record(), null, KEPT[2]]);
  io.files.set(FILE, bytes);
  io.quarantineFails = true;

  await removeSavedArticle("https://example.com/c", io);

  // The orphan would have existed nowhere, so the whole write is dropped.
  expect(io.files.get(FILE)).toBe(bytes);
  expect(io.files.has(ASIDE)).toBe(false);
});

// --- the ordinary path still works ------------------------------------------

test("a keep and an un-keep against a readable file do what they say", async () => {
  io.files.set(FILE, JSON.stringify(KEPT));

  expect(await saveArticle(input(), io)).not.toBeNull();
  expect(idsOnDisk()).toEqual([
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
    "https://example.com/new",
  ]);

  await removeSavedArticle("https://example.com/a", io);
  expect(idsOnDisk()).toEqual([
    "https://example.com/b",
    "https://example.com/c",
    "https://example.com/new",
  ]);
  expect((await loadSavedArticles(io)).map((a) => a.id)).toEqual([
    "https://example.com/b",
    "https://example.com/c",
    "https://example.com/new",
  ]);
  expect(io.files.has(ASIDE)).toBe(false);
});

test("the first keep on a device with no file writes just that article", async () => {
  expect(await saveArticle(input(), io)).not.toBeNull();
  expect(idsOnDisk()).toEqual(["https://example.com/new"]);
  expect(io.files.has(ASIDE)).toBe(false);
});
