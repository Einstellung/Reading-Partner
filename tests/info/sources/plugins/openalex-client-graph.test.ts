// OpenAlex's side of the graph expansion (docs/info/92): related works, lookups
// by arXiv DOI, the optional key and the day window. Recorded answers, fake
// fetch, no network.

import { expect, test } from "bun:test";
import {
  extractArxivId,
  fetchOpenAlexCitedBy,
  fetchOpenAlexWork,
  fetchOpenAlexWorksByArxiv,
  openAlexArxivHandle,
  openAlexCitedByUrl,
  openAlexWorkUrl,
  openAlexWorksByArxivUrl,
  openAlexWorksByIdUrl,
  OA_MAX_OR_IDS,
} from "../../../../src/info/sources/plugins/openalex-client";
import { OA_WORK_WITH_EDGES, OA_WORKS_BY_ARXIV } from "./graph-fixtures";

function recorder(status: number, answer: unknown) {
  const seen: { url: string; auth: string | null }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(answer), { status });
  };
  return { seen, fetchFn };
}

test("a work looked up by its arXiv DOI comes with its references and related works", async () => {
  expect(openAlexArxivHandle("1706.03762")).toBe("doi:10.48550/arXiv.1706.03762");
  const { seen, fetchFn } = recorder(200, OA_WORK_WITH_EDGES);
  const work = await fetchOpenAlexWork(openAlexArxivHandle("1706.03762"), fetchFn);
  expect(seen[0].url).toBe(openAlexWorkUrl("doi:10.48550/arXiv.1706.03762"));
  expect(decodeURIComponent(seen[0].url)).toContain("/works/doi:10.48550/arXiv.1706.03762?");
  expect(seen[0].url).toContain("related_works");
  expect(seen[0].auth).toBeNull();
  expect(work?.hit.openAlexId).toBe("W2626778328");
  expect(work?.hit.arxivId).toBe("1706.03762");
  expect(work?.hit.publicationDate).toBe("2025-08-23");
  expect(work?.referenced).toEqual(["W2064675550", "W2194775991"]);
  expect(work?.related).toEqual(["W2965373594", "W2964308564"]);
});

test("the key goes as a bearer header and never into the url", async () => {
  const { seen, fetchFn } = recorder(200, { meta: { count: 0 }, results: [] });
  await fetchOpenAlexCitedBy("W1", { since: "2025-10-22", limit: 100 }, fetchFn, "oa-secret");
  await fetchOpenAlexWorksByArxiv(["2401.00001"], fetchFn, "oa-secret");
  const work = recorder(200, OA_WORK_WITH_EDGES);
  await fetchOpenAlexWork("W1", work.fetchFn, "oa-secret");
  seen.push(...work.seen);
  expect(seen.length).toBe(3);
  for (const s of seen) {
    expect(s.auth).toBe("Bearer oa-secret");
    expect(s.url).not.toContain("oa-secret");
    expect(s.url).not.toContain("api_key");
  }
});

test("the citing works are windowed by day, which wins over a year", () => {
  const url = openAlexCitedByUrl("W1", { since: "2025-10-22", sinceYear: 2020, limit: 100 });
  expect(url).toContain("filter=cites:W1,from_publication_date:2025-10-22&");
  expect(url).not.toContain("2020-01-01");
  expect(url).toContain("per-page=100");
  expect(openAlexCitedByUrl("W1", { sinceYear: 2024 })).toContain("from_publication_date:2024-01-01");
  expect(openAlexWorksByIdUrl(["W1", "W2"], { since: "2025-10-22" })).toContain("openalex_id:W1|W2,from_publication_date:2025-10-22");
});

test("works by arXiv id ask by DOI and map back through the locations", async () => {
  const ids = Array.from({ length: OA_MAX_OR_IDS + 5 }, (_, i) => `2401.${String(i).padStart(5, "0")}`);
  const url = openAlexWorksByArxivUrl(ids);
  expect(url).toContain("filter=doi:10.48550/arxiv.2401.00000|10.48550/arxiv.2401.00001|");
  expect(url.split("10.48550/arxiv.").length - 1).toBe(OA_MAX_OR_IDS);
  expect(openAlexWorksByArxivUrl(["2401.0001V2"])).toContain("10.48550/arxiv.2401.0001v2");

  const { fetchFn } = recorder(200, OA_WORKS_BY_ARXIV);
  const hits = await fetchOpenAlexWorksByArxiv(["2501.12948", "1706.03762"], fetchFn);
  // Neither came back under its arXiv DOI; the locations still name the arXiv copy.
  expect(hits.map((h) => h.doi)).toEqual(["https://doi.org/10.65215/2q58a426", "https://doi.org/10.4230/oasics.icpec.2025.4"]);
  expect(hits.map((h) => h.arxivId)).toEqual(["1706.03762", "2501.12948"]);
  expect(hits[0].abstract).toBe("The dominant models");
  // The second is another paper that holds the arXiv copy (docs/pitfall/668):
  // only a title check tells, and that is the caller's.
  expect(hits[1].title).toBe("Can Open Large Language Models Catch Vulnerabilities?");
  expect(await fetchOpenAlexWorksByArxiv([], fetchFn)).toEqual([]);
});

test("a work known only as the preprint gives its arXiv id through its DOI", () => {
  expect(extractArxivId({ doi: "https://doi.org/10.48550/arxiv.2005.14165" })).toBe("2005.14165");
  expect(extractArxivId({ ids: { doi: "https://doi.org/10.48550/arXiv.2005.14165" } })).toBe("2005.14165");
  expect(extractArxivId({ doi: "https://doi.org/10.1038/x" })).toBeNull();
});
