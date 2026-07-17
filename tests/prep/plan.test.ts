// Unit tests for plan parsing (src/prep/plan.ts). Pure JSON wrangling; the AI
// call that produces the text is mocked by literal strings. Run: bun test.

import { expect, test } from "bun:test";
import { extractJson, parsePlan, planUserMessage, slugify, uniqueSlug } from "../../src/prep/plan";
import type { Fulltext } from "../../src/fulltext/types";

const PLAN = {
  chapters: [
    { index: 1, title: "Introduction", startPage: 1 },
    { index: 2, title: "Methods", startPage: 4 },
  ],
  references: [
    {
      key: "12",
      title: "RT-1: Robotics Transformer",
      authors: ["Brohan", "Brown"],
      year: 2022,
      arxivId: "2212.06817",
      citedInChapters: [1, 2],
      expanded: true,
    },
    {
      key: "34",
      title: "Diffusion Policy",
      authors: [],
      year: 2023,
      arxivId: null,
      citedInChapters: [2],
      expanded: false,
    },
  ],
  nominations: [{ key: "12", reason: "anchors the survey's taxonomy" }],
};

test("parsePlan maps chapters, references and nominations", () => {
  const out = parsePlan(JSON.stringify(PLAN));
  expect(out.chapters).toHaveLength(2);
  expect(out.chapters[0]).toEqual({ index: 1, title: "Introduction", startPage: 1 });
  expect(out.references).toHaveLength(2);
  expect(out.references[0].arxivId).toBe("2212.06817");
  expect(out.references[1].arxivId).toBeNull();
  expect(out.papers).toHaveLength(1);
  const p = out.papers[0];
  expect(p.slug).toBe("rt-1-robotics-transformer");
  expect(p.title).toBe("RT-1: Robotics Transformer");
  expect(p.reason).toBe("anchors the survey's taxonomy");
  expect(p.status).toBe("queued");
  expect(p.citedInChapters).toEqual([1, 2]);
});

test("parsePlan survives fenced/prefixed model output", () => {
  const noisy = "Sure, here is the plan:\n```json\n" + JSON.stringify(PLAN) + "\n```\nDone.";
  const out = parsePlan(noisy);
  expect(out.papers).toHaveLength(1);
});

test("parsePlan coerces sloppy fields and sorts chapters by page", () => {
  const sloppy = {
    chapters: [
      { title: "Late", startPage: 9 },
      { title: "Early", startPage: "2" },
    ],
    references: [
      { key: 12, title: "  Padded Title  ", year: "2021", citedInChapters: ["1", 3.4] },
    ],
    nominations: [{ key: "12", reason: 42 }],
  };
  const out = parsePlan(JSON.stringify(sloppy));
  expect(out.chapters[0].title).toBe("Early");
  expect(out.chapters[0].startPage).toBe(2);
  const r = out.references[0];
  expect(r.title).toBe("Padded Title");
  expect(r.year).toBe(2021);
  expect(r.citedInChapters).toEqual([1, 3]);
  expect(r.expanded).toBe(false);
  expect(out.papers[0].reason).toBe("");
});

test("parsePlan rejects output without references or nominations", () => {
  expect(() => parsePlan("no json here")).toThrow();
  expect(() => parsePlan(JSON.stringify({ chapters: [], references: [], nominations: [] }))).toThrow(
    /references/,
  );
  expect(() =>
    parsePlan(JSON.stringify({ ...PLAN, nominations: [{ key: "999" }] })),
  ).toThrow(/nominations/);
});

test("extractJson cuts from first { to last }", () => {
  expect(extractJson('x {"a": {"b": 1}} y')).toBe('{"a": {"b": 1}}');
});

test("slugify and uniqueSlug produce filesystem-safe unique names", () => {
  expect(slugify("RT-1: Robotics Transformer!")).toBe("rt-1-robotics-transformer");
  expect(slugify("???")).toBe("paper");
  const taken = new Set(["diffusion-policy"]);
  expect(uniqueSlug(taken, "Diffusion Policy")).toBe("diffusion-policy-2");
});

test("planUserMessage carries page markers", () => {
  const ft: Fulltext = { version: 1, status: "ok", pages: ["alpha", "beta"], outline: [] };
  const msg = planUserMessage(ft);
  expect(msg).toContain("=== Page 1 ===\nalpha");
  expect(msg).toContain("=== Page 2 ===\nbeta");
});
