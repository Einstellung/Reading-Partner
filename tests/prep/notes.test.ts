// Unit tests for note frontmatter round-tripping (src/prep/notes.ts). Run: bun test.

import { expect, test } from "bun:test";
import { abstractNoteBody, parseNote, serializeNote, type NoteMeta } from "../../src/prep/notes";

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
