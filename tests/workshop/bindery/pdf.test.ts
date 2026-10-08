// A bare link to a PDF (src/workshop/bindery/pdf.ts, docs/85): fetched once and
// passed through whole when it is a PDF, turned back when the server answered a
// PDF link with a page, and never taking an arXiv link from the arXiv adapter.
// Run: bash scripts/t.sh tests/workshop/bindery/pdf.test.ts

import { afterEach, expect, test } from "bun:test";
import { arxivSiteAdapter } from "../../../src/info/sources/plugins/arxiv";
import {
  bind,
  contentDispositionFilename,
  isPdfBytes,
  registerSiteAdapter,
  type FetchedBytes,
} from "../../../src/workshop/bindery";

let undo: (() => void) | null = null;
afterEach(() => {
  undo?.();
  undo = null;
});

const PDF = new TextEncoder().encode("%PDF-1.4\n%âã\n1 0 obj\n<<>>\nendobj\n");

function served(body: Uint8Array | string, contentType: string, contentDisposition?: string): FetchedBytes {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return { ok: true, status: 200, bytes, contentType, ...(contentDisposition ? { contentDisposition } : {}) };
}

function host(responses: Record<string, FetchedBytes>) {
  const fetched: string[] = [];
  return {
    fetched,
    fetch: async (url: string): Promise<FetchedBytes> => {
      fetched.push(url);
      return responses[url] ?? { ok: false, status: 404, bytes: new Uint8Array(), contentType: null };
    },
  };
}

test("the PDF checks: magic bytes, and the file name a Content-Disposition gives", () => {
  expect(isPdfBytes(PDF)).toBe(true);
  expect(isPdfBytes(new TextEncoder().encode("<!doctype html>"))).toBe(false);
  expect(contentDispositionFilename('attachment; filename="a b.pdf"')).toBe("a b.pdf");
  expect(contentDispositionFilename("inline; filename=plain.pdf")).toBe("plain.pdf");
  expect(contentDispositionFilename("attachment; filename*=UTF-8''%E4%B9%A6.pdf; filename=\"x.pdf\"")).toBe("书.pdf");
  expect(contentDispositionFilename("attachment")).toBeNull();
  expect(contentDispositionFilename(null)).toBeNull();
});

test("a link to a .pdf is passed through whole, named by its file name", async () => {
  const url = "https://example.org/papers/Scaling%20Laws.pdf";
  const h = host({ [url]: served(PDF, "application/pdf") });
  const got = await bind({ kind: "url", url }, { fetch: h.fetch });
  expect(h.fetched).toEqual([url]);
  expect(got).toMatchObject({
    ok: true,
    passedThrough: true,
    format: "pdf",
    metadata: { title: "Scaling Laws", adapter: "pdf", sourceUrl: url },
  });
});

test("a link whose response is a PDF is one too, named by Content-Disposition", async () => {
  const url = "https://example.org/download?id=7";
  const h = host({ [url]: served(PDF, "application/pdf", 'attachment; filename="report-2026.pdf"') });
  expect(await bind({ kind: "url", url }, { fetch: h.fetch })).toMatchObject({
    ok: true,
    passedThrough: true,
    metadata: { title: "report-2026" },
  });
});

test("a .pdf link that serves a web page is turned back, not filed", async () => {
  const url = "https://example.org/paper.pdf";
  const h = host({ [url]: served("<!DOCTYPE html><html><body>Please sign in</body></html>", "application/pdf") });
  const got = await bind({ kind: "url", url }, { fetch: h.fetch });
  expect(got).toMatchObject({ ok: false, reason: "unreachable" });
  expect(!got.ok && got.message).toContain("a web page");
});

test("a link that is not a PDF has no adapter, as before", async () => {
  const url = "https://example.org/article";
  const h = host({ [url]: served("<!doctype html><html><body>Hi</body></html>", "text/html") });
  expect(await bind({ kind: "url", url }, { fetch: h.fetch })).toMatchObject({ ok: false, reason: "no-adapter" });
  const failed = host({});
  expect(await bind({ kind: "url", url: "https://example.org/x.pdf" }, { fetch: failed.fetch })).toMatchObject({
    ok: false,
    reason: "unreachable",
  });
});

test("an arXiv PDF link stays the arXiv adapter's", async () => {
  undo = registerSiteAdapter(arxivSiteAdapter);
  const h = host({ "https://arxiv.org/pdf/1706.03762": served(PDF, "application/pdf") });
  const got = await bind({ kind: "url", url: "https://arxiv.org/pdf/1706.03762v2.pdf" }, { fetch: h.fetch });
  // The arXiv adapter asks for the versioned PDF and the export API; the PDF
  // link adapter would have fetched the URL as given.
  expect(h.fetched).not.toContain("https://arxiv.org/pdf/1706.03762v2.pdf");
  expect(got.ok ? got : null).toBeNull();
  const ok = host({
    "https://arxiv.org/pdf/1706.03762v2": served(PDF, "application/pdf"),
  });
  const paper = await bind({ kind: "url", url: "https://arxiv.org/pdf/1706.03762v2.pdf" }, { fetch: ok.fetch });
  expect(paper).toMatchObject({ ok: true, passedThrough: true, metadata: { adapter: "arxiv" } });
});
