// The typographic cover the app draws for its own documents (docs/67 「封面」).
// Run: bash scripts/t.sh tests/reading/epub/cover-svg.test.ts

import { expect, test } from "bun:test";
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  typographicCover,
  volumeCover,
  wrapCoverText,
} from "../../../../src/reading/epub/file/cover-svg";

const DRAFT = {
  kicker: "能源研究室",
  date: "2026-09-13",
  title: "海上风电的成本曲线在哪一年拐了弯",
  footer: ["iea.org", "reuters.com", "bnef.com"],
};

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

test("the sheet declares a size as well as a viewBox, so an <img> can scale it", () => {
  const svg = typographicCover(DRAFT);
  expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
  expect(svg).toContain(`width="${COVER_WIDTH}" height="${COVER_HEIGHT}"`);
  expect(svg).toContain(`viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}"`);
  expect(svg.endsWith("</svg>")).toBe(true);
});

test("the sheet is well-formed XML, which is all an image decoder will accept", () => {
  const doc = new DOMParser().parseFromString(typographicCover(DRAFT), "image/svg+xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  expect(doc.documentElement.localName).toBe("svg");
  expect(doc.querySelectorAll("text").length).toBeGreaterThan(0);
});

test("the three lines are the lab and the date, the title, and the sources", () => {
  const lines = texts(typographicCover(DRAFT));
  expect(lines[0]).toBe("能源研究室 · 2026-09-13");
  expect(lines.slice(1, -1).join("")).toBe(DRAFT.title);
  expect(lines[lines.length - 1]).toBe("iea.org · reuters.com · bnef.com");
});

test("a fourth source does not reach the cover", () => {
  const lines = texts(typographicCover({ ...DRAFT, footer: [...DRAFT.footer, "example.com"] }));
  expect(lines[lines.length - 1]).toBe("iea.org · reuters.com · bnef.com");
  expect(typographicCover({ ...DRAFT, footer: [...DRAFT.footer, "example.com"] })).not.toContain(
    "example.com",
  );
});

test("markup in any of the lines is escaped, not drawn", () => {
  const svg = typographicCover({
    kicker: 'A & B <lab>',
    date: "2026-09-13",
    title: '<script>alert("x")</script> & so on',
    footer: ["a.example/?x=1&y=2"],
  });
  expect(svg).not.toContain("<script");
  expect(svg).toContain("&amp;");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain("&quot;x&quot;");
});

test("a top line with no date is just the lab", () => {
  expect(texts(typographicCover({ ...DRAFT, date: "" }))[0]).toBe("能源研究室");
});

test("an empty footer draws no bottom line at all", () => {
  const lines = texts(typographicCover({ ...DRAFT, footer: [] }));
  expect(lines.some((l) => l.includes("·") && l !== lines[0])).toBe(false);
  expect(lines).toHaveLength(1 + texts(typographicCover(DRAFT)).length - 2);
});

test("the same input is the same bytes, every time", () => {
  const once = typographicCover(DRAFT);
  for (let i = 0; i < 3; i++) expect(typographicCover(DRAFT)).toBe(once);
});

// --- wrapping ---------------------------------------------------------------

test("a CJK title breaks anywhere, a Latin title only at spaces", () => {
  const cjk = wrapCoverText("一二三四五六七八九十", 6, 4);
  expect(cjk).toEqual(["一二三", "四五六", "七八九", "十"]);

  const latin = wrapCoverText("how a web page becomes a book", 12, 4);
  expect(latin.join(" ")).toBe("how a web page becomes a book");
  for (const line of latin) expect(line.length).toBeLessThanOrEqual(12);
  expect(latin.every((l) => !l.startsWith(" ") && !l.endsWith(" "))).toBe(true);
});

test("a title longer than four lines loses its tail to an ellipsis", () => {
  const long = wrapCoverText("一二三四五六七八九十百千万亿兆", 6, 4);
  expect(long).toHaveLength(4);
  expect(long[3].endsWith("…")).toBe(true);
  expect(long.join("")).not.toContain("兆");

  const latin = wrapCoverText("the quick brown fox jumps over the lazy dog again", 10, 2);
  expect(latin).toHaveLength(2);
  expect(latin[1].endsWith("…")).toBe(true);
});

test("a word wider than the line is cut rather than left hanging", () => {
  const lines = wrapCoverText("supercalifragilisticexpialidocious", 10, 4);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
  expect(lines.join("")).toBe("supercalifragilisticexpialidocious");
});

test("a title that fits exactly is one line with nothing dropped", () => {
  expect(wrapCoverText("一二三", 6, 4)).toEqual(["一二三"]);
  expect(wrapCoverText("  spaced   out  ", 20, 4)).toEqual(["spaced out"]);
  expect(wrapCoverText("   ", 20, 4)).toEqual([]);
});

// --- volumes ----------------------------------------------------------------

test("a volume puts the series on top and what is inside at the bottom", () => {
  const lines = texts(
    volumeCover({
      series: "能源转型",
      title: "第一卷：成本",
      count: 12,
      dateRange: "2026-03 — 2026-09",
    }),
  );
  expect(lines[0]).toBe("能源转型");
  expect(lines.slice(1, -1).join("")).toBe("第一卷：成本");
  expect(lines[lines.length - 1]).toBe("12 篇 · 2026-03 — 2026-09");
});

test("a volume with no date range says only how many pieces it holds", () => {
  const lines = texts(volumeCover({ series: "能源转型", title: "第一卷", count: 3, dateRange: "" }));
  expect(lines[lines.length - 1]).toBe("3 篇");
});
