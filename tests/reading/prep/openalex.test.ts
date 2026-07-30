// OpenAlex client tests. Fake fetch only, no network. Run: bun test.

import { expect, test } from "bun:test";
import {
  fetchFromOpenAlex,
  reconstructAbstract,
  extractArxivId,
  extractPdfUrl,
  openAlexSearchUrl,
  openAlexTopicSearchUrl,
  parseOpenAlexSearch,
  searchOpenAlexTopic,
} from "../../../src/reading/prep/openalex";

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

// --- topic search (docs/24) ---

test("the topic query filters by date and does not sort by it", () => {
  const u = decodeURIComponent(openAlexTopicSearchUrl("brain evolution", { limit: 4, sinceYear: 2025 }));
  expect(u).toContain("search=brain evolution");
  expect(u).toContain("per-page=4");
  expect(u).toContain("filter=from_publication_date:2025-01-01");
  expect(u).toContain("authorships");
  // A date sort returns the newest paper in any field rather than the best match.
  expect(u).not.toContain("sort=");
  expect(openAlexTopicSearchUrl("x")).not.toContain("filter=");
});

const SEARCH_BODY = {
  results: [
    {
      display_name: "Cellular scaling rules for primate brains",
      publication_year: 2007,
      doi: "https://doi.org/10.1073/pnas.0611396104",
      abstract_inverted_index: { Brains: [0], scale: [1] },
      authorships: [
        { author: { display_name: "Suzana Herculano-Houzel" } },
        { author: { display_name: null } },
      ],
      primary_location: {
        landing_page_url: "https://www.pnas.org/doi/10.1073/pnas.0611396104",
        source: { display_name: "PNAS" },
      },
      best_oa_location: { pdf_url: "https://pnas.org/x.pdf" },
      locations: [{ landing_page_url: "https://arxiv.org/abs/2303.12345" }],
    },
    // No title: nothing to show and nothing to dedupe on, so it is dropped.
    { publication_year: 2020 },
  ],
};

test("parseOpenAlexSearch maps a work to a candidate's worth of fields", () => {
  const hits = parseOpenAlexSearch(SEARCH_BODY);
  expect(hits).toHaveLength(1);
  const [h] = hits;
  expect(h.title).toBe("Cellular scaling rules for primate brains");
  expect(h.year).toBe(2007);
  expect(h.doi).toBe("https://doi.org/10.1073/pnas.0611396104");
  expect(h.authors).toEqual(["Suzana Herculano-Houzel"]);
  expect(h.venue).toBe("PNAS");
  // The open-access PDF wins over the landing page.
  expect(h.url).toBe("https://pnas.org/x.pdf");
  expect(h.arxivId).toBe("2303.12345");
  expect(h.abstract).toBe("Brains scale");
  expect(parseOpenAlexSearch(null)).toEqual([]);
});

test("a spent free quota is a 409 that throws rather than an empty result", async () => {
  await expect(
    searchOpenAlexTopic("x", {}, async () => new Response("out of credits", { status: 409 })),
  ).rejects.toThrow(/409/);
});
