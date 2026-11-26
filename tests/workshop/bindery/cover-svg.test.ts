// The typographic covers the app draws for its own documents (docs/67 「封面」).
// Run: bash scripts/t.sh tests/workshop/bindery/cover-svg.test.ts

import { expect, test } from "bun:test";
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  MIN_TEXT_SIZE,
  typographicCover,
  wrapCoverText,
} from "../../../src/workshop/bindery/cover-svg";

const DRAFT = {
  kicker: "能源研究室",
  date: "2026-09-13",
  title: "海上风电的成本曲线在哪一年拐了弯",
  footer: ["iea.org", "reuters.com", "bnef.com"],
};

interface Drawn {
  text: string;
  size: number;
  x: number;
  y: number;
}

function drawn(svg: string): Drawn[] {
  return [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    size: Number(m[3]),
    text: m[4],
  }));
}

function texts(svg: string): string[] {
  return drawn(svg).map((d) => d.text);
}

const ALL = {
  draft: typographicCover(DRAFT),
};

test("every kind declares a size as well as a viewBox, so an <img> can scale it", () => {
  for (const svg of Object.values(ALL)) {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${COVER_WIDTH}" height="${COVER_HEIGHT}"`);
    expect(svg).toContain(`viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}"`);
    expect(svg.endsWith("</svg>")).toBe(true);
  }
});

test("every kind is well-formed XML, which is all an image decoder will accept", () => {
  for (const svg of Object.values(ALL)) {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.localName).toBe("svg");
    expect(doc.querySelectorAll("text").length).toBeGreaterThan(0);
  }
});

test("no text on any cover is set below the size that reads on a phone", () => {
  const long = "How small open-weight language models trade reasoning depth against latency on consumer GPUs in 2026";
  const covers = [
    ...Object.values(ALL),
    typographicCover({ ...DRAFT, title: long }),
  ];
  for (const svg of covers) {
    const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
  }
});

test("the same input is the same bytes, every time", () => {
  for (let i = 0; i < 3; i++) {
    expect(typographicCover(DRAFT)).toBe(ALL.draft);
  }
});

test("markup in any of the lines is escaped, not drawn", () => {
  const svg = typographicCover({
    kicker: "A & B <lab>",
    date: "2026-09-13",
    title: '<script>"x"</script> & so on',
    footer: ["a.example/?x=1&y=2"],
  });
  expect(svg).not.toContain("<script");
  expect(svg).toContain("&amp;");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain("&quot;x&quot;");
  expect(typographicCover({ ...DRAFT, title: "it's <b>" })).toContain("it&apos;s &lt;b&gt;");
});

test("every line stays inside the sheet", () => {
  const long = "the quick brown fox jumps over the lazy dog ".repeat(6);
  const covers = [
    typographicCover({ ...DRAFT, title: long, footer: ["a-very-long-hostname.example.com", "another-long-host.example.org", "x.example"] }),
  ];
  for (const svg of covers) {
    for (const d of drawn(svg)) {
      expect(d.y).toBeGreaterThan(d.size * 0.7);
      expect(d.y).toBeLessThan(COVER_HEIGHT - 20);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThan(COVER_WIDTH);
    }
  }
});

// --- a draft ----------------------------------------------------------------

test("a draft: the lab and the date, the title, the sources", () => {
  const lines = drawn(ALL.draft);
  const labels = lines.filter((d) => d.size === MIN_TEXT_SIZE).map((d) => d.text);
  const title = lines.filter((d) => d.size > MIN_TEXT_SIZE).map((d) => d.text);
  expect(title.join("")).toBe(DRAFT.title);
  expect(labels.join(" · ")).toBe("能源研究室 · 2026-09-13 · iea.org · reuters.com · bnef.com");
  // A list wraps between its entries, so no line starts or ends on the dot.
  for (const l of labels) expect(/^·|·$/.test(l.trim())).toBe(false);
});

test("a fourth source does not reach the cover", () => {
  expect(typographicCover({ ...DRAFT, footer: [...DRAFT.footer, "example.com"] })).not.toContain("example.com");
});

test("a draft with no date and no sources is the lab and the title", () => {
  expect(texts(typographicCover({ ...DRAFT, date: "", footer: [] }))).toEqual(["能源研究室", ...wrapCoverText(DRAFT.title, 15, 4)]);
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
