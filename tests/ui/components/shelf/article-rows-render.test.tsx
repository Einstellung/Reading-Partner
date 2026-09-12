// An article on the shelf, rendered. The fixture is the only way to see the row
// today: nothing in the UI creates an article yet (the ingest path is docs/67's
// next step). Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ArticleRows from "../../../../src/ui/components/shelf/ArticleRows";
import { splitMaterials } from "../../../../src/ui/components/shelf/article-row";
import type { LibraryEntry } from "../../../../src/platform/app/library";
import type { FileRef } from "../../../../src/platform/app/topics";

const files: FileRef[] = [
  { path: "/topics/jit/Fast JITs.pdf", name: "Fast JITs.pdf", addedAt: 1, hash: "book1" },
  {
    path: "/topics/jit/How V8 inlines.epub",
    name: "How V8 inlines.epub",
    addedAt: 2,
    hash: "art1",
  },
  { path: "/topics/jit/A bare piece.epub", name: "A bare piece.epub", addedAt: 3, hash: "art2" },
];

const entries: Record<string, LibraryEntry> = {
  book1: { hash: "book1", title: "Fast JITs.pdf", originalFilename: "Fast JITs.pdf", addedAt: 1 },
  art1: {
    hash: "art1",
    title: "How V8 inlines.epub",
    originalFilename: "How V8 inlines.epub",
    addedAt: 2,
    format: "epub",
    kind: "article",
    sourceUrl: "https://www.v8.dev/blog/inlining",
    byline: "A Writer",
    publishedAt: "2026-08-30T21:15:00-07:00",
  },
  art2: {
    hash: "art2",
    title: "A bare piece.epub",
    originalFilename: "A bare piece.epub",
    addedAt: 3,
    format: "epub",
    kind: "article",
  },
};

const split = splitMaterials(files, entries);
const html = renderToStaticMarkup(
  <ArticleRows rows={split.articles} underCards onOpen={() => {}} onRemove={() => {}} />,
);

test("the book stays a card and only the articles are rows", () => {
  expect(split.books.map((f) => f.name)).toEqual(["Fast JITs.pdf"]);
  expect(html).not.toContain("Fast JITs");
});

test("a row is the title over the source and the date", () => {
  expect(html).toContain(">How V8 inlines<");
  expect(html).toContain(">v8.dev · 2026-08-30<");
});

test("an article that knows neither source nor date is its title alone", () => {
  expect(html).toContain(">A bare piece<");
  // Two rows, one second line.
  expect(html.match(/text-xs text-muted-foreground/g)?.length).toBe(1);
});

test("every row offers the same remove a card does, and no cover", () => {
  expect(html.match(/>Remove</g)?.length).toBe(2);
  expect(html).not.toContain("aspect-[3/4]");
});

test("nothing is drawn when a topic has no articles", () => {
  expect(
    renderToStaticMarkup(<ArticleRows rows={[]} onOpen={() => {}} onRemove={() => {}} />),
  ).toBe("");
});
