// The bindery's door (src/workshop/bindery/bind.ts): material in, an EPUB and
// its metadata out, or a rejection. The pinned point: a manuscript of one
// untitled section is the file buildArticleEpub writes for the same article.
// Run: bash scripts/t.sh tests/workshop/bindery/bind.test.ts

import { expect, test } from "bun:test";
import { bind, manuscriptEpubInput } from "../../../src/workshop/bindery/bind";
import {
  buildArticleEpub,
  buildSectionedEpub,
  type ArticleEpubInput,
} from "../../../src/workshop/bindery/build-article";
import type { FetchedBytes } from "../../../src/workshop/bindery/images";
import type { Manuscript } from "../../../src/workshop/bindery/manuscript";
import { registerSiteAdapter, type SiteAdapter } from "../../../src/workshop/bindery/registry";
import { openZip } from "../../../src/workshop/bindery/zip";
import { parseEpub } from "../../../src/reading/epub/file/parse";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { PNG } from "../../reading/epub/fixture";
import { PINNED_ARTICLES } from "./pinned-articles";

const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(8);

function asManuscript(input: ArticleEpubInput): Manuscript {
  return {
    title: input.title,
    ...(input.byline === undefined ? {} : { author: input.byline }),
    ...(input.publishedAt === undefined ? {} : { publishedAt: input.publishedAt }),
    sourceUrl: input.sourceUrl,
    ...(input.language === undefined ? {} : { language: input.language }),
    sections: [{ html: input.html }],
    images: [...input.images],
  };
}

// A site adapter that hands back a fixed manuscript, registered for one case.
async function withSite<T>(
  adapter: Partial<SiteAdapter> & Pick<SiteAdapter, "toManuscript">,
  run: () => Promise<T>,
): Promise<T> {
  const undo = registerSiteAdapter({
    name: "test-site",
    claims: (m) => m.kind === "url" && m.url.startsWith("https://site.test/"),
    ...adapter,
  });
  try {
    return await run();
  } finally {
    undo();
  }
}

const SITE = { kind: "url", url: "https://site.test/1" } as const;

// --- the bytes of one section -------------------------------------------------

test("one untitled section builds to the bytes buildArticleEpub writes for the same article", async () => {
  for (const name of ["rich", "bare"] as const) {
    const input = PINNED_ARTICLES[name];
    const before = await buildArticleEpub(input);
    expect(await buildSectionedEpub(manuscriptEpubInput(asManuscript(input)))).toEqual(before);
    // And through the whole door, an adapter handing over that manuscript.
    const bound = await withSite(
      { minChars: 1, toManuscript: async () => asManuscript(input) },
      () => bind(SITE),
    );
    expect(bound.ok).toBe(true);
    if (bound.ok && "epub" in bound) expect(bound.epub).toEqual(before);
  }
});

test("a fetched page bound twice is the same bytes", async () => {
  const page = `<html><body><article><p>${PROSE}</p><p>${PROSE}</p><img src="https://cdn.e.com/a.png"></article></body></html>`;
  const deps = {
    fetch: async (): Promise<FetchedBytes> => ({ ok: true, status: 200, bytes: PNG, contentType: "image/png" }),
    extractReadable: (html: string) => ({
      title: "T",
      contentHtml: /<article>([\s\S]*)<\/article>/.exec(html)![1],
      textContent: PROSE + PROSE,
    }),
  };
  const material = { kind: "web", url: "https://e.com/a", html: page } as const;
  const [first, second] = [await bind(material, deps), await bind(material, deps)];
  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok && "epub" in first && "epub" in second) {
    expect(second.epub).toEqual(first.epub);
    expect(first.metadata).toMatchObject({
      title: "T",
      sourceUrl: "https://e.com/a",
      language: "en",
      adapter: "web",
      sections: 1,
      imagesEmbedded: 1,
      imagesMissing: 0,
    });
  }
});

// --- several sections -------------------------------------------------------

const THREAD: Manuscript = {
  title: "A thread in three parts",
  author: "Someone",
  sourceUrl: "https://site.test/thread",
  sections: [
    { heading: "Part one", html: `<p>${PROSE}</p><h2>A turn</h2><p>${PROSE}</p>` },
    { heading: "Part two", html: `<p>${PROSE}</p><p><img src="https://cdn.e.com/a.png" alt="x"></p>` },
    { html: `<p>${PROSE}</p>` },
  ],
  images: [{ src: "https://cdn.e.com/a.png", bytes: PNG, mediaType: "image/png" }],
};

test("each section is a spine document of its own, in order, the header on the first", async () => {
  const bytes = await buildSectionedEpub(manuscriptEpubInput(THREAD));
  const book = parseEpub(bytes);
  expect(book.docs.map((d) => d.entry)).toEqual([
    "text/section-001.xhtml",
    "text/section-002.xhtml",
    "text/section-003.xhtml",
  ]);
  expect(book.zip.has("text/article.xhtml")).toBe(false);
  const headers = book.docs.map((d) => d.doc.querySelectorAll(".rp-header").length);
  expect(headers).toEqual([1, 0, 0]);
  expect(book.docs[0].doc.querySelector(".rp-section-heading")?.textContent).toBe("Part one");
  expect(book.docs[2].doc.querySelector(".rp-section-heading")).toBeNull();
  expect(book.pkg.title).toBe("A thread in three parts");
  expect(book.pkg.creator).toBe("Someone");
  // The picture in the second section is packed and pointed at from there.
  const second = book.docs[1];
  for (const entry of second.refs.entries) expect(book.zip.has(entry)).toBe(true);
  expect(second.html).not.toContain("https://cdn.e.com");
});

test("the outline lists the title and every section heading, each pointing into its own document", async () => {
  const book = parseEpub(await buildSectionedEpub(manuscriptEpubInput(THREAD)));
  expect(book.nav.toc.map((t) => [t.title, t.level, t.entry])).toEqual([
    ["A thread in three parts", 0, "text/section-001.xhtml"],
    ["Part one", 0, "text/section-001.xhtml"],
    ["A turn", 1, "text/section-001.xhtml"],
    ["Part two", 0, "text/section-002.xhtml"],
  ]);
  for (const entry of book.nav.toc) {
    const doc = book.docs.find((d) => d.entry === entry.entry)!;
    expect(doc.doc.getElementById(entry.fragment as string)).not.toBeNull();
  }
});

test("a sectioned document is deterministic, and its order is part of what it is", async () => {
  const first = await buildSectionedEpub(manuscriptEpubInput(THREAD));
  const again = await buildSectionedEpub(manuscriptEpubInput({ ...THREAD, images: [...THREAD.images] }));
  expect(again).toEqual(first);
  const swapped = await buildSectionedEpub(
    manuscriptEpubInput({ ...THREAD, sections: [THREAD.sections[1], THREAD.sections[0], THREAD.sections[2]] }),
  );
  expect(swapped).not.toEqual(first);
  // Same entry list either way: names come from position, not from content.
  const names = (b: Uint8Array) => openZip(b).entries.map((e) => e.name);
  expect(names(swapped)).toEqual(names(first));
});

test("a sectioned document paginates as a book", async () => {
  const book = parseEpub(await buildSectionedEpub(manuscriptEpubInput(THREAD)));
  const pagination = await paginate(book, characterRuler(700));
  // Each spine document starts its own page.
  expect(pagination.blocks.filter((b) => b.charOffset === 0).map((b) => b.spine)).toEqual([0, 1, 2]);
});

test("a single titled section keeps the article's entry name and adds its heading", async () => {
  const bytes = await buildSectionedEpub(
    manuscriptEpubInput({ ...THREAD, sections: [THREAD.sections[0]] }),
  );
  const book = parseEpub(bytes);
  expect(book.docs.map((d) => d.entry)).toEqual(["text/article.xhtml"]);
  expect(book.docs[0].doc.querySelector(".rp-section-heading")?.textContent).toBe("Part one");
});

test("a document with no source says nothing about one", async () => {
  const bytes = await buildSectionedEpub(manuscriptEpubInput({ ...THREAD, sourceUrl: undefined }));
  const zip = openZip(bytes);
  expect(zip.text("package.opf")).not.toContain("dc:source");
  expect(zip.text("text/section-001.xhtml")).not.toContain(`class="rp-source"`);
});

// --- the door ---------------------------------------------------------------

test("material turned back fetches no picture and builds nothing", async () => {
  let fetched = 0;
  const got = await bind(
    { kind: "html", html: `<p>Sign in to continue</p><img src="https://cdn.e.com/a.png">` },
    {
      fetch: async () => {
        fetched++;
        return { ok: true, status: 200, bytes: PNG, contentType: "image/png" };
      },
    },
  );
  expect(got).toMatchObject({ ok: false, reason: "login-wall" });
  expect(fetched).toBe(0);
});

test("a bare link nothing claims has no adapter", async () => {
  expect(await bind({ kind: "url", url: "https://example.com/" })).toMatchObject({
    ok: false,
    reason: "no-adapter",
  });
});

test("a site adapter's own rejection is passed through", async () => {
  const got = await withSite(
    { toManuscript: async () => ({ ok: false, reason: "login-wall", message: "needs a session" }) },
    () => bind(SITE),
  );
  expect(got).toEqual({ ok: false, reason: "login-wall", message: "needs a session" });
});

test("a document the site serves whole passes through unbuilt, its metadata cleaned", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\n");
  const got = await withSite(
    {
      toManuscript: async () => ({
        kind: "whole",
        format: "pdf",
        bytes,
        title: "  A  paper ",
        author: " ",
        sourceUrl: "https://site.test/1",
        abstract: "Line one.\n  Line two.",
      }),
    },
    () => bind(SITE),
  );
  expect(got).toEqual({
    ok: true,
    passedThrough: true,
    format: "pdf",
    bytes,
    metadata: {
      title: "A paper",
      sourceUrl: "https://site.test/1",
      abstract: "Line one. Line two.",
      adapter: "test-site",
    },
  });

  const empty = await withSite(
    { toManuscript: async () => ({ kind: "whole", format: "pdf", bytes: new Uint8Array(), title: "T" }) },
    () => bind(SITE),
  );
  expect(empty).toMatchObject({ ok: false, reason: "empty" });
});

test("a site adapter that claims a fetched page is asked before the generic one", async () => {
  const got = await withSite(
    {
      claims: (m) => m.kind === "web" && m.url.startsWith("https://site.test/"),
      toManuscript: async () => ({ title: "From the site", sections: [{ html: `<p>${PROSE}${PROSE}</p>` }], images: [] }),
    },
    () => bind({ kind: "web", url: "https://site.test/p", html: "<p>shell</p>" }),
  );
  expect(got.ok && got.metadata.adapter).toBe("test-site");
  expect(got.ok && got.metadata.title).toBe("From the site");
});

test("Markdown and plain text go through the door with their counts", async () => {
  const md = await bind(
    { kind: "markdown", markdown: `# Notes\n\n${PROSE}\n\n## Two\n\n${PROSE}`, sourceUrl: "https://e.com/n" },
  );
  expect(md.ok).toBe(true);
  if (md.ok && "epub" in md) {
    expect(md.metadata).toMatchObject({ title: "Notes", adapter: "markdown", sections: 1, imagesMissing: 0 });
    expect(md.metadata.chars).toBeGreaterThan(2 * PROSE.trim().length);
    const book = parseEpub(md.epub);
    expect(book.nav.toc.map((t) => t.title)).toEqual(["Notes", "Two"]);
  }
  const text = await bind({ kind: "text", text: `${PROSE}\n\n${PROSE}` });
  expect(text.ok && text.metadata.sourceUrl).toBeUndefined();
});

test("pictures the fetch could not get are counted as missing", async () => {
  const got = await bind(
    {
      kind: "html",
      title: "T",
      sourceUrl: "https://e.com/p",
      html: `<p>${PROSE}${PROSE}</p><img src="/ok.png"><img src="/gone.png">`,
    },
    {
      fetch: async (url) =>
        url.endsWith("/ok.png")
          ? { ok: true, status: 200, bytes: PNG, contentType: "image/png" }
          : { ok: false, status: 404, bytes: new Uint8Array(), contentType: null },
    },
  );
  expect(got.ok && "epub" in got && got.metadata.imagesEmbedded).toBe(1);
  expect(got.ok && "epub" in got && got.metadata.imagesMissing).toBe(1);
});
