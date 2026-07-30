// Semantic Scholar client tests. Fake fetch only. Run: bun test.

import { expect, test } from "bun:test";
import {
  fetchFromS2,
  fetchS2Edges,
  fetchS2Paper,
  parseS2Edges,
  parseS2Search,
  s2CitationsUrl,
  s2ReferencesUrl,
  s2TopicSearchUrl,
  searchS2Topic,
  S2_CITATIONS_PAGE,
  S2_REFERENCES_PAGE,
} from "../../../src/reading/papers/s2";

test("fetchFromS2 sends the api key as x-api-key and keeps it out of the url", async () => {
  const seen: { url: string; key: string | null }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    seen.push({ url, key: new Headers(init?.headers).get("x-api-key") });
    return new Response(
      JSON.stringify({ data: [{ title: "Target", abstract: "a", externalIds: {} }] }),
      { status: 200 },
    );
  };
  const res = await fetchFromS2({ title: "Target", arxivId: null }, fetchFn, "secret-key");
  expect(res?.abstract).toBe("a");
  expect(seen[0].key).toBe("secret-key");
  expect(seen[0].url).not.toContain("secret-key");
});

test("fetchFromS2 without a key sends no x-api-key header", async () => {
  let seenKey: string | null = "unset";
  const fetchFn = async (_url: string, init?: RequestInit) => {
    seenKey = new Headers(init?.headers).get("x-api-key");
    return new Response(JSON.stringify({ data: [{ title: "T", abstract: "b", externalIds: {} }] }), {
      status: 200,
    });
  };
  await fetchFromS2({ title: "T", arxivId: null }, fetchFn);
  expect(seenKey).toBeNull();
});

// --- topic search (docs/24) ---

test("the topic query asks for the candidate fields and an open-ended year range", () => {
  const u = decodeURIComponent(s2TopicSearchUrl("brain evolution", { limit: 4, sinceYear: 2025 }));
  expect(u).toContain("query=brain evolution");
  expect(u).toContain("limit=4");
  expect(u).toContain("authors");
  expect(u).toContain("venue");
  expect(u).toContain("year=2025-");
  expect(decodeURIComponent(s2TopicSearchUrl("x"))).not.toContain("year=");
});

test("parseS2Search maps ids, venue and a fallback link", () => {
  const hits = parseS2Search({
    data: [
      {
        paperId: "abc123",
        title: "Cellular scaling rules",
        abstract: "Brains scale.",
        year: 2007,
        venue: "PNAS",
        authors: [{ name: "Suzana Herculano-Houzel" }, { name: null }],
        externalIds: { DOI: "10.1073/pnas.0611396104", ArXiv: "2303.12345", PubMed: "17553422" },
      },
      // No open-access PDF: the S2 landing page is still somewhere to click.
      { paperId: "def456", title: "No pdf here" },
      { title: "" },
    ],
  });
  expect(hits).toHaveLength(2);
  expect(hits[0].doi).toBe("10.1073/pnas.0611396104");
  expect(hits[0].arxivId).toBe("2303.12345");
  expect(hits[0].pmid).toBe("17553422");
  expect(hits[0].authors).toEqual(["Suzana Herculano-Houzel"]);
  expect(hits[0].venue).toBe("PNAS");
  expect(hits[1].url).toBe("https://www.semanticscholar.org/paper/def456");
  expect(parseS2Search(null)).toEqual([]);
});

// A 429 is not tested here: fetchWithRetry sleeps its 429 backoff, and this call
// site has no sleep to inject. The classification of that outcome is covered in
// paper-search.test.ts, where the error is constructed directly.
test("a status the search cannot use throws instead of reading as no results", async () => {
  await expect(
    searchS2Topic("x", {}, async () => new Response("nope", { status: 403 })),
  ).rejects.toThrow(/403/);
});

// --- citation graph (docs/24) ---

test("the edge urls carry the candidate fields and no year filter", () => {
  // docs/pitfall/73: `year=` on these two endpoints returns 200 and is ignored, so
  // sending it would only make the caller believe it had filtered.
  // The identifier is percent-encoded into the path segment, DOI slash included;
  // verified live 2026-07-30 that S2 still resolves it in that form.
  expect(s2ReferencesUrl("DOI:10.1/x")).toContain("/paper/DOI%3A10.1%2Fx/references");
  const refs = decodeURIComponent(s2ReferencesUrl("DOI:10.1/x"));
  expect(refs).toContain("citationCount");
  expect(refs).toContain(`limit=${S2_REFERENCES_PAGE}`);
  expect(refs).not.toContain("year=");
  expect(decodeURIComponent(s2CitationsUrl("s1"))).toContain(`limit=${S2_CITATIONS_PAGE}`);
});

test("parseS2Edges unwraps the direction's key and survives a null page", () => {
  const refs = parseS2Edges(
    { data: [{ citedPaper: { paperId: "r1", title: "A reference", year: 2002, citationCount: 9 } }] },
    "citedPaper",
  );
  expect(refs[0].title).toBe("A reference");
  expect(refs[0].citationCount).toBe(9);
  expect(refs[0].paperId).toBe("r1");

  // A publisher that elided the reference list: 200 with data: null, which the
  // documented shape says cannot happen. Reading it as an array throws.
  expect(parseS2Edges({ data: null, citingPaperInfo: { title: "Seed" } }, "citedPaper")).toEqual([]);
  expect(parseS2Edges(null, "citingPaper")).toEqual([]);
  // A blanked row and a row under the other direction's key are both dropped.
  expect(parseS2Edges({ data: [{ citedPaper: null }, { citingPaper: { title: "X" } }] }, "citedPaper")).toEqual([]);
});

test("a seed S2 does not know is a miss, not a failure", async () => {
  expect(await fetchS2Paper("DOI:10.1/nope", async () => new Response("", { status: 404 }))).toBeNull();
  expect(await fetchS2Edges("DOI:10.1/nope", "references", async () => new Response("", { status: 404 }))).toEqual([]);
  await expect(
    fetchS2Edges("DOI:10.1/x", "citations", async () => new Response("", { status: 500 })),
  ).rejects.toThrow(/500/);
});
