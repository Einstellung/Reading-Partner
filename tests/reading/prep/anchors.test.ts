// Unit tests for citation anchors (src/reading/prep/anchors.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  figureCitationHref,
  linkifyCitations,
  pageCitationHref,
  paperCitationHref,
  parseAnchor,
  parseCitationHref,
  requalifyNoteAnchors,
} from "../../../src/reading/prep/anchors";

test("survey page citations become fragment links", () => {
  expect(linkifyCitations("See [p.12] for details.")).toBe(
    "See [p.12](#rp-page-12) for details.",
  );
  expect(linkifyCitations("[p. 3]")).toBe("[p. 3](#rp-page-3)");
});

test("page ranges link to the first page", () => {
  expect(linkifyCitations("[pp.12-14]")).toBe("[pp.12-14](#rp-page-12)");
});

test("paper citations carry the slug", () => {
  expect(linkifyCitations("Grounding in [rt-1-robotics p.3].")).toBe(
    "Grounding in [rt-1-robotics p.3](#rp-paper-rt-1-robotics--3).",
  );
});

test("existing markdown links are left alone", () => {
  const already = "[p.12](https://example.com)";
  expect(linkifyCitations(already)).toBe(already);
  const paper = "[rt-1 p.3](#rp-paper-rt-1--3)";
  expect(linkifyCitations(paper)).toBe(paper);
});

test("plain brackets that are not citations pass through", () => {
  expect(linkifyCitations("array[0] and [12] and [see p.9 above]")).toBe(
    "array[0] and [12] and [see p.9 above]",
  );
});

test("figure citations become fragment links (M9)", () => {
  expect(linkifyCitations("See [fig:3] for the pipeline.")).toBe(
    "See [fig:3](#rp-fig-3) for the pipeline.",
  );
  expect(linkifyCitations("[fig:3a]")).toBe("[fig:3a](#rp-fig-3a)");
  expect(linkifyCitations("[FIG:2]")).toBe("[fig:2](#rp-fig-2)"); // case-normalized
});

test("a section-numbered figure citation is a citation too", () => {
  // A chapter-numbered book's figures are "3-1"/"3.8"; a grammar that only knew
  // bare integers left every one of them as literal text in the reply.
  expect(linkifyCitations("See [fig:3.8] for the attention scores.")).toBe(
    "See [fig:3.8](#rp-fig-3.8) for the attention scores.",
  );
  expect(linkifyCitations("[fig:3-1]")).toBe("[fig:3-1](#rp-fig-3-1)");
  expect(linkifyCitations("[fig:3-1a]")).toBe("[fig:3-1a](#rp-fig-3-1a)");
  expect(linkifyCitations("[fig: 2.1.3]")).toBe("[fig:2.1.3](#rp-fig-2.1.3)");
  expect(parseCitationHref(figureCitationHref("3-1"))).toEqual({ kind: "figure", id: "3-1" });
  expect(parseCitationHref(figureCitationHref("3.8"))).toEqual({ kind: "figure", id: "3.8" });
});

test("a bracket that only looks like a figure number is left alone", () => {
  expect(linkifyCitations("[fig:3.8.9.10.11]")).toBe("[fig:3.8.9.10.11]");
  expect(linkifyCitations("[fig:-1]")).toBe("[fig:-1]");
  expect(linkifyCitations("[fig:3 8]")).toBe("[fig:3 8]");
  expect(parseCitationHref("#rp-fig-3..8")).toBeNull();
});

test("an already-linked figure citation is left alone", () => {
  const already = "[fig:3](#rp-fig-3)";
  expect(linkifyCitations(already)).toBe(already);
});

test("hrefs round-trip through parseCitationHref", () => {
  expect(parseCitationHref(pageCitationHref(12))).toEqual({ kind: "page", page: 12 });
  expect(parseCitationHref(paperCitationHref("rt-1-robotics", 3))).toEqual({
    kind: "paper",
    slug: "rt-1-robotics",
    page: 3,
  });
  expect(parseCitationHref(figureCitationHref("3a"))).toEqual({ kind: "figure", id: "3a" });
});

test("a quoted page citation carries the quote as payload, not display text", () => {
  expect(linkifyCitations('See [p.13 "gradient descent converges"] here.')).toBe(
    "See [p.13](#rp-page-13--q=gradient%20descent%20converges) here.",
  );
  // The chip label stays the bare page; the quote lives only in the href.
  expect(linkifyCitations('[pp.4-6 "the key lemma"]')).toBe(
    "[pp.4-6](#rp-page-4--q=the%20key%20lemma)",
  );
});

test("a quoted paper citation carries slug, page and quote", () => {
  expect(linkifyCitations('per [rt-1 p.3 "action tokens"].')).toBe(
    "per [rt-1 p.3](#rp-paper-rt-1--3--q=action%20tokens).",
  );
});

test("page/paper quotes round-trip through parse", () => {
  const q = 'she said "hi" & left';
  expect(parseCitationHref(pageCitationHref(9, q))).toEqual({ kind: "page", page: 9, quote: q });
  expect(parseCitationHref(paperCitationHref("a-b", 2, q))).toEqual({
    kind: "paper",
    slug: "a-b",
    page: 2,
    quote: q,
  });
  // No quote → no quote field.
  expect(parseCitationHref(pageCitationHref(9))).toEqual({ kind: "page", page: 9 });
});

test("escaped quotes inside a citation are unescaped into the payload", () => {
  // The model may escape an inner double-quote: [p.5 "say \"hi\""].
  const href = linkifyCitations('[p.5 "say \\"hi\\""]');
  expect(href).toBe(`[p.5](${pageCitationHref(5, 'say "hi"')})`);
  expect(parseCitationHref(pageCitationHref(5, 'say "hi"'))).toEqual({
    kind: "page",
    page: 5,
    quote: 'say "hi"',
  });
});

test("a plain (unquoted) citation is unchanged by the quote extension", () => {
  expect(linkifyCitations("See [p.12] for details.")).toBe("See [p.12](#rp-page-12) for details.");
});

test("parseCitationHref rejects foreign or malformed hrefs", () => {
  expect(parseCitationHref(undefined)).toBeNull();
  expect(parseCitationHref("https://example.com")).toBeNull();
  expect(parseCitationHref("#rp-page-abc")).toBeNull();
  expect(parseCitationHref("#rp-paper-noseparator")).toBeNull();
  expect(parseCitationHref("#rp-fig-")).toBeNull();
  expect(parseCitationHref("#rp-fig-xyz")).toBeNull();
});

// --- what the wide scan must NOT touch -------------------------------------

// Recognition is one wide scan over every bracket, so the interesting failure
// is no longer a citation that stays plain — it is a piece of prose, notation
// or code that turns into a link. Each of these came out of a real reply.
const NOT_CITATIONS = [
  "array[0] and array[i+1]", // indexing
  "The state is [235] in the table.", // a bare number
  "See [arXiv:2011.03506] for the preprint.", // an identifier
  "The tensor is [M, 768].", // a shape
  "Weights [0.8, 0.3] after the update.", // a vector
  "编码器 [编码器 E] 的输出", // a Chinese gloss
  "Prose that says [see p.9 above] in passing.", // a word before a page number
  "A single letter before a page: [a p.3].",
  "```\nconst cite = [p.12];\n```", // a fenced code block
  "~~~\n[rt-1-robotics p.3]\n~~~", // a tilde fence
  "Inline `[p.12]` shown literally.", // an inline code span
  "Double-tick ``[fig:3]`` shown literally.",
  "An escaped bracket: \\[p.12\\].",
];

test("brackets that are not citations survive the scan unchanged", () => {
  for (const s of NOT_CITATIONS) {
    expect(linkifyCitations(s)).toBe(s);
    expect(linkifyCitations(s, new Set(["rt-1-robotics"]))).toBe(s);
  }
});

// The other half of the false-positive risk, and the half no charset rule can
// reach. A slug is whatever slugify emitted — any script, hyphens optional — so
// "表2" and a Chinese paper's real slug are the same shape. Only the prep list
// tells them apart, which is why the parser is given one.
const NEEDS_THE_LIST = [
  "见 [表2 p.5] 的对比", // a Chinese table reference
  "见 [图2 p.7]",
  "见 [第2章 p.30]",
  "见 [附录A p.3]",
  "As [Hawkins p.170] argues,", // an author-page reference
  "See [Appendix p.20] for the derivation.",
  "See [Table p.5].",
  "In [2026 p.4] the authors revisit it.",
];

test("a well-shaped citation the prep list does not know stays plain text", () => {
  const slugs = new Set(["world-models", "注意力就是你所需要的一切"]);
  for (const s of NEEDS_THE_LIST) {
    expect(linkifyCitations(s, slugs)).toBe(s);
  }
});

// A paper whose title was Chinese gets a Chinese slug, and add_source tells the
// model to cite exactly that. There is no charset it could be filtered by.
test("a slug in the list is citable whatever script it is in", () => {
  const slugs = new Set(["注意力就是你所需要的一切"]);
  expect(linkifyCitations("[注意力就是你所需要的一切 p.1]", slugs)).toBe(
    "[注意力就是你所需要的一切 p.1](#rp-paper-注意力就是你所需要的一切--1)",
  );
});

// The model abbreviates a long slug: dream-to-control-learning-behaviors-by-
// latent-imag came back as [dream-to-control] 14 times in one thread. Those
// used to render as chips that opened an empty panel. A citation that leads
// nowhere must not look like one that leads somewhere.
test("an abbreviated slug renders as plain text, not a chip", () => {
  const full = "dream-to-control-learning-behaviors-by-latent-imag";
  const slugs = new Set([full]);
  expect(linkifyCitations("[dream-to-control p.4]", slugs)).toBe("[dream-to-control p.4]");
  expect(linkifyCitations(`[${full} p.4]`, slugs)).toBe(
    `[${full} p.4](#rp-paper-${full}--4)`,
  );
});

// Null and an empty set are different answers. The list loads a moment after a
// book opens, and striking a real citation out for that moment is worse than
// linking one the click check will catch.
test("an unknown list links on shape; an empty list links nothing", () => {
  const linked = "[world-models p.2](#rp-paper-world-models--2)";
  expect(linkifyCitations("[world-models p.2]")).toBe(linked);
  expect(linkifyCitations("[world-models p.2]", null)).toBe(linked);
  expect(linkifyCitations("[world-models p.2]", undefined)).toBe(linked);
  expect(linkifyCitations("[world-models p.2]", new Set())).toBe("[world-models p.2]");
  // Survey pages never depend on the list — they name no paper.
  expect(linkifyCitations("[p.2]", new Set())).toBe("[p.2](#rp-page-2)");
  expect(linkifyCitations("[fig:3]", new Set())).toBe("[fig:3](#rp-fig-3)");
});

test("parseAnchor rejects the same set, bracket by bracket", () => {
  const inners = [
    "0",
    "235",
    "arXiv:2011.03506",
    "M, 768",
    "0.8, 0.3",
    "编码器 E",
    "see p.9 above",
    "a p.3",
    "",
    "p.0",
    "12",
  ];
  for (const inner of inners) expect(parseAnchor(inner)).toBeNull();
});

// --- the shapes that used to break -----------------------------------------

test("a paper citation takes a page range, like the survey form always did", () => {
  expect(linkifyCitations("[palm-e-an-embodied p.3-4]")).toBe(
    "[palm-e-an-embodied p.3-4](#rp-paper-palm-e-an-embodied--3)",
  );
  expect(linkifyCitations("[palm-e p.8–9]")).toBe("[palm-e p.8–9](#rp-paper-palm-e--8)");
});

test("a page list links to the first page and keeps the whole label", () => {
  expect(linkifyCitations("[rt-2-vla p.2, p.5-6]")).toBe(
    "[rt-2-vla p.2, p.5-6](#rp-paper-rt-2-vla--2)",
  );
  expect(linkifyCitations("[p.9, p.24]")).toBe("[p.9, p.24](#rp-page-9)");
});

test("a slug outside ASCII is citable, because slugify emits them", () => {
  // On disk: π0-a-vision-language-action-flow-model-for-general.md
  expect(linkifyCitations("[π0-a-vision-language-action p.5]")).toBe(
    "[π0-a-vision-language-action p.5](#rp-paper-π0-a-vision-language-action--5)",
  );
});

test("a trailing label after the pages rides along in the chip text", () => {
  expect(linkifyCitations("[p.3-4, Table I]")).toBe("[p.3-4, Table I](#rp-page-3)");
  expect(linkifyCitations("[p.6, Table III]")).toBe("[p.6, Table III](#rp-page-6)");
});

test("CJK and curly quotation marks carry a quote the same as ASCII ones", () => {
  expect(linkifyCitations("[p.190「预测的分歧程度是不确定性的指标」]")).toBe(
    `[p.190](${pageCitationHref(190, "预测的分歧程度是不确定性的指标")})`,
  );
  expect(linkifyCitations("[p.7 “exact words”]")).toBe(
    `[p.7](${pageCitationHref(7, "exact words")})`,
  );
  expect(linkifyCitations("[world-models p.2『内部模型』]")).toBe(
    `[world-models p.2](${paperCitationHref("world-models", 2, "内部模型")})`,
  );
});

test("an uppercase P. is still a page", () => {
  expect(linkifyCitations("[P.12]")).toBe("[P.12](#rp-page-12)");
  expect(linkifyCitations("[PP.12-14]")).toBe("[PP.12-14](#rp-page-12)");
});

test("a figure citation tolerates a space after the colon", () => {
  expect(linkifyCitations("[fig: 3]")).toBe("[fig:3](#rp-fig-3)");
});

test("slug case is folded for the href but kept in the chip", () => {
  expect(linkifyCitations("[World-Models p.2]")).toBe(
    "[World-Models p.2](#rp-paper-world-models--2)",
  );
  // Folded before the list is consulted, too, so casing never misses a paper.
  expect(linkifyCitations("[World-Models p.2]", new Set(["world-models"]))).toBe(
    "[World-Models p.2](#rp-paper-world-models--2)",
  );
});

test("a page bracket the tail grammar cannot account for still links", () => {
  // Two quoted fragments with prose between them: page 10 is not in doubt, so
  // the link stands and nothing is read as the quote.
  expect(linkifyCitations('[p.10 "what exists" 和 "how things behave"]')).toBe(
    '[p.10 "what exists" 和 "how things behave"](#rp-page-10)',
  );
});

// --- note anchors ----------------------------------------------------------

test("requalifyNoteAnchors names the paper a note's bare pages belong to", () => {
  expect(requalifyNoteAnchors("Trained with ES [p.4].", "world-models")).toBe(
    "Trained with ES [world-models p.4].",
  );
  expect(requalifyNoteAnchors("[p.1, p.2] and [pp.3-4]", "wm")).toBe(
    "[wm p.1, p.2] and [wm pp.3-4]",
  );
  expect(requalifyNoteAnchors('A claim [p.5 "exact words"].', "wm")).toBe(
    'A claim [wm p.5 "exact words"].',
  );
});

test("requalifyNoteAnchors leaves alone what is not a bare page anchor", () => {
  const already = "[other-paper p.3] and [fig:2] and array[0]";
  expect(requalifyNoteAnchors(already, "wm")).toBe(already);
  expect(requalifyNoteAnchors("```\n[p.12]\n```", "wm")).toBe("```\n[p.12]\n```");
  expect(requalifyNoteAnchors("[p.4]", "")).toBe("[p.4]");
});

// The note's own slug is the one paper its body may name, so the round-trip
// check never depends on a charset — a Chinese-titled paper requalifies too.
test("requalifyNoteAnchors works for a slug in any script", () => {
  expect(requalifyNoteAnchors("A claim [p.4].", "注意力就是你所需要的一切")).toBe(
    "A claim [注意力就是你所需要的一切 p.4].",
  );
});

test("a requalified note anchor parses back as a paper citation", () => {
  const out = requalifyNoteAnchors("[p.3-4, Table I] [p.190「引文」]", "world-models");
  expect(out).toBe("[world-models p.3-4, Table I] [world-models p.190「引文」]");
  expect(linkifyCitations(out)).toBe(
    "[world-models p.3-4, Table I](#rp-paper-world-models--3) " +
      `[world-models p.190](${paperCitationHref("world-models", 190, "引文")})`,
  );
});
