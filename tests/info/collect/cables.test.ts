// Turning a finished run into the day's cables (src/info/collect/cables.ts).
// Pure: no files, no model. Run: bun test.

import { expect, test } from "bun:test";
import {
  CABLE_SUMMARY_CHARS,
  cablesFromRun,
  cableText,
} from "../../../src/info/collect/cables";
import type { ScreenVerdict } from "../../../src/info/collect/screen";
import type { InfoItem } from "../../../src/info/sources/item";

function item(id: string, over: Partial<InfoItem> = {}): InfoItem {
  return {
    id,
    source: "s",
    sourceName: "The Source",
    title: `Title ${id}`,
    url: `https://x/${id}`,
    publishedAt: "2026-08-10",
    ...over,
  };
}

function verdict(id: string, over: Partial<ScreenVerdict> = {}): ScreenVerdict {
  return { id, hits: [{ labId: "lab-a", observables: ["o-a1"] }], confidence: 0.5, ...over };
}

function verdicts(...vs: ScreenVerdict[]): Record<string, ScreenVerdict> {
  return Object.fromEntries(vs.map((v) => [v.id, v]));
}

test("one cable per selected item, carrying the item's identity and its hits", () => {
  const day = cablesFromRun({
    date: "2026-08-11",
    items: [item("a", { summary: "what happened" }), item("b")],
    verdicts: verdicts(
      verdict("a"),
      verdict("b", { hits: [{ labId: "lab-b", observables: [] }] }),
    ),
    selected: ["a", "b"],
  });
  expect(day.version).toBe(1);
  expect(day.date).toBe("2026-08-11");
  expect(day.cables.map((c) => c.id)).toEqual(["a", "b"]);
  expect(day.cables[0]).toEqual({
    id: "a",
    date: "2026-08-11",
    title: "Title a",
    url: "https://x/a",
    source: "s",
    sourceName: "The Source",
    publishedAt: "2026-08-10",
    hits: [{ labId: "lab-a", observables: ["o-a1"] }],
    summary: "what happened",
  });
  // A scope-level hit stays a scope-level hit.
  expect(day.cables[1].hits).toEqual([{ labId: "lab-b", observables: [] }]);
});

test("no blurb means the head of the body, trimmed", () => {
  const day = cablesFromRun({
    date: "2026-08-11",
    items: [item("a", { textContent: "x".repeat(CABLE_SUMMARY_CHARS + 200) })],
    verdicts: verdicts(verdict("a")),
    selected: ["a"],
  });
  expect(day.cables[0].summary).toBe("x".repeat(CABLE_SUMMARY_CHARS));
});

test("an item with neither a blurb nor a body has no summary rather than an empty one", () => {
  const day = cablesFromRun({
    date: "2026-08-11",
    items: [item("a")],
    verdicts: verdicts(verdict("a")),
    selected: ["a"],
  });
  expect(day.cables[0].summary).toBeUndefined();
});

test("the outside reason rides along, and only the first one does", () => {
  const day = cablesFromRun({
    date: "2026-08-11",
    items: [item("a"), item("b"), item("c")],
    verdicts: verdicts(
      verdict("a", { hits: [], outside: "nothing covers this" }),
      verdict("b", { outside: "nor this" }),
      verdict("c"),
    ),
    selected: ["a", "b", "c"],
  });
  expect(day.cables.map((c) => c.outside)).toEqual([
    "nothing covers this",
    undefined,
    undefined,
  ]);
  // The second one still ships: it hit a room on its own account.
  expect(day.cables[1].hits.length).toBe(1);
});

test("a selection that names something the verdicts do not keep files no cable", () => {
  const day = cablesFromRun({
    date: "2026-08-11",
    items: [item("a"), item("b")],
    verdicts: verdicts(verdict("a", { hits: [] })),
    selected: ["a", "b", "ghost"],
  });
  expect(day.cables).toEqual([]);
});

test("the analyst's copy of the body is cut to the caller's cap", () => {
  expect(cableText(item("a", { textContent: "  the body  " }), 100)).toBe("the body");
  expect(cableText(item("a", { textContent: "abcdef" }), 3)).toBe("abc");
  expect(cableText(item("a"), 100)).toBeUndefined();
  expect(cableText(item("a", { textContent: "   " }), 100)).toBeUndefined();
});
