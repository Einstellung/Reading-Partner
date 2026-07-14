// Headless coverage of the full-text module. Extraction runs against real PDFs
// through pdf.js's legacy build (Node/bun); the browser wrapper (worker,
// AppData cache) is exercised by the app, not here. Run with `bun test`.

import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
// Legacy build so pdf.js runs under bun without a browser.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  extractFromDocument,
  flattenOutline,
  garbageRatio,
  looksLikeGarbage,
  type PdfDocument,
  type PdfOutlineNode,
} from "../src/fulltext/extract";
import { FULLTEXT_VERSION, type Fulltext } from "../src/fulltext/types";
import { chapterAt, readPages, searchTopic, textAround } from "../src/fulltext/query";
import { tokenize } from "../src/fulltext/bm25";

function fixture(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url));
}

async function extract(path: string): Promise<Fulltext> {
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  try {
    return { version: FULLTEXT_VERSION, ...(await extractFromDocument(doc as unknown as PdfDocument)) };
  } finally {
    await doc.destroy();
  }
}

test("extracts per-page text and a resolvable outline from a small PDF", async () => {
  const ft = await extract(fixture("./fixtures/sample-outline.pdf"));
  expect(ft.status).toBe("ok");
  expect(ft.pages.length).toBe(3);
  // Real text, one entry per page.
  expect(ft.pages[0]).toContain("Page 1");
  expect(ft.pages[2]).toContain("Page 3");
  // Outline resolves to 1-based page numbers within range.
  expect(ft.outline.length).toBeGreaterThan(0);
  for (const item of ft.outline) {
    expect(item.page).toBeGreaterThanOrEqual(1);
    expect(item.page).toBeLessThanOrEqual(3);
    expect(item.level).toBe(0);
    expect(typeof item.title).toBe("string");
  }
});

test("extracts a rich multi-page text layer (demo.pdf)", async () => {
  const ft = await extract(fixture("../public/demo.pdf"));
  expect(ft.status).toBe("ok");
  expect(ft.pages.length).toBe(14);
  expect(ft.pages[0].toLowerCase()).toContain("trace");
});

test("garbage detection flags broken font-to-Unicode output", () => {
  const clean = "The quick brown fox jumps over the lazy dog. ".repeat(20);
  expect(looksLikeGarbage(clean)).toBe(false);
  expect(garbageRatio(clean)).toBe(0);

  // Mostly replacement + private-use-area code points: a broken ToUnicode map.
  const broken = ("��".repeat(200)) + "abc";
  expect(looksLikeGarbage(broken)).toBe(true);
  expect(garbageRatio(broken)).toBeGreaterThan(0.9);

  // Empty text is "no text", not "garbage" — classified separately in extract.
  expect(looksLikeGarbage("   \n\t  ")).toBe(false);
});

test("empty text layer classifies as no-text-layer", async () => {
  const blank: PdfDocument = {
    numPages: 2,
    async getPage() {
      return { async getTextContent() { return { items: [] }; } };
    },
    async getOutline() { return null; },
    async getDestination() { return null; },
    async getPageIndex() { return 0; },
    async destroy() {},
  };
  const ft = await extractFromDocument(blank);
  expect(ft.status).toBe("no-text-layer");
  expect(ft.pages).toEqual(["", ""]);
  expect(ft.outline).toEqual([]);
});

test("flattenOutline records depth as level and skips unresolvable entries", async () => {
  const nodes: PdfOutlineNode[] = [
    { title: "Part I", dest: ["p1"], items: [
      { title: "Chapter 1", dest: ["p2"], items: [
        { title: "Section 1.1", dest: ["p3"] },
      ] },
    ] },
    { title: "External link", dest: null },
    { title: "Part II", dest: ["p4"] },
  ];
  // Resolve fake dests to page numbers; null dests resolve to nothing.
  const pageByRef: Record<string, number> = { p1: 1, p2: 2, p3: 5, p4: 9 };
  const out = await flattenOutline(nodes, async (dest) =>
    Array.isArray(dest) && typeof dest[0] === "string" ? pageByRef[dest[0]] ?? null : null,
  );
  expect(out).toEqual([
    { title: "Part I", page: 1, level: 0 },
    { title: "Chapter 1", page: 2, level: 1 },
    { title: "Section 1.1", page: 5, level: 2 },
    { title: "Part II", page: 9, level: 0 },
  ]);
});

test("read-side helpers: textAround, chapterAt, readPages", () => {
  const ft: Fulltext = {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: ["alpha page one", "beta page two body", "gamma page three"],
    outline: [
      { title: "Intro", page: 1, level: 0 },
      { title: "Middle", page: 2, level: 0 },
    ],
  };

  // Page 2 text plus a little spill from its neighbours.
  const around = textAround(ft, 2, 5);
  expect(around).toContain("beta page two body");
  expect(around.startsWith("e one")).toBe(true); // last 5 chars of page 1
  expect(around.endsWith("gamma")).toBe(true); // head of page 3

  expect(chapterAt(ft, 1)?.title).toBe("Intro");
  expect(chapterAt(ft, 3)?.title).toBe("Middle"); // last heading at/before page 3

  expect(readPages(ft, 1, 2)).toBe("alpha page one\n\nbeta page two body");
  expect(readPages(ft, 3, 99)).toBe("gamma page three"); // upper bound clamped to the book
  expect(readPages(ft, 5, 99)).toBe(""); // wholly out of range

  const noOutline: Fulltext = { ...ft, outline: [] };
  expect(chapterAt(noOutline, 2)).toBeNull();
});

test("searchTopic ranks pages across books with label + page + snippet", () => {
  const a: Fulltext = {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: [
      "the garbage collector pauses the program to reclaim memory",
      "unrelated content about typography and layout",
    ],
    outline: [],
  };
  const b: Fulltext = {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: ["a generational garbage collector reduces pause times in the collector"],
    outline: [],
  };
  const hits = searchTopic("garbage collector", [
    { label: "Book A", fulltext: a },
    { label: "Book B", fulltext: b },
  ]);
  expect(hits.length).toBeGreaterThan(0);
  // Book B page 1 mentions the query terms most densely -> ranked first.
  expect(hits[0].label).toBe("Book B");
  expect(hits[0].page).toBe(1);
  expect(hits[0].snippet.toLowerCase()).toContain("garbage");
  // The typography page never matches.
  expect(hits.some((h) => h.snippet.includes("typography"))).toBe(false);
});

test("tokenizer splits latin words and CJK bigrams", () => {
  expect(tokenize("Hello WORLD 42")).toEqual(["hello", "world", "42"]);
  // Three Han chars -> two adjacent bigrams.
  expect(tokenize("阅读器")).toEqual(["阅读", "读器"]);
});
