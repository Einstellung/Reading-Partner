// Headless coverage of the full-text module. Extraction runs against real PDFs
// through pdf.js's legacy build (Node/bun); the browser wrapper (worker,
// AppData cache) is exercised by the app, not here. Run with `bun test`.

import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
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
import {
  formatPages,
  formatSearch,
  toAnnotationLite,
  MAX_PAGE_CHARS,
  type TopicMaterial,
} from "../src/fulltext/format";
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

// public/demo.pdf is a 1MB sample kept out of the repo (.gitignore), so a fresh
// worktree does not have it. Skipped rather than failed there: a red that every
// new worktree shows on its first test run reads as "I broke something".
const demoPdf = fixture("../public/demo.pdf");
(existsSync(demoPdf) ? test : test.skip)("extracts a rich multi-page text layer (demo.pdf)", async () => {
  const ft = await extract(demoPdf);
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

// --- prompt-facing formatting (src/fulltext/format.ts) ---

function ft(pages: string[], status: Fulltext["status"] = "ok"): Fulltext {
  return { version: FULLTEXT_VERSION, status, pages, outline: [] };
}

test("formatPages caps the range, clamps to the book, and labels each page", () => {
  const book = ft(Array.from({ length: 20 }, (_, i) => `body of page ${i + 1}`));
  // A 20-page ask is capped to 10 pages from the start of the range.
  const capped = formatPages(book, 3, 20);
  expect(capped).toContain("=== Page 3 ===");
  expect(capped).toContain("=== Page 12 ===");
  expect(capped).not.toContain("=== Page 13 ===");
  // Reversed args normalize; upper bound clamps to the book.
  expect(formatPages(book, 2, 1)).toBe("=== Page 1 ===\nbody of page 1\n\n=== Page 2 ===\nbody of page 2");
  // Wholly out of range and no-text-layer both explain rather than throw.
  expect(formatPages(book, 99, 99)).toContain("out of range");
  expect(formatPages(ft([""], "no-text-layer"), 1, 1)).toContain("machine-readable");
  expect(formatPages(null, 1, 1)).toContain("machine-readable");
});

// The default header is what the chapter-note writer and the prep digest have
// always emitted and what their output on disk is full of, so it is pinned
// separately from the label a tool may pass to carry a citation anchor.
test("formatPages keeps its default header and honours a caller's own", () => {
  const book = ft(["one", "two"]);
  expect(formatPages(book, 1, 1)).toBe("=== Page 1 ===\none");
  expect(formatPages(book, 1, 2, (p) => `=== Page ${p} === [slug p.${p}]`)).toBe(
    "=== Page 1 === [slug p.1]\none\n\n=== Page 2 === [slug p.2]\ntwo",
  );
});

// MAX_PAGES bounded how many pages a call returns, nothing bounded their size.
// The cut has to be visible inside the page, or the model quotes across it as
// if the text ran on.
test("formatPages truncates a long page and says so in the page's own block", () => {
  const long = "x".repeat(MAX_PAGE_CHARS + 500);
  const book = ft(["short page", long, "another short one"]);
  const out = formatPages(book, 1, 3);
  expect(out).toContain(`[page 2 truncated at ${MAX_PAGE_CHARS} chars]`);
  expect(out).not.toContain("[page 1 truncated");
  expect(out).not.toContain("[page 3 truncated");
  // Exactly MAX_PAGE_CHARS of body survive, and the neighbours are untouched.
  const page2 = out.split("=== Page 2 ===\n")[1].split("\n[page 2")[0];
  expect(page2.length).toBe(MAX_PAGE_CHARS);
  expect(out).toContain("=== Page 3 ===\nanother short one");
});

test("formatSearch ranks across materials with a text layer, cites book + page", () => {
  const materials: TopicMaterial[] = [
    { label: "Book A", fulltext: ft(["nothing on topic", "garbage collector pauses here"]), annotations: [] },
    { label: "Book B", fulltext: ft(["a generational garbage collector cuts collector pause times"]), annotations: [] },
    { label: "Scan C", fulltext: ft([""], "no-text-layer"), annotations: [] },
  ];
  const out = formatSearch("garbage collector", materials);
  // Both text-layer books are searched and cited by book + page.
  expect(out).toContain("[Book B, p1]");
  expect(out).toContain("[Book A, p2]");
  // The scan with no text layer is never a hit.
  expect(out).not.toContain("Scan C");
  // No searchable material at all -> a clear notice, not a crash.
  expect(formatSearch("x", [{ label: "Scan C", fulltext: ft([""], "no-text-layer"), annotations: [] }])).toContain(
    "searchable text layer",
  );
  // No match -> named notice.
  expect(formatSearch("zzzznomatch", materials)).toContain("No matches");
});

// --- annotations flattened for the prompt (toAnnotationLite) ---

// Both callers of this — a reading turn and a talk's materials — hand the model
// the reader's marks as evidence, so a mark that is neither a quote nor a note
// is evidence of nothing and must not arrive as an empty line.
test("a mark with neither text nor comment flattens to null", () => {
  expect(toAnnotationLite({ id: "x" } as never)).toBeNull();
  expect(toAnnotationLite({ id: "x", text: "   ", comment: "  " } as never)).toBeNull();
});

test("a mark keeps its 1-based page, its quote and its note", () => {
  expect(
    toAnnotationLite({
      id: "a",
      text: "  inline caches  ",
      comment: " does this follow? ",
      position: { pageIndex: 4 },
    } as never),
  ).toEqual({ page: 5, text: "inline caches", comment: "does this follow?" });
});

// A mark with no page still carries its text: an annotation the engine never
// gave a position to is worth less, not nothing.
test("a mark with no page comes through with a null page", () => {
  expect(toAnnotationLite({ id: "a", text: "a claim" } as never)).toEqual({
    page: null,
    text: "a claim",
    comment: "",
  });
});
