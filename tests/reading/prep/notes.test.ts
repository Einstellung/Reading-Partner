// Unit tests for note frontmatter round-tripping (src/reading/prep/notes.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  abstractNoteBody,
  parseNote,
  serializeNote,
  stripModelAsides,
  type NoteMeta,
} from "../../../src/reading/prep/notes";

const META: NoteMeta = {
  title: "RT-1: Robotics Transformer",
  authors: ["Brohan", "Brown"],
  year: 2022,
  arxivId: "2212.06817",
  status: "done",
  source: "arxiv",
  sourcePages: 24,
  citedInChapters: [1, 3],
  sourceUrl: null,
  kind: null,
};

test("serialize/parse round-trips the meta and body", () => {
  const body = "The paper attacks scaling [p.2]. Results on 700 tasks [p.11].";
  const text = serializeNote(META, body);
  const note = parseNote(text);
  expect(note.meta).toEqual(META);
  expect(note.body).toBe(body);
});

test("empty optional fields are omitted and parse back as null/empty", () => {
  const meta: NoteMeta = {
    title: "T",
    authors: [],
    year: null,
    arxivId: null,
    status: "abstract-only",
    source: null,
    sourcePages: null,
    citedInChapters: [],
    sourceUrl: null,
    kind: null,
  };
  const text = serializeNote(meta, "body");
  expect(text).not.toContain("arxivId:");
  expect(text).not.toContain("authors:");
  const note = parseNote(text);
  expect(note.meta.year).toBeNull();
  expect(note.meta.authors).toEqual([]);
  expect(note.meta.citedInChapters).toEqual([]);
});

test("a file without frontmatter parses as body-only", () => {
  const note = parseNote("just some text");
  expect(note.body).toBe("just some text");
  expect(note.meta.title).toBe("");
});

test("a title containing a colon survives", () => {
  const text = serializeNote(META, "b");
  expect(parseNote(text).meta.title).toBe("RT-1: Robotics Transformer");
});

test("a URL source's sourceUrl and kind round-trip", () => {
  const meta: NoteMeta = {
    title: "A Blog Post",
    authors: [],
    year: null,
    arxivId: null,
    status: "done",
    source: "url",
    sourcePages: null,
    citedInChapters: [],
    sourceUrl: "https://blog.example.com/post",
    kind: "article",
  };
  const note = parseNote(serializeNote(meta, "body [no anchors]"));
  expect(note.meta.sourceUrl).toBe("https://blog.example.com/post");
  expect(note.meta.kind).toBe("article");
  expect(note.meta.source).toBe("url");
});

test("abstractNoteBody degrades gracefully", () => {
  expect(abstractNoteBody("An abstract.")).toContain("An abstract.");
  expect(abstractNoteBody("")).toContain("no abstract");
  expect(abstractNoteBody(undefined)).toContain("no abstract");
});

// --- the writer's own stage directions -------------------------------------

// Verbatim from the 17 notes of one survey; every one of them carried at least
// one of these, and world-models.md carried three.
const REAL_ASIDES = [
  "I have everything I need to write a comprehensive note.",
  "Let me finalize my note now.",
  "Here is the prep note:",
  "I have everything needed. Writing the note.",
  "I now have all the information I need to write the note.",
  "I now have comprehensive coverage of the paper. Let me write the prep note.",
  "I have all the information I need from the core sections. Let me write the prep note.",
  "I have enough material to write the note.",
  // "summary" alongside the act of writing is still an aside.
  "Let me write the summary now.",
];

test("stripModelAsides drops the writer's asides", () => {
  for (const aside of REAL_ASIDES) {
    const body = `${aside}\n\nThe paper argues X [p.2].`;
    expect(stripModelAsides(body)).toBe("The paper argues X [p.2].");
  }
});

// The judgement is deliberately narrow: five conditions must hold at once, so
// anything that looks even a little like body prose stays. Losing a paragraph
// is far worse than leaving one in.
const KEPT = [
  // Carries a citation anchor — real body prose is dense with them.
  "I have everything I need to write the note [p.4].",
  // Names no act of writing.
  "I have everything I need.",
  // Not in the writer's voice.
  "The authors note that the model is small.",
  "Writing the policy as a linear map keeps the controller tiny.",
  "本文整理了三类方法。",
  "作者在第三章整理了三类方法。",
  // "summary" is about the paper here, and meets every other condition. It
  // counts only alongside write/note.
  "Here is the summary table the authors give.",
  "Here is the key idea: attention is all you need.",
  // Structure: a heading, a list item, a quote.
  "# Here is the prep note",
  "- I have enough to write the note.",
  "> I have enough to write the note.",
  // Too long to be an aside.
  `I have everything I need to write the note about ${"x".repeat(140)}`,
];

test("stripModelAsides keeps anything that is not plainly an aside", () => {
  for (const block of KEPT) {
    const body = `${block}\n\nThe paper argues X [p.2].`;
    expect(stripModelAsides(body)).toBe(body);
  }
});

test("stripModelAsides does not reach inside a fenced block", () => {
  const body = "```\nI have enough to write the note.\n\nmore code\n```\n\nBody [p.1].";
  expect(stripModelAsides(body)).toBe(body);
});
