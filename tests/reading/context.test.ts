// Unit tests for the pure M6 context/tool helpers (src/reading/context.ts).
// No Tauri, no cache, no network — the callers gather data and hand it in. Run:
// bun test.

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../src/fulltext/types";
import type { TopicMaterial } from "../../src/fulltext/format";
import {
  annotationPage,
  buildReadingTools,
  findMaterial,
  formatAnnotations,
  markedPagesSection,
  MARK_PAGES_MAX_TOKENS,
  spineOverviewSection,
  toolStatusLabel,
} from "../../src/reading/context";
import { estimateTextTokens } from "../../src/budget";

function ft(pages: string[], status: Fulltext["status"] = "ok", outline: Fulltext["outline"] = []): Fulltext {
  return { version: FULLTEXT_VERSION, status, pages, outline };
}

test("annotationPage converts 0-based pageIndex to 1-based, null when absent", () => {
  expect(annotationPage({ position: { pageIndex: 0 } })).toBe(1);
  expect(annotationPage({ position: { pageIndex: 4 } })).toBe(5);
  expect(annotationPage({ position: {} })).toBeNull();
  expect(annotationPage({})).toBeNull();
  expect(annotationPage(undefined)).toBeNull();
  expect(annotationPage(null)).toBeNull();
});

// The marked page and the page either side, under the headers read_pages
// returns — the point of the block is that the model never has to fetch them.
const five = () => ft(["one", "two", "three", "four", "five"]);

test("markedPagesSection inlines the marked page and its neighbours", () => {
  const out = markedPagesSection(five(), 3);
  expect(out).toContain("=== Page 2 === [p.2]");
  expect(out).toContain("=== Page 3 === [p.3]");
  expect(out).toContain("=== Page 4 === [p.4]");
  expect(out).not.toContain("=== Page 1 ===");
  expect(out).not.toContain("=== Page 5 ===");
  expect(out).toContain("two");
  expect(out).toContain("These pages are already in front of you");
  expect(out).toContain("only for pages outside this");
});

test("a supplement's pages carry the anchor its title gets", () => {
  const out = markedPagesSection(five(), 2, (p) => `[Some Article p.${p}]`);
  expect(out).toContain("=== Page 2 === [Some Article p.2]");
  expect(out).not.toContain("[p.2]");
});

test("the window clamps at either end of the document", () => {
  const first = markedPagesSection(five(), 1);
  expect(first).toContain("=== Page 1 === [p.1]");
  expect(first).toContain("=== Page 2 === [p.2]");
  expect(first).not.toContain("=== Page 3 ===");

  const last = markedPagesSection(five(), 5);
  expect(last).toContain("=== Page 4 === [p.4]");
  expect(last).toContain("=== Page 5 === [p.5]");

  const alone = markedPagesSection(ft(["only page"]), 1);
  expect(alone).toContain("The page the marked passage sits on:");
  expect(alone).not.toContain("either side");
});

test("markedPagesSection is empty with no text layer or an out-of-range page", () => {
  expect(markedPagesSection(ft([""], "no-text-layer"), 1)).toBe("");
  expect(markedPagesSection(null, 1)).toBe("");
  expect(markedPagesSection(five(), 0)).toBe("");
  expect(markedPagesSection(five(), 9)).toBe("");
});

// An EPUB's full text is the same paginated shape as a PDF's, so it takes the
// same path: nothing here reads a format.
test("an EPUB-shaped full text goes through the same window", () => {
  const epub = ft(["block one", "block two", "block three"], "ok", [
    { title: "Part I", page: 1, level: 0 },
  ]);
  const out = markedPagesSection(epub, 2);
  expect(out).toContain("=== Page 1 === [p.1]");
  expect(out).toContain("block two");
  expect(out).toContain("=== Page 3 === [p.3]");
});

// The neighbours are the context and the marked page is the subject, so the
// neighbours go first, then the marked page itself is cut — each announced.
test("over the ceiling, the neighbours go before the marked page", () => {
  const dense = "词".repeat(MARK_PAGES_MAX_TOKENS);
  const out = markedPagesSection(ft([dense, "the marked page", dense]), 2);
  expect(out).toContain("=== Page 2 === [p.2]");
  expect(out).toContain("the marked page");
  expect(out).not.toContain("=== Page 1 ===");
  expect(out).toContain("The pages either side of p.2 were left out");
  // The ceiling covers the pages; the surrounding instructions are the rest of
  // the allowance here. The cut itself is src/legion's binary search, which
  // returns the largest prefix that fits — so the page is inside the ceiling
  // rather than near it, and this bound is exact rather than a fifth over.
  expect(estimateTextTokens(out)).toBeLessThan(MARK_PAGES_MAX_TOKENS + 100);

  const huge = markedPagesSection(ft(["a", dense, "b"]), 2);
  expect(huge).toContain("=== Page 2 === [p.2]");
  expect(huge).toContain("Page 2 is cut off here");
  expect(estimateTextTokens(huge)).toBeLessThan(MARK_PAGES_MAX_TOKENS + 100);
});

test("toolStatusLabel phrases each tool, single vs range pages", () => {
  expect(toolStatusLabel("read_pages", { from: 5, to: 5 })).toBe("Reading page 5");
  expect(toolStatusLabel("read_pages", { from: 43, to: 41 })).toBe("Reading pages 41–43");
  expect(toolStatusLabel("search_topic", { query: "turkey problem" })).toBe(
    "Searching the topic for “turkey problem”",
  );
  expect(toolStatusLabel("read_annotations", { material: "Fooled by Randomness" })).toBe(
    "Reading your notes on Fooled by Randomness",
  );
  expect(toolStatusLabel("mystery", {})).toBe("Running mystery");
});

test("findMaterial matches exact case-insensitively, then substring", () => {
  const materials: TopicMaterial[] = [
    { label: "The Black Swan", fulltext: null, annotations: [] },
    { label: "Antifragile", fulltext: null, annotations: [] },
  ];
  expect(findMaterial(materials, "the black swan")?.label).toBe("The Black Swan");
  expect(findMaterial(materials, "antifrag")?.label).toBe("Antifragile");
  expect(findMaterial(materials, "no such book")).toBeNull();
});

test("formatAnnotations lists page + quote + note, or guides when missing", () => {
  const materials: TopicMaterial[] = [
    {
      label: "Book A",
      fulltext: null,
      annotations: [
        { page: 12, text: "turkey problem", comment: "key idea" },
        { page: null, text: "", comment: "loose thought" },
      ],
    },
    { label: "Book B", fulltext: null, annotations: [] },
  ];
  const out = formatAnnotations(materials, "Book A");
  expect(out).toContain('p12: "turkey problem" — note: key idea');
  expect(out).toContain("—: (no selected text) — note: loose thought");
  expect(formatAnnotations(materials, "Book B")).toContain("no annotations");
  const missing = formatAnnotations(materials, "Nope");
  expect(missing).toContain("Book A");
  expect(missing).toContain("Book B");
});

// A heavily marked book can carry hundreds of highlights, one of which may be a
// whole page of selected text. Both bounds are announced: a silent cut reads to
// the model as "that is all the marks there are".
test("formatAnnotations caps the list and each entry, and says when it did", () => {
  const many = Array.from({ length: 75 }, (_, i) => ({
    page: i + 1,
    text: "x".repeat(1200),
    comment: "y".repeat(1200),
  }));
  const out = formatAnnotations([{ label: "Book A", fulltext: null, annotations: many }], "Book A");
  const lines = out.split("\n");
  expect(lines.length).toBe(61);
  expect(lines[60]).toBe("[15 more annotations on this material, not shown]");
  expect(lines[0].startsWith("p1: ")).toBe(true);
  expect(lines[0].length).toBeLessThan(1000);
  expect(lines[0]).toContain("…");

  // One over the cap reads naturally.
  const one = formatAnnotations(
    [{ label: "B", fulltext: null, annotations: many.slice(0, 61) }],
    "B",
  );
  expect(one).toContain("[1 more annotation on this material, not shown]");

  // Under the cap, nothing is added.
  const few = formatAnnotations(
    [{ label: "C", fulltext: null, annotations: [{ page: 3, text: "short", comment: "" }] }],
    "C",
  );
  expect(few).toBe('p3: "short"');
});

test("buildReadingTools includes only tools with usable data", async () => {
  const current = ft(Array.from({ length: 5 }, (_, i) => `page ${i + 1} text`));
  const materials: TopicMaterial[] = [
    { label: "Current", fulltext: current, annotations: [{ page: 2, text: "marked", comment: "" }] },
    { label: "Other", fulltext: ft([""], "no-text-layer"), annotations: [] },
  ];
  const tools = buildReadingTools({ currentFulltext: current, materials });
  expect(tools.map((t) => t.name).sort()).toEqual(["read_annotations", "read_pages", "search_topic"]);

  // read_pages execute rounds float/string args and returns labelled pages.
  // Each header carries that page's citation shorthand, so the model copies an
  // anchor it can see instead of assembling one.
  const readPagesTool = tools.find((t) => t.name === "read_pages")!;
  expect(await readPagesTool.execute({ from: 1.4, to: "2" })).toBe(
    "=== Page 1 === [p.1]\npage 1 text\n\n=== Page 2 === [p.2]\npage 2 text",
  );

  // Nothing extractable -> no tools (the agent answers from the prompt alone).
  expect(
    buildReadingTools({
      currentFulltext: ft([""], "no-text-layer"),
      materials: [{ label: "Scan", fulltext: ft([""], "no-text-layer"), annotations: [] }],
    }),
  ).toEqual([]);
});

test("spineOverviewSection: empty for no overview", () => {
  expect(spineOverviewSection(null)).toBe("");
  expect(spineOverviewSection("")).toBe("");
  expect(spineOverviewSection("   \n  ")).toBe("");
});

test("spineOverviewSection: labels and wraps a short overview whole", () => {
  const block = spineOverviewSection("# Framework\n\nThe book argues X then Y.");
  expect(block).toContain("The whole-book outline from the reader's notes");
  expect(block).toContain("The book argues X then Y.");
  expect(block).not.toContain("…"); // short: not truncated
});

test("spineOverviewSection: truncates long text at a paragraph boundary", () => {
  const para = (n: number) => `Paragraph ${n} ` + "x".repeat(400);
  const body = [para(1), para(2), para(3), para(4)].join("\n\n");
  const block = spineOverviewSection(body, 900);
  expect(block).toContain("…");
  expect(block).toContain("Paragraph 1");
  expect(block).toContain("Paragraph 2"); // ~832 chars fits under 900 at the \n\n
  expect(block).not.toContain("Paragraph 4"); // dropped past the cap
  // The cut lands on a paragraph boundary, so no paragraph is left half-written.
  const inner = block.split('"""')[1];
  expect(inner.trimEnd().endsWith("…")).toBe(true);
});
