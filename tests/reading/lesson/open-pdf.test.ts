// The order a PDF is opened in as a lesson on the phone
// (src/reading/lesson/open-pdf.ts): where the bytes come from, what is skipped
// when the full text is already here, and what a file with no text in it comes
// back as. Everything is injected — nothing here touches a disk or an account.
// Run: bun test.

import { expect, test } from "bun:test";
import type { EventPayload } from "../../../src/platform/app/events";
import type { Fulltext, FulltextStatus } from "../../../src/fulltext/types";
import type { TableChapter } from "../../../src/reading/chapters";
import {
  LessonOpenError,
  openPhonePdf,
  type PhonePdfIo,
} from "../../../src/reading/lesson/open-pdf";

const BOOK = "book-hash";

function fulltext(over: Partial<Fulltext> = {}): Fulltext {
  return {
    version: 1,
    status: "ok" as FulltextStatus,
    pages: ["page one", "page two", "page three"],
    outline: [],
    kind: "pdf",
    ...over,
  };
}

const CHAPTERS: TableChapter[] = [
  { index: 1, number: 1, title: "One", startPage: 1, endPage: 2 },
  { index: 2, number: 2, title: "Two", startPage: 3, endPage: 3 },
];

interface Rig {
  io: PhonePdfIo;
  calls: string[];
  lines: string[];
  logged: EventPayload[];
  onStatus: (line: string) => void;
}

function rig(over: Partial<PhonePdfIo> = {}): Rig {
  const calls: string[] = [];
  const lines: string[] = [];
  const logged: EventPayload[] = [];
  let clock = 1000;
  const base: PhonePdfIo = {
    async getFulltext() {
      calls.push("getFulltext");
      return null;
    },
    async hasBook() {
      calls.push("hasBook");
      return true;
    },
    async fetchBook() {
      calls.push("fetchBook");
    },
    async readBook() {
      calls.push("readBook");
      return new Uint8Array([1, 2, 3, 4]);
    },
    async ensureFulltext() {
      calls.push("ensureFulltext");
      return fulltext();
    },
    async loadChapterTable() {
      calls.push("loadChapterTable");
      return CHAPTERS;
    },
    log(payload) {
      logged.push(payload);
    },
    now() {
      clock += 10;
      return clock;
    },
  };
  const io = { ...base, ...over };
  // The overrides record themselves too, so a test that replaces one step still
  // sees the whole order.
  for (const key of Object.keys(over) as (keyof PhonePdfIo)[]) {
    if (key === "log" || key === "now") continue;
    const fn = io[key] as (...a: unknown[]) => unknown;
    (io as Record<string, unknown>)[key] = (...a: unknown[]) => {
      calls.push(key);
      return fn(...a);
    };
  }
  return { io, calls, lines, logged, onStatus: (line) => lines.push(line) };
}

test("a book already on the device is read, not downloaded", async () => {
  const r = rig();
  const out = await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(r.calls).toEqual([
    "getFulltext",
    "hasBook",
    "readBook",
    "ensureFulltext",
    "loadChapterTable",
  ]);
  expect(out.fulltext.status).toBe("ok");
  expect(out.chapters).toEqual(CHAPTERS);
  expect(r.lines).toEqual(["Reading the paper…"]);
});

test("a book that is not here is fetched first, and says so", async () => {
  const r = rig({ hasBook: async () => false });
  await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(r.calls).toEqual([
    "getFulltext",
    "hasBook",
    "fetchBook",
    "readBook",
    "ensureFulltext",
    "loadChapterTable",
  ]);
  expect(r.lines).toEqual(["Downloading…", "Reading the paper…"]);
});

test("a full text already on this device needs no bytes at all", async () => {
  const cached = fulltext({ pages: ["a", "b"] });
  const r = rig({ getFulltext: async () => cached });
  const out = await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(r.calls).toEqual(["getFulltext", "loadChapterTable"]);
  expect(out.fulltext).toBe(cached);
  // Nothing took long enough to announce.
  expect(r.lines).toEqual([]);
});

test("a cached full text with no text layer is not extracted again", async () => {
  const cached = fulltext({ status: "no-text-layer", pages: ["", ""] });
  const r = rig({ getFulltext: async () => cached });
  const out = await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(r.calls).not.toContain("ensureFulltext");
  expect(out.fulltext.status).toBe("no-text-layer");
});

test("a scan comes back with its status rather than throwing", async () => {
  const r = rig({
    ensureFulltext: async () => fulltext({ status: "no-text-layer", pages: ["", "", ""] }),
    loadChapterTable: async () => null,
  });
  const out = await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(out.fulltext.status).toBe("no-text-layer");
  expect(out.chapters).toBeNull();
});

test("a download that fails is a LessonOpenError saying so", async () => {
  const r = rig({
    hasBook: async () => false,
    fetchBook: async () => {
      throw new Error("no account");
    },
  });
  const e = await openPhonePdf(BOOK, r.io, r.onStatus).catch((err: unknown) => err);
  expect(e).toBeInstanceOf(LessonOpenError);
  expect((e as LessonOpenError).why).toBe("download");
  expect((e as LessonOpenError).message).toBe("This paper could not be downloaded.");
});

test("bytes that pdf.js will not read are a LessonOpenError of their own kind", async () => {
  const r = rig({
    ensureFulltext: async () => {
      throw new Error("InvalidPDFException");
    },
  });
  const e = await openPhonePdf(BOOK, r.io, r.onStatus).catch((err: unknown) => err);
  expect(e).toBeInstanceOf(LessonOpenError);
  expect((e as LessonOpenError).why).toBe("unreadable");
});

test("a chapter table that will not load does not stop the lesson", async () => {
  const r = rig({
    loadChapterTable: async () => {
      throw new Error("spine state is corrupt");
    },
  });
  const out = await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(out.chapters).toBeNull();
  expect(out.fulltext.status).toBe("ok");
});

test("a cache read that throws falls back to extracting", async () => {
  const r = rig({
    getFulltext: async () => {
      throw new Error("corrupt cache");
    },
  });
  const out = await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(r.calls).toContain("ensureFulltext");
  expect(out.fulltext.status).toBe("ok");
});

test("the timing line carries the pages, the milliseconds and where it came from", async () => {
  const r = rig({ hasBook: async () => false });
  await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(r.logged).toHaveLength(1);
  const line = r.logged[0];
  expect(line.pages).toBe(3);
  expect(line.status).toBe("ok");
  expect(line.chapters).toBe(2);
  expect(line.cached).toBe(false);
  expect(line.downloaded).toBe(true);
  expect(typeof line.ms).toBe("number");
  expect(typeof line.extractMs).toBe("number");
  expect(line.ms as number).toBeGreaterThanOrEqual(line.extractMs as number);
});

test("a cache hit reports no extraction time rather than a zero", async () => {
  const r = rig({ getFulltext: async () => fulltext() });
  await openPhonePdf(BOOK, r.io, r.onStatus);
  expect(r.logged[0].cached).toBe(true);
  expect(r.logged[0].extractMs).toBeNull();
});

test("a failure logs nothing: there is no duration to report", async () => {
  const r = rig({
    ensureFulltext: async () => {
      throw new Error("boom");
    },
  });
  await openPhonePdf(BOOK, r.io, r.onStatus).catch(() => null);
  expect(r.logged).toEqual([]);
});
