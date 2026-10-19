// The originals a topic search reads, keyed by what they are (docs/info/88
// 「看原文」): a DOI or a paper site ranks as a paper, a landing page that names
// its arXiv version is read through arXiv, a short link is keyed by where it
// goes, one page under two spellings is read once. Fake fetches; no network.

import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import { readOriginals, targetsOf, type Draft } from "../../../src/info/topic-search/build-result";
import { openOriginal } from "../../../src/info/topic-search/open-link";
import { readSource, type FetchText, type OpenLink, type SourceDeps } from "../../../src/info/topic-search/verify";
import type { XSearchPost } from "../../../src/info/x/search-page";
import type { ExtractReadable } from "../../../src/workshop/extract/readable-select";
import { htmlToText } from "../../../src/workshop/extract/sanitize";

const signal = new AbortController().signal;
const PAPER = "2610.06262";

const POST: XSearchPost = {
  id: "1979000000000000002",
  handle: "fern_lab",
  name: "Fern Lab",
  text: "Our cell-sorting model is out in a journal, with the code",
  postedAt: Date.parse("2026-10-15T09:00:00Z"),
  shownAt: null,
  counts: { replies: 1, reposts: 2, likes: 30, bookmarks: null, views: 900, quotes: null },
  links: [],
  truncated: false,
  article: false,
  quoted: null,
  permalink: "https://x.com/fern_lab/status/1979000000000000002",
};

const ARXIV_HTML =
  "<html><head><title>Fern: Sorting Cells by Shape</title></head><body><article>" +
  "<h2>Abstract</h2><p>We sort cells by their shape.</p>" +
  `<h2>1 Introduction</h2><p>${"Cells differ in shape and the sorter reads it. ".repeat(220)}</p>` +
  "</article></body></html>";
const arxivHtml: FetchText = async (url) => (url === `https://arxiv.org/html/${PAPER}` ? { status: 200, text: ARXIV_HTML } : { status: 404, text: "" });

const extract: ExtractReadable = (html) => {
  const body = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  if (body === undefined) return null;
  return { title: /<h1>([^<]*)<\/h1>/.exec(body)?.[1] ?? "", contentHtml: body, textContent: htmlToText(body) };
};

const pageAt = (html: string) => async (url: string) => ({
  ok: true,
  status: 200,
  bytes: new TextEncoder().encode(html),
  contentType: "text/html; charset=utf-8",
  url,
});

function deps(over: { fetchText?: FetchText; openLink?: OpenLink; opened?: string[]; resolveShortLink?: SourceDeps["resolveShortLink"] }): SourceDeps {
  return {
    fetchText: over.fetchText ?? (async () => ({ status: 404, text: "" })),
    openLink: async (url, s) => {
      over.opened?.push(url);
      if (over.openLink) return over.openLink(url, s);
      return { ok: false, code: "not_found", reason: "not here" };
    },
    lookupRepo: async () => ({ kind: "skipped", reason: "quota" }),
    repoQuotaLeft: () => null,
    ...(over.resolveShortLink ? { resolveShortLink: over.resolveShortLink } : {}),
  };
}

const registry = () => new MaterialRegistry("runs/t", { write: async () => {} });

const LANDING =
  '<html><head><title>Sorting cells by shape | Journal of Cells</title><meta name="citation_arxiv_id" content="' +
  PAPER +
  'v2"><meta name="citation_doi" content="10.5555/cells.2026.01"></head><body><article><h1>Sorting cells by shape</h1>' +
  `<p>${"We sort cells by their shape with a small model that runs on the sorter. ".repeat(8)}</p></article></body></html>`;

test("a landing page whose head names its arXiv version is read through arXiv", async () => {
  const url = "https://doi.org/10.5555/cells.2026.01";
  const opened = await openOriginal(url, { fetch: pageAt(LANDING), extractReadable: extract, readers: [] });
  expect(opened).toMatchObject({ ok: true, arxivId: PAPER });
  const got = await readSource({ kind: "page", url }, deps({ fetchText: arxivHtml, openLink: async () => opened }), signal);
  if (!got.ok) throw new Error(got.reason);
  expect(got.input.reader).toBe("arxiv");
  expect(got.input.url).toBe(`https://arxiv.org/abs/${PAPER}`);
  expect(got.steps[0]).toMatchObject({ step: "page", ok: true });
  // Without arXiv's answer the landing page itself is the read.
  const fallback = await readSource({ kind: "page", url }, deps({ openLink: async () => opened }), signal);
  if (!fallback.ok) throw new Error(fallback.reason);
  expect(fallback.input.reader).toBe("web");
  expect(fallback.input.url).toBe(url);
});

test("a page without such a head is read as it is", async () => {
  const plain = LANDING.replace(/<meta name="citation_arxiv_id"[^>]*>/, "");
  const opened = await openOriginal("https://journal.example/cells/1", { fetch: pageAt(plain), extractReadable: extract, readers: [] });
  expect(opened.ok && opened.arxivId).toBeFalsy();
});

test("a post's DOI link is an original, after its arXiv paper and before its repository", () => {
  const member = (key: string, over: Record<string, unknown>) => ({ key, mainUrl: null, cand: { post: null, paper: null, links: [], ...over } });
  const post = member(`x:${POST.id}`, {
    post: POST,
    links: [
      { url: "https://github.com/fern-lab/sorter", card: false },
      { url: "https://www.nature.com/articles/s41586-026-00001-1", card: false },
    ],
  });
  const draft = { cluster: { events: [{ key: `x:${POST.id}`, members: [post] }] }, members: [post] } as unknown as Draft;
  expect(targetsOf(draft)).toEqual([
    { kind: "post", post: POST },
    { kind: "page", url: "https://www.nature.com/articles/s41586-026-00001-1" },
    { kind: "repo", owner: "fern-lab", repo: "sorter", url: "https://github.com/fern-lab/sorter" },
  ]);
});

test("a short link is keyed by where it goes: to a paper it is read as the paper, to something listed it is skipped", async () => {
  const resolved: string[] = [];
  const resolveShortLink = async (url: string) => {
    resolved.push(url);
    return url === "https://goo.gle/fern" ? `https://arxiv.org/abs/${PAPER}` : "https://github.com/fern-lab/sorter";
  };
  const opened: string[] = [];
  const reg = registry();
  const targets = [
    { kind: "repo" as const, owner: "fern-lab", repo: "sorter", url: "https://github.com/fern-lab/sorter" },
    { kind: "page" as const, url: "https://bit.ly/fern-code" },
    { kind: "page" as const, url: "https://goo.gle/fern" },
  ];
  const got = await readOriginals(targets, deps({ fetchText: arxivHtml, opened, resolveShortLink }), reg, signal);
  // The repository is read; bit.ly leads back to it and takes no place; goo.gle is the paper.
  expect(resolved).toEqual(["https://bit.ly/fern-code", "https://goo.gle/fern"]);
  expect(opened).toEqual([]);
  expect(got.materials.map((id) => reg.get(id)!.reader)).toContain("arxiv");
});

test("one page under two spellings is read once", async () => {
  const opened: string[] = [];
  const openLink: OpenLink = async (url) =>
    url === POST.permalink
      ? { ok: true, via: "x", title: null, author: null, publishedAt: null, sections: [{ heading: null, html: "<p>see the post</p>" }], whole: null, links: [] }
      : { ok: false, code: "not_found", reason: "not here" };
  const post = {
    ...POST,
    truncated: true,
    links: [
      { tco: null, url: "http://www.fern.example/blog/sorter?utm_source=x", card: false },
      { tco: null, url: "https://fern.example/blog/sorter/", card: false },
    ],
  };
  await readOriginals([{ kind: "post", post }], deps({ openLink, opened }), registry(), signal);
  expect(opened).toEqual([POST.permalink, "http://www.fern.example/blog/sorter?utm_source=x"]);
});
