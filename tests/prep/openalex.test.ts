// OpenAlex client tests. Fake fetch only, no network. Run: bun test.

import { expect, test } from "bun:test";
import {
  fetchFromOpenAlex,
  reconstructAbstract,
  extractArxivId,
  extractPdfUrl,
  openAlexSearchUrl,
} from "../../src/prep/openalex";

test("reconstructAbstract rebuilds word order from the inverted index", () => {
  const index = { The: [0], quick: [1], brown: [2], fox: [3] };
  expect(reconstructAbstract(index)).toBe("The quick brown fox");
});

test("reconstructAbstract places a repeated word at every position", () => {
  // "models" recurs; "the" recurs — both must land in each slot they name.
  const index = { the: [0, 3], models: [1, 4], are: [2], good: [5] };
  expect(reconstructAbstract(index)).toBe("the models are the models good");
});

test("reconstructAbstract returns empty string for a missing index", () => {
  expect(reconstructAbstract(null)).toBe("");
  expect(reconstructAbstract(undefined)).toBe("");
});

test("extractArxivId reads an arxiv landing/pdf url from locations", () => {
  const work = {
    locations: [
      { landing_page_url: "https://doi.org/10.1/x", pdf_url: null },
      { landing_page_url: "http://arxiv.org/abs/1706.03762v5", pdf_url: "https://arxiv.org/pdf/1706.03762" },
    ],
  };
  expect(extractArxivId(work)).toBe("1706.03762");
});

test("extractArxivId returns null when no location is on arxiv", () => {
  const work = {
    best_oa_location: { pdf_url: "https://example.com/paper.pdf", landing_page_url: "https://example.com/p" },
    locations: [{ landing_page_url: "https://doi.org/10.1/x", pdf_url: null }],
  };
  expect(extractArxivId(work)).toBeNull();
});

test("extractPdfUrl prefers best_oa_location.pdf_url then falls back to oa_url", () => {
  expect(
    extractPdfUrl({ best_oa_location: { pdf_url: "https://a/1.pdf" }, open_access: { oa_url: "https://b/2" } }),
  ).toBe("https://a/1.pdf");
  expect(
    extractPdfUrl({ best_oa_location: { pdf_url: null }, open_access: { oa_url: "https://b/2" } }),
  ).toBe("https://b/2");
  expect(extractPdfUrl({})).toBeNull();
});

test("openAlexSearchUrl uses title.search and carries the mailto param", () => {
  const url = openAlexSearchUrl("Attention Is All You Need");
  expect(url).toContain("filter=title.search:");
  expect(url).toContain("Attention%20Is%20All%20You%20Need");
  expect(url).toContain("mailto=einstellungsu@gmail.com");
  expect(url).toContain("per-page=5");
});

function work(overrides: Record<string, unknown> = {}) {
  return {
    display_name: "Target Paper",
    publication_year: 2020,
    abstract_inverted_index: { An: [0], abstract: [1] },
    ...overrides,
  };
}

test("fetchFromOpenAlex sends mailto on every request and matches by title", async () => {
  const urls: string[] = [];
  const fetchFn = async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ results: [work()] }), { status: 200 });
  };
  const res = await fetchFromOpenAlex({ title: "Target Paper", arxivId: null }, fetchFn);
  expect(res?.abstract).toBe("An abstract");
  expect(urls[0]).toContain("mailto=einstellungsu@gmail.com");
});

test("fetchFromOpenAlex returns null when no result title matches", async () => {
  const fetchFn = async () =>
    new Response(JSON.stringify({ results: [work({ display_name: "Something Else Entirely" })] }), {
      status: 200,
    });
  const res = await fetchFromOpenAlex({ title: "Target Paper", arxivId: null }, fetchFn);
  expect(res).toBeNull();
});

test("fetchFromOpenAlex extracts the arxiv id from the matched work", async () => {
  const fetchFn = async () =>
    new Response(
      JSON.stringify({
        results: [
          work({ locations: [{ landing_page_url: "https://arxiv.org/abs/2303.12345", pdf_url: null }] }),
        ],
      }),
      { status: 200 },
    );
  const res = await fetchFromOpenAlex({ title: "Target Paper", arxivId: null }, fetchFn);
  expect(res?.arxivId).toBe("2303.12345");
});

test("fetchFromOpenAlex downloads the PDF when the OA url is reachable", async () => {
  const pdf = new Uint8Array([1, 2, 3, 4]).buffer;
  const fetchFn = async (url: string) => {
    if (url.includes("api.openalex.org")) {
      return new Response(
        JSON.stringify({ results: [work({ best_oa_location: { pdf_url: "https://oa.example/p.pdf" } })] }),
        { status: 200 },
      );
    }
    return new Response(pdf, { status: 200 });
  };
  const res = await fetchFromOpenAlex({ title: "Target Paper", arxivId: null }, fetchFn);
  expect(res?.pdfBytes).not.toBeNull();
  expect(res?.pdfBytes?.byteLength).toBe(4);
});

test("fetchFromOpenAlex degrades to abstract-only when the PDF fetch misses", async () => {
  // A blocked/unreachable PDF host surfaces as a non-ok response (or a throw);
  // either way the paper degrades to its abstract rather than failing.
  const fetchFn = async (url: string) => {
    if (url.includes("api.openalex.org")) {
      return new Response(
        JSON.stringify({ results: [work({ best_oa_location: { pdf_url: "https://blocked.example/p.pdf" } })] }),
        { status: 200 },
      );
    }
    return new Response("nope", { status: 404 });
  };
  const res = await fetchFromOpenAlex({ title: "Target Paper", arxivId: null }, fetchFn);
  expect(res?.pdfBytes).toBeNull();
  expect(res?.abstract).toBe("An abstract");
});

test("fetchFromOpenAlex returns abstract-only when there is no pdf url at all", async () => {
  const fetchFn = async () => new Response(JSON.stringify({ results: [work()] }), { status: 200 });
  const res = await fetchFromOpenAlex({ title: "Target Paper", arxivId: null }, fetchFn);
  expect(res?.pdfBytes).toBeNull();
  expect(res?.abstract).toBe("An abstract");
});
