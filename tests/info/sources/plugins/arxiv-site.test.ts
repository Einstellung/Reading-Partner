// A pasted arXiv link read as the paper (src/info/sources/plugins/arxiv.ts's
// site adapter, docs/85): which links it claims, and what the bindery hands back
// for one: the PDF whole, named by the export API's title, or by its id when
// the lookup fails. The fetch is scripted with the export API's answers.
// Run: bash scripts/t.sh tests/info/sources/plugins/arxiv-site.test.ts

import { afterEach, expect, test } from "bun:test";
import { arxivPaperOfUrl } from "../../../../src/info/sources/plugins/arxiv-client";
import { arxivSiteAdapter } from "../../../../src/info/sources/plugins/arxiv";
import { registerSourceSiteAdapters } from "../../../../src/info/sources/plugins/all";
import {
  bind,
  registerSiteAdapter,
  registeredSiteAdapters,
  siteAdapterFor,
  type FetchedBytes,
} from "../../../../src/workshop/bindery";
import {
  apiUrl,
  ATTENTION_ATOM,
  ERROR_ATOM,
  MALDACENA_ATOM,
  NOT_FOUND,
  pdfUrl,
  PDF_HEAD,
  served,
  UNAVAILABLE,
} from "./arxiv-fixtures";

let undo: (() => void) | null = null;
afterEach(() => {
  undo?.();
  undo = null;
});

function scripted(responses: Record<string, FetchedBytes | Error>) {
  const fetched: string[] = [];
  return {
    fetched,
    fetch: async (url: string): Promise<FetchedBytes> => {
      fetched.push(url);
      const answer = responses[url] ?? NOT_FOUND;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const ATTENTION = {
  [pdfUrl("1706.03762")]: served(PDF_HEAD, "application/pdf"),
  [apiUrl("1706.03762")]: served(ATTENTION_ATOM, "application/atom+xml; charset=utf-8"),
};

async function bound(url: string, responses: Record<string, FetchedBytes | Error>) {
  undo = registerSiteAdapter(arxivSiteAdapter);
  const host = scripted(responses);
  return { result: await bind({ kind: "url", url }, { fetch: host.fetch }), fetched: host.fetched };
}

// --- which links ------------------------------------------------------------

test("abstract and PDF links name the paper, with the version when they give one", () => {
  expect(arxivPaperOfUrl("https://arxiv.org/abs/1706.03762")).toEqual({ id: "1706.03762" });
  expect(arxivPaperOfUrl("https://arxiv.org/abs/1706.03762v5")).toEqual({ id: "1706.03762", version: "v5" });
  expect(arxivPaperOfUrl("https://arxiv.org/pdf/1706.03762")).toEqual({ id: "1706.03762" });
  expect(arxivPaperOfUrl("https://arxiv.org/pdf/1706.03762v2.pdf")).toEqual({ id: "1706.03762", version: "v2" });
  expect(arxivPaperOfUrl("http://www.arxiv.org/abs/2505.06708/")).toEqual({ id: "2505.06708" });
  expect(arxivPaperOfUrl("https://export.arxiv.org/abs/2505.06708?context=cs")).toEqual({ id: "2505.06708" });
  expect(arxivPaperOfUrl("https://arxiv.org/abs/2505.06708#S2")).toEqual({ id: "2505.06708" });
});

test("old-style ids are read whole, archive and subject class included", () => {
  expect(arxivPaperOfUrl("https://arxiv.org/abs/hep-th/9901001")).toEqual({ id: "hep-th/9901001" });
  expect(arxivPaperOfUrl("https://arxiv.org/abs/hep-th/9711200v3")).toEqual({ id: "hep-th/9711200", version: "v3" });
  expect(arxivPaperOfUrl("https://arxiv.org/pdf/math.GT/0309136")).toEqual({ id: "math.GT/0309136" });
});

test("the mirrors that keep arXiv's path are the same paper", () => {
  expect(arxivPaperOfUrl("https://www.alphaxiv.org/abs/2505.06708")).toEqual({ id: "2505.06708" });
  expect(arxivPaperOfUrl("https://www.alphaxiv.org/overview/2505.06708v1")).toEqual({ id: "2505.06708", version: "v1" });
  expect(arxivPaperOfUrl("https://ar5iv.labs.arxiv.org/html/1706.03762")).toEqual({ id: "1706.03762" });
  expect(arxivPaperOfUrl("https://ar5iv.org/abs/1706.03762")).toEqual({ id: "1706.03762" });
});

test("anything else is not claimed", () => {
  for (const url of [
    "https://example.com/abs/1706.03762",
    "https://example.com/papers/attention.pdf",
    "https://arxiv.org/list/cs.AI/recent",
    "https://arxiv.org/abs/",
    "https://arxiv.org/a/vaswani_a_1",
    "https://arxiv.org/abs/1706.037",
    "https://notarxiv.org/abs/1706.03762",
    "https://arxiv.org.evil.com/abs/1706.03762",
    "ftp://arxiv.org/abs/1706.03762",
    "not a url",
  ]) {
    expect(arxivPaperOfUrl(url)).toBeNull();
  }
  undo = registerSiteAdapter(arxivSiteAdapter);
  expect(siteAdapterFor({ kind: "url", url: "https://example.com/post" })).toBeNull();
  // Only a bare link: a page someone already fetched is the web adapter's.
  expect(
    siteAdapterFor({ kind: "web", url: "https://arxiv.org/abs/1706.03762", html: "<p>abstract</p>" }),
  ).toBeNull();
  expect(siteAdapterFor({ kind: "url", url: "https://arxiv.org/abs/1706.03762" })?.name).toBe("arxiv");
});

test("the plugin set hands the bindery the arXiv adapter", () => {
  registerSourceSiteAdapters();
  undo = registerSiteAdapter(arxivSiteAdapter);
  expect(registeredSiteAdapters()).toContain("arxiv");
});

// --- what comes back ----------------------------------------------------------

test("an abstract page comes back as the paper's PDF with its real metadata", async () => {
  const { result, fetched } = await bound("https://arxiv.org/abs/1706.03762", ATTENTION);
  expect(result.ok && "passedThrough" in result).toBe(true);
  if (!result.ok || !("passedThrough" in result)) return;
  expect(result.format).toBe("pdf");
  expect(result.bytes).toEqual(PDF_HEAD);
  expect(result.metadata).toEqual({
    title: "Attention Is All You Need",
    author: "Ashish Vaswani et al.",
    publishedAt: "2017-06-12T17:57:34Z",
    sourceUrl: "https://arxiv.org/abs/1706.03762",
    abstract:
      "The dominant sequence transduction models are based on complex recurrent or " +
      "convolutional neural networks in an encoder-decoder configuration. We propose a " +
      "new simple network architecture, the Transformer.",
    adapter: "arxiv",
  });
  // The PDF first, then the one API call; the abstract page is never fetched.
  expect(fetched).toEqual([pdfUrl("1706.03762"), apiUrl("1706.03762")]);
});

test("a PDF link comes back under the paper's title, not its id", async () => {
  const { result } = await bound("https://arxiv.org/pdf/1706.03762", ATTENTION);
  expect(result.ok && result.metadata.title).toBe("Attention Is All You Need");
});

test("a versioned link fetches that version's PDF and entry", async () => {
  const { result, fetched } = await bound("https://arxiv.org/abs/1706.03762v5", {
    [pdfUrl("1706.03762v5")]: served(PDF_HEAD, "application/pdf"),
    [apiUrl("1706.03762v5")]: served(ATTENTION_ATOM, "application/atom+xml"),
  });
  expect(fetched).toEqual([pdfUrl("1706.03762v5"), apiUrl("1706.03762v5")]);
  expect(result.ok && result.metadata.title).toBe("Attention Is All You Need");
  expect(result.ok && result.metadata.sourceUrl).toBe("https://arxiv.org/abs/1706.03762v5");
});

test("an old-style id is looked up and fetched as itself", async () => {
  const { result, fetched } = await bound("https://arxiv.org/abs/hep-th/9711200", {
    [pdfUrl("hep-th/9711200")]: served(PDF_HEAD, "application/pdf"),
    [apiUrl("hep-th/9711200")]: served(MALDACENA_ATOM, "application/atom+xml"),
  });
  expect(fetched).toEqual([pdfUrl("hep-th/9711200"), apiUrl("hep-th/9711200")]);
  expect(result.ok && result.metadata).toMatchObject({
    title: "The Large N Limit of Superconformal Field Theories and Supergravity",
    author: "Juan M. Maldacena",
    publishedAt: "1997-11-27T22:22:59Z",
  });
});

test("a failed lookup still hands back the PDF, named by its id", async () => {
  const pdf = { [pdfUrl("1706.03762")]: served(PDF_HEAD, "application/pdf") };
  for (const api of [UNAVAILABLE, new Error("network down"), served(ERROR_ATOM, "application/atom+xml")]) {
    const { result } = await bound("https://arxiv.org/abs/1706.03762", {
      ...pdf,
      [apiUrl("1706.03762")]: api,
    });
    expect(result.ok && "passedThrough" in result).toBe(true);
    if (!result.ok || !("passedThrough" in result)) continue;
    expect(result.bytes).toEqual(PDF_HEAD);
    expect(result.metadata).toEqual({
      title: "arXiv 1706.03762",
      sourceUrl: "https://arxiv.org/abs/1706.03762",
      adapter: "arxiv",
    });
  }
});

test("no PDF is a rejection, and the lookup is not made for it", async () => {
  const missing = await bound("https://arxiv.org/abs/1706.03762", {});
  expect(missing.result).toEqual({
    ok: false,
    reason: "unreachable",
    message: "arXiv answered HTTP 404 for the PDF of 1706.03762",
  });
  expect(missing.fetched).toEqual([pdfUrl("1706.03762")]);

  const page = await bound("https://arxiv.org/pdf/1706.03762", {
    [pdfUrl("1706.03762")]: served("<html><body>PDF unavailable</body></html>", "text/html"),
  });
  expect(page.result).toMatchObject({ ok: false, reason: "unreachable" });

  const down = await bound("https://arxiv.org/pdf/1706.03762", {
    [pdfUrl("1706.03762")]: new Error("network down"),
  });
  expect(down.result).toMatchObject({ ok: false, reason: "unreachable" });
});
