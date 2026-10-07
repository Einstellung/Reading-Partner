// The bindery's generic adapters (src/workshop/bindery/adapters.ts): a fetched
// page, raw HTML, plain text and Markdown, each into a manuscript.
// Run: bash scripts/t.sh tests/workshop/bindery/adapters.test.ts

import { expect, test } from "bun:test";
import {
  builtInAdapter,
  htmlAdapter,
  markdownAdapter,
  markdownToHtml,
  textAdapter,
  textToHtml,
  webAdapter,
} from "../../../src/workshop/bindery/adapters";
import type { Manuscript } from "../../../src/workshop/bindery/manuscript";
import type { Rejection } from "../../../src/workshop/bindery/gate";
import type { Extraction } from "../../../src/workshop/extract/readable-select";

const PAGE = `<html lang="de"><head>
  <title>Head title</title>
  <meta name="author" content="A Writer">
  <meta property="article:published_time" content="2026-09-12T08:30:00Z">
</head><body><article><h1>Body title</h1><p>Text.</p></article></body></html>`;

function manuscript(got: Manuscript | Rejection): Manuscript {
  if ("ok" in got) throw new Error(`rejected: ${got.message}`);
  return got;
}

const extractFrom = (title: string) => (html: string): Extraction => ({
  title,
  contentHtml: /<article>([\s\S]*)<\/article>/.exec(html)?.[1] ?? "",
  textContent: "Body title Text.",
});

// --- web --------------------------------------------------------------------

test("the web adapter takes the body from the extractor and the rest from the head", async () => {
  const got = manuscript(
    await webAdapter.toManuscript(
      { kind: "web", url: "https://example.com/a", html: PAGE },
      { extractReadable: extractFrom("Extracted title") },
    ),
  );
  expect(got).toEqual({
    title: "Extracted title",
    author: "A Writer",
    publishedAt: "2026-09-12T08:30:00Z",
    sourceUrl: "https://example.com/a",
    language: "de",
    sections: [{ html: "<h1>Body title</h1><p>Text.</p>" }],
    images: [],
  });
});

test("the web adapter falls back to the caller's title when the page gave none", async () => {
  const got = manuscript(
    await webAdapter.toManuscript(
      { kind: "web", url: "https://example.com/a", html: PAGE, fallbackTitle: "a" },
      { extractReadable: extractFrom("  ") },
    ),
  );
  expect(got.title).toBe("a");
});

test("a page the extractor gets nothing from is turned back as empty", async () => {
  for (const extract of [() => null, () => ({ title: "t", contentHtml: "<p></p>", textContent: " " })]) {
    const got = await webAdapter.toManuscript(
      { kind: "web", url: "https://example.com/a", html: PAGE },
      { extractReadable: extract },
    );
    expect(got).toMatchObject({ ok: false, reason: "empty" });
  }
});

test("the web adapter without an extractor is a wiring fault, not a rejection", async () => {
  await expect(
    webAdapter.toManuscript({ kind: "web", url: "https://example.com/a", html: PAGE }, {}),
  ).rejects.toThrow(/extractReadable/);
});

// --- html -------------------------------------------------------------------

test("raw HTML is the body as given, its head filling in what the caller did not say", async () => {
  const got = manuscript(await htmlAdapter.toManuscript({ kind: "html", html: PAGE }, {}));
  expect(got.title).toBe("Head title");
  expect(got.author).toBe("A Writer");
  expect(got.language).toBe("de");
  expect(got.sourceUrl).toBeUndefined();
  expect(got.sections).toEqual([{ html: PAGE }]);
});

test("what the caller says about raw HTML wins over its head", async () => {
  const got = manuscript(
    await htmlAdapter.toManuscript(
      { kind: "html", html: PAGE, title: "Given", author: "Someone", language: "fr", sourceUrl: " " },
      {},
    ),
  );
  expect(got).toMatchObject({ title: "Given", author: "Someone", language: "fr" });
  expect(got.sourceUrl).toBeUndefined();
});

test("a fragment with no title is named by its first heading", async () => {
  const got = manuscript(
    await htmlAdapter.toManuscript({ kind: "html", html: "<h2>A &amp; B</h2><p>x</p>" }, {}),
  );
  expect(got.title).toBe("A & B");
});

// --- text -------------------------------------------------------------------

test("plain text becomes paragraphs, escaped, with single line breaks kept", () => {
  expect(textToHtml("one <b>\nline two\r\n\r\n\n  second para  \n\n")).toBe(
    "<p>one &lt;b&gt;<br>line two</p>\n<p>second para</p>",
  );
});

test("untitled text is named by its first line", async () => {
  const got = manuscript(
    await textAdapter.toManuscript(
      { kind: "text", text: "\n\n  The first line  \nmore\n\nnext", sourceUrl: "https://e.com" },
      {},
    ),
  );
  expect(got.title).toBe("The first line");
  expect(got.sourceUrl).toBe("https://e.com");
  expect(got.sections).toHaveLength(1);
});

// --- markdown ---------------------------------------------------------------

test("Markdown becomes HTML with GFM, and raw HTML in it is escaped", () => {
  const html = markdownToHtml("a ~~b~~ *c*\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>");
  expect(html).toContain("<del>b</del>");
  expect(html).toContain("<em>c</em>");
  expect(html).toContain("<table>");
  expect(html).not.toContain("<script>");
});

test("a leading level-one heading is the title and is not repeated in the body", async () => {
  const got = manuscript(
    await markdownAdapter.toManuscript({ kind: "markdown", markdown: "# The *title*\n\nBody." }, {}),
  );
  expect(got.title).toBe("The title");
  expect(got.sections[0].html).not.toContain("<h1>");
  expect(got.sections[0].html).toContain("<p>Body.</p>");
});

test("a given title keeps the heading in the body", async () => {
  const got = manuscript(
    await markdownAdapter.toManuscript({ kind: "markdown", markdown: "# Heading\n\nBody.", title: "T" }, {}),
  );
  expect(got.title).toBe("T");
  expect(got.sections[0].html).toContain("<h1>Heading</h1>");
});

test("Markdown with no heading is named by its first line of text", async () => {
  const got = manuscript(
    await markdownAdapter.toManuscript({ kind: "markdown", markdown: "Some **bold** start\n\nMore." }, {}),
  );
  expect(got.title).toBe("Some bold start");
});

// --- the table --------------------------------------------------------------

test("every kind but a bare link has a generic adapter", () => {
  expect(builtInAdapter({ kind: "url", url: "https://x.com" })).toBeNull();
  expect(builtInAdapter({ kind: "web", url: "u", html: "" })?.name).toBe("web");
  expect(builtInAdapter({ kind: "html", html: "" })?.name).toBe("html");
  expect(builtInAdapter({ kind: "text", text: "" })?.name).toBe("text");
  expect(builtInAdapter({ kind: "markdown", markdown: "" })?.name).toBe("markdown");
});
