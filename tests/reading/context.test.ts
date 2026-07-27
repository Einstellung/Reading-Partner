// Unit tests for the pure M6 context/tool helpers (src/reading/context.ts).
// No Tauri, no cache, no network — the callers gather data and hand it in. Run:
// bun test.

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../src/fulltext/types";
import type { TopicMaterial } from "../../src/fulltext/format";
import {
  annotationPage,
  buildReadingTools,
  clip,
  findMaterial,
  formatAnnotations,
  notesOverviewSection,
  surroundingText,
  toolStatusLabel,
} from "../../src/reading/context";

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

test("clip trims to a word boundary and appends an ellipsis only when cut", () => {
  expect(clip("short text", 100)).toBe("short text");
  const long = "the quick brown fox jumps over the lazy dog again and again";
  const out = clip(long, 20);
  expect(out.length).toBeLessThanOrEqual(21);
  expect(out.endsWith("…")).toBe(true);
  expect(out.includes("  ")).toBe(false);
});

test("surroundingText returns empty for a book with no usable text layer", () => {
  expect(surroundingText(ft([""], "no-text-layer"), 1)).toBe("");
  expect(surroundingText(ft(["real page text here"], "ok"), 1)).toContain("real page text");
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
  const readPagesTool = tools.find((t) => t.name === "read_pages")!;
  expect(await readPagesTool.execute({ from: 1.4, to: "2" })).toBe(
    "=== Page 1 ===\npage 1 text\n\n=== Page 2 ===\npage 2 text",
  );

  // Nothing extractable -> no tools (the agent answers from the prompt alone).
  expect(
    buildReadingTools({
      currentFulltext: ft([""], "no-text-layer"),
      materials: [{ label: "Scan", fulltext: ft([""], "no-text-layer"), annotations: [] }],
    }),
  ).toEqual([]);
});

test("notesOverviewSection: empty for no overview", () => {
  expect(notesOverviewSection(null)).toBe("");
  expect(notesOverviewSection("")).toBe("");
  expect(notesOverviewSection("   \n  ")).toBe("");
});

test("notesOverviewSection: labels and wraps a short overview whole", () => {
  const block = notesOverviewSection("# Framework\n\nThe book argues X then Y.");
  expect(block).toContain("The whole-book outline from the reader's notes");
  expect(block).toContain("The book argues X then Y.");
  expect(block).not.toContain("…"); // short: not truncated
});

test("notesOverviewSection: truncates long text at a paragraph boundary", () => {
  const para = (n: number) => `Paragraph ${n} ` + "x".repeat(400);
  const body = [para(1), para(2), para(3), para(4)].join("\n\n");
  const block = notesOverviewSection(body, 900);
  expect(block).toContain("…");
  expect(block).toContain("Paragraph 1");
  expect(block).toContain("Paragraph 2"); // ~832 chars fits under 900 at the \n\n
  expect(block).not.toContain("Paragraph 4"); // dropped past the cap
  // The cut lands on a paragraph boundary, so no paragraph is left half-written.
  const inner = block.split('"""')[1];
  expect(inner.trimEnd().endsWith("…")).toBe(true);
});
