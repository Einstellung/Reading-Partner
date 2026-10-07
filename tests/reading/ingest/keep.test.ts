// Keeping a briefing article (src/reading/ingest/keep.ts): the body the briefing
// holds becomes an EPUB in the library, listed in the record's topic, and the
// record names it. The library is the real one over a fake AppData; the record
// store, the topic store and the picture fetch are recorded.
// Run: bash scripts/t.sh tests/reading/ingest/keep.test.ts

import { beforeEach, expect, test } from "bun:test";
import {
  importBook,
  getLibraryEntry,
  libraryBookPath,
} from "../../../src/platform/app/library";
import { keepArticle, keptMaterial, type KeepDeps } from "../../../src/reading/ingest/keep";
import {
  buildSavedArticle,
  upsertSavedArticle,
  type SavedArticle,
  type SavedArticleInput,
} from "../../../src/reading/saved/saved-articles";
import type { FetchedBytes } from "../../../src/workshop/bindery";
import { openZip } from "../../../src/workshop/bindery/zip";
import { parseEpub } from "../../../src/reading/epub/file/parse";
import { PNG } from "../epub/fixture";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

const URL_A = "https://example.com/news/a-kept-article";
const IMAGE = "https://cdn.example.com/kept.png";
const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(8);

function input(over: Partial<SavedArticleInput> = {}): SavedArticleInput {
  return {
    topicId: "brief",
    url: URL_A,
    title: "A kept article",
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-10-01T08:00:00Z",
    summaryOnly: false,
    text: PROSE,
    html: `<p>${PROSE}</p><p><img src="${IMAGE}"></p><p>${PROSE}</p>`,
    ...over,
  };
}

interface Recorded {
  deps: KeepDeps;
  records: SavedArticle[];
  attached: { topicId: string; path: string; hash: string }[];
  fetched: string[];
}

function recorder(start: SavedArticle[] = []): Recorded {
  const r: Recorded = { records: [...start], attached: [], fetched: [], deps: null! };
  let clock = 100;
  r.deps = {
    fetch: async (url): Promise<FetchedBytes> => {
      r.fetched.push(url);
      return url === IMAGE
        ? { ok: true, status: 200, bytes: PNG, contentType: "image/png" }
        : { ok: false, status: 404, bytes: new Uint8Array(), contentType: null };
    },
    importBook,
    attachToTopic: async (topicId, path, hash) => {
      r.attached.push({ topicId, path, hash });
    },
    save: async (i) => {
      const record = buildSavedArticle(i, clock++, { hash: "", chars: i.text.length });
      r.records = upsertSavedArticle(r.records, record);
      return r.records.find((a) => a.id === record.id) ?? null;
    },
    existing: async (id) => r.records.find((a) => a.id === id) ?? null,
    libraryEntry: getLibraryEntry,
  };
  return r;
}

let disk: FakeDisk;
beforeEach(() => {
  disk = installAppData();
});

test("keptMaterial binds the HTML when there is some, else the text, under the briefing's names", () => {
  expect(keptMaterial(input())).toMatchObject({
    kind: "html",
    title: "A kept article",
    sourceUrl: URL_A,
    publishedAt: "2026-10-01T08:00:00Z",
  });
  expect(keptMaterial(input({ html: "" }))).toMatchObject({ kind: "text", text: PROSE });
  expect(keptMaterial(input({ html: " ", text: "" }))).toBeNull();
});

test("a kept article becomes an article in the library, listed in Brief, and the record names it", async () => {
  const r = recorder();
  const out = await keepArticle(input(), r.deps);

  expect(out.rejection).toBeNull();
  const doc = out.document!;
  expect(doc.entry.kind).toBe("article");
  expect(doc.entry.format).toBe("epub");
  expect(doc.entry.sourceUrl).toBe(URL_A);
  expect(doc.entry.publishedAt).toBe("2026-10-01T08:00:00Z");
  expect(doc.entry.title).toBe("A kept article.epub");
  expect(r.attached).toEqual([{ topicId: "brief", path: doc.path, hash: doc.entry.hash }]);
  expect(out.record?.documentHash).toBe(doc.entry.hash);
  expect(out.record?.topicId).toBe("brief");

  // The briefing's body, not a fresh fetch of the page: the only request is
  // the picture, which is in the book.
  expect(r.fetched).toEqual([IMAGE]);
  const bytes = disk.blobs.get(libraryBookPath(doc.entry.hash, "epub"))!;
  expect(parseEpub(bytes).docs).toHaveLength(1);
  const names = openZip(bytes).entries.map((e) => e.name).filter((n) => n.startsWith("images/"));
  expect(names).toHaveLength(1);
});

test("keeping the same article again reuses its document and leaves the record where it was filed", async () => {
  const r = recorder();
  const first = await keepArticle(input(), r.deps);
  // The article conversation filed it elsewhere since.
  r.records = r.records.map((a) => ({ ...a, topicId: "t1" }));
  r.attached.length = 0;
  r.fetched.length = 0;

  const again = await keepArticle(input(), r.deps);
  expect(again.document).toBeNull();
  expect(again.record?.documentHash).toBe(first.record?.documentHash);
  expect(again.record?.topicId).toBe("t1");
  expect(r.attached).toEqual([]);
  expect(r.fetched).toEqual([]);
  expect(r.records).toHaveLength(1);
});

test("a summary-only body is a record alone, however long; the full body kept later builds the document", async () => {
  const r = recorder();
  const summary = await keepArticle(input({ summaryOnly: true }), r.deps);
  expect(summary.document).toBeNull();
  expect(summary.rejection).toBeNull();
  expect(summary.record?.summaryOnly).toBe(true);
  expect(summary.record && "documentHash" in summary.record).toBe(false);
  expect(r.attached).toEqual([]);
  expect(r.fetched).toEqual([]);

  const full = await keepArticle(input(), r.deps);
  expect(full.document).not.toBeNull();
  expect(full.record?.summaryOnly).toBe(false);
  expect(full.record?.documentHash).toBe(full.document!.entry.hash);
  expect(r.records).toHaveLength(1);
});

test("a Chinese article is built as Chinese, though the briefing names no language", async () => {
  const zh = "这是一篇关于大语言模型推理效率的文章，讨论了 Transformer 的注意力机制。".repeat(6);
  const r = recorder();
  const out = await keepArticle(input({ html: `<p>${zh}</p>`, text: zh }), r.deps);
  const bytes = disk.blobs.get(libraryBookPath(out.document!.entry.hash, "epub"))!;
  const opf = openZip(bytes).entries.map((e) => e.name).find((n) => n.endsWith(".opf"))!;
  expect(openZip(bytes).text(opf)).toContain("<dc:language>zh</dc:language>");
});

test("a body the bindery turns back is kept as a record alone", async () => {
  const r = recorder();
  const out = await keepArticle(
    input({ html: "<p>JavaScript is not available.</p>", text: "JavaScript is not available." }),
    r.deps,
  );
  expect(out.rejection?.reason).toBe("login-wall");
  expect(out.document).toBeNull();
  expect(out.record).not.toBeNull();
  expect(out.record && "documentHash" in out.record).toBe(false);
  expect(r.attached).toEqual([]);
});

test("a body with nothing in it is a record alone, and no build is attempted", async () => {
  const r = recorder();
  const out = await keepArticle(input({ html: "", text: "", summaryOnly: true }), r.deps);
  expect(out.document).toBeNull();
  expect(out.rejection).toBeNull();
  expect(out.record?.summaryOnly).toBe(true);
});

test("a build that fails still keeps the record", async () => {
  const r = recorder();
  r.deps.importBook = async () => {
    throw new Error("disk full");
  };
  const out = await keepArticle(input(), r.deps);
  expect(out.document).toBeNull();
  expect(out.record).not.toBeNull();
  expect(out.record?.documentHash).toBeUndefined();
});

test("an article with no address and no title is not kept at all", async () => {
  const r = recorder();
  const out = await keepArticle(input({ url: "", title: "" }), r.deps);
  expect(out).toEqual({ record: null, document: null, rejection: null });
  expect(r.attached).toEqual([]);
});
