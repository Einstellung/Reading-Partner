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
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../support/guarded-appdata";
import {
  SAVED_ARTICLES_FILE,
  articleBodyPath,
  hasSavedArticles,
  loadSavedArticleBody,
  loadSavedArticles,
  removeSavedArticle,
  saveArticle,
  splitSavedArticleBodies,
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
    bodyHash: "0123456789abcdef0123456789abcdef",
    textChars: 4,
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

// An empty list is what a reader who has kept nothing has. Handed it, a reader
// who has kept thirty articles is shown an empty shelf and told nothing — and
// the keep they reach for next writes that one article over the thirty.
test("a read off an unreadable file raises rather than answering with nothing kept", async () => {
  io.files.set(FILE, JSON.stringify(KEPT));
  io.readFails = true;

  await expect(loadSavedArticles(io)).rejects.toThrow(/could not be read/);
});

test("un-keeping after a failed read leaves every kept article on disk", async () => {
  const bytes = JSON.stringify(KEPT);
  io.files.set(FILE, bytes);
  io.readFails = true;

  await expect(removeSavedArticle("https://example.com/b", io)).rejects.toThrow(
    /could not be read/,
  );

  // Nothing was written, and nothing was moved aside: the bytes are fine, it is
  // this process that could not read them.
  expect(io.files.get(FILE)).toBe(bytes);
  expect(io.files.has(ASIDE)).toBe(false);
});

test("keeping an article after a failed read writes nothing and says so", async () => {
  const bytes = JSON.stringify(KEPT);
  io.files.set(FILE, bytes);
  io.readFails = true;

  await expect(saveArticle(input(), io)).rejects.toThrow(/could not be read/);
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

// The one thing left that comes back null. An article with neither a URL nor a
// title has no id to de-duplicate on, so keeping it twice would file it twice.
test("an article with no identity is not kept, and null says so", async () => {
  expect(await saveArticle({ ...input(), url: "", title: "" }, io)).toBeNull();
  expect(io.files.has(FILE)).toBe(false);
});

// --- the cheap probe --------------------------------------------------------

// The mount gate for the classroom's saved-article tools asks this on every turn
// (reading/turn.ts), so it answers without building the records — a full read
// sanitizes every stored body. It also never judges them: a file it cannot make
// sense of is left where it is, and a read that fails answers "nothing kept"
// rather than throwing into the turn.
test("hasSavedArticles answers from the file without setting the records aside", async () => {
  expect(await hasSavedArticles(io)).toBe(false);

  io.files.set(FILE, "[]");
  expect(await hasSavedArticles(io)).toBe(false);

  io.files.set(FILE, JSON.stringify(KEPT));
  expect(await hasSavedArticles(io)).toBe(true);

  // Shapes no writer here produces. Still no records, and still nothing moved:
  // the probe returns an empty list rather than the null that would quarantine.
  io.files.set(FILE, JSON.stringify(["a", 1, null]));
  expect(await hasSavedArticles(io)).toBe(false);
  io.files.set(FILE, `{"articles":[]}`);
  expect(await hasSavedArticles(io)).toBe(false);
  expect(io.files.has(ASIDE)).toBe(false);
});

// The one reader here that does not raise on an unreadable file. It is a mount
// gate on a chat turn, its only caller already answers false for a throw
// (reading/turn.ts), and the cost of the wrong answer is a tool the model is not
// offered — not a screen that says the reader kept nothing.
test("hasSavedArticles says no when the file cannot be read", async () => {
  io.files.set(FILE, JSON.stringify(KEPT));
  io.readFails = true;
  expect(await hasSavedArticles(io)).toBe(false);
});

// --- the body, and the file it lives in -------------------------------------
//
// The records file is rewritten and re-uploaded on every keep, so everything
// inside it is paid for again each time. With the bodies inlined it measured
// 883 KB over 34 records — 19 KB of text plus 21 KB of html apiece, against
// under 300 bytes of everything else — and the other device downloaded all of it
// to learn that one article had been added. The body moved into a file named
// after its own bytes: written once, then cold forever (docs/21).

// One record as the pre-split build wrote it: the body sitting inside it.
function inlined(over: Partial<SavedArticle> & { text?: string; html?: string } = {}): SavedArticle {
  return { ...record(), text: "body text", html: "<p>body text</p>", ...over };
}

function bodyFiles(from: FakeAppData = io): string[] {
  return [...from.files.keys()].filter((f) => f.startsWith("article-bodies/")).sort();
}

test("a keep puts the body in its own file and leaves a pointer in the index", async () => {
  const saved = await saveArticle({ ...input(), text: "the body", html: "<p>the body</p>" }, io);

  expect(saved?.bodyHash).toMatch(/^[0-9a-f]{32}$/);
  expect(saved?.textChars).toBe(8);
  // Nothing of the body is in the index. This is the whole point: what the index
  // costs to sync is what is in it.
  const onDisk = (io.json(FILE) as SavedArticle[])[0];
  expect("text" in onDisk).toBe(false);
  expect("html" in onDisk).toBe(false);
  expect(io.files.get(FILE)!).not.toContain("the body");

  expect(bodyFiles()).toEqual([articleBodyPath(saved!.bodyHash)]);
  expect(await loadSavedArticleBody(onDisk, io)).toEqual({
    text: "the body",
    html: "<p>the body</p>",
  });
});

// Nothing was captured, so there is nothing to put in a file. A file per nothing
// is still a file to sync.
test("an article kept with no body gets no body file", async () => {
  const saved = await saveArticle({ ...input(), text: "", html: "" }, io);
  expect(saved?.bodyHash).toBe("");
  expect(saved?.textChars).toBe(0);
  expect(bodyFiles()).toEqual([]);
});

test("the split lifts every inlined body out and leaves the index a pointer", async () => {
  io.files.set(
    FILE,
    JSON.stringify([
      inlined(),
      inlined({ id: "https://example.com/b", url: "https://example.com/b", text: "other", html: "<p>other</p>" }),
    ]),
  );

  expect(await splitSavedArticleBodies(io)).toBe(2);

  const onDisk = io.json(FILE) as SavedArticle[];
  for (const a of onDisk) {
    expect("text" in a).toBe(false);
    expect("html" in a).toBe(false);
    expect(a.bodyHash).toMatch(/^[0-9a-f]{32}$/);
  }
  expect(onDisk.map((a) => a.textChars)).toEqual([9, 5]);
  expect(bodyFiles().length).toBe(2);
  expect(await loadSavedArticleBody(onDisk[0], io)).toEqual({
    text: "body text",
    html: "<p>body text</p>",
  });
});

// Run at start-up on every device, every launch. A second pass must find nothing
// to do and write nothing at all — not the same bytes again, nothing, or every
// launch would publish a sync revision the other device has to fetch.
test("the split is idempotent: the second pass writes nothing", async () => {
  io.files.set(FILE, JSON.stringify([inlined(), inlined({ id: "b", url: "https://example.com/b" })]));
  expect(await splitSavedArticleBodies(io)).toBe(1 + 1);

  const after = new Map(io.files);
  const writes: string[] = [];
  const watched = { ...io, write: async (f: string, c: string) => { writes.push(f); await io.write(f, c); } };

  expect(await splitSavedArticleBodies(watched)).toBe(0);
  expect(writes).toEqual([]);
  expect([...io.files.entries()]).toEqual([...after.entries()]);
});

// The two devices never talk: they each run the split over the same records and
// have to land on the same bytes, or the next sync is a conflict on every record
// and a second copy of every body.
test("two devices splitting the same records converge without talking", async () => {
  const before = JSON.stringify([
    inlined(),
    inlined({ id: "https://example.com/b", url: "https://example.com/b", text: "other", html: "<p>other</p>" }),
  ]);
  const one = createFakeAppData();
  const two = createFakeAppData();
  one.files.set(FILE, before);
  two.files.set(FILE, before);

  await splitSavedArticleBodies(one);
  await splitSavedArticleBodies(two);

  expect(one.files.get(FILE)).toBe(two.files.get(FILE));
  expect(bodyFiles(one)).toEqual(bodyFiles(two));
  for (const f of bodyFiles(one)) expect(one.files.get(f)).toBe(two.files.get(f));
});

// The one device is already split, the other is still on the old build and keeps
// re-adding an empty html to the records it writes. Dropping the key is all
// there is to do — re-hashing an empty body would blank a pointer that is right.
test("a record whose inlined body is empty keeps the pointer it already had", async () => {
  io.files.set(FILE, JSON.stringify([{ ...record(), html: "", text: "" }]));

  expect(await splitSavedArticleBodies(io)).toBe(1);

  const onDisk = (io.json(FILE) as SavedArticle[])[0];
  expect(onDisk.bodyHash).toBe("0123456789abcdef0123456789abcdef");
  expect(onDisk.textChars).toBe(4);
  expect("html" in onDisk).toBe(false);
  expect(bodyFiles()).toEqual([]);
});

// Two devices, two files, and they arrive separately. The record can be here
// before its body is; that reads as an article with nothing in it yet, not as a
// failure, and never as a raise into the screen drawing the list.
test("a record whose body file has not arrived reads as an empty body", async () => {
  const orphan = { ...record(), bodyHash: "ffffffffffffffffffffffffffffffff" };
  expect(await loadSavedArticleBody(orphan, io)).toEqual({ text: "", html: "" });
});

// A record arrives over sync from anywhere, and its bodyHash is what becomes a
// path. Anything that is not a hash this build would have written is not one.
test("a bodyHash that is not a hash never becomes a path", async () => {
  io.files.set("../../secrets.json", JSON.stringify({ text: "secret", html: "" }));
  const hostile = { ...record(), bodyHash: "../../secrets" };
  expect(await loadSavedArticleBody(hostile, io)).toEqual({ text: "", html: "" });
});

// The pre-split build's records still render: they arrive over sync from a device
// that has not been updated, and the split may not have run yet on this one.
test("a body still inlined in a record is read straight out of it", async () => {
  expect(await loadSavedArticleBody(inlined(), io)).toEqual({
    text: "body text",
    html: "<p>body text</p>",
  });
});

// File-level deletes do not propagate (docs/13), so a device that dropped a body
// locally would pull it straight back on the next pass. The body stays: dead
// weight that never changes and so never costs a second upload.
test("un-keeping drops the record and leaves the body file where it is", async () => {
  const saved = await saveArticle({ ...input(), text: "the body", html: "<p>the body</p>" }, io);
  await removeSavedArticle(saved!.id, io);

  expect(io.json(FILE)).toEqual([]);
  expect(bodyFiles()).toEqual([articleBodyPath(saved!.bodyHash)]);
});
