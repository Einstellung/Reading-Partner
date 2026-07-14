// Unit tests for the pure M6 context/tool helpers (src/ai/reading-context.ts).
// No Tauri, no cache, no network — the callers gather data and hand it in. Run:
// bun test.

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../src/fulltext/types";
import {
  annotationPage,
  buildReadingTools,
  clip,
  findMaterial,
  formatAnnotations,
  formatPages,
  formatSearch,
  surroundingText,
  toolStatusLabel,
  type TopicMaterial,
} from "../../src/ai/reading-context";

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
