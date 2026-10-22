// Semantic Scholar's graph-expansion calls (docs/info/92): the id batch, the
// recommendations and the edge pages. Recorded answers, fake fetch, no network.

import { expect, test } from "bun:test";
import {
  fetchS2Batch,
  fetchS2EdgePage,
  fetchS2Recommendations,
  s2BatchUrl,
  s2CitationsUrl,
  s2RecommendationsUrl,
  S2_BATCH_MAX,
  S2_GRAPH_CITATIONS_PAGE,
  S2_GRAPH_REFERENCES_PAGE,
} from "../../../../src/info/sources/plugins/s2-client";
import { S2_BATCH, S2_CITATIONS, S2_EDGES_ELIDED, S2_RECOMMENDATIONS, S2_RECOMMENDATIONS_NOT_FOUND } from "./graph-fixtures";

type Seen = { url: string; method: string; key: string | null; type: string | null; body: unknown };

function recorder(status: number, answer: unknown) {
  const seen: Seen[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      method: init?.method ?? "GET",
      key: headers.get("x-api-key"),
      type: headers.get("content-type"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(answer), { status });
  };
  return { seen, fetchFn };
}

test("the batch posts the ids with the key in a header and answers one entry per id", async () => {
  const { seen, fetchFn } = recorder(200, S2_BATCH);
  const ids = ["ARXIV:1706.03762", "DOI:10.1038/s41586-021-03819-2", "ARXIV:9912.99999"];
  const hits = await fetchS2Batch(ids, fetchFn, "secret-key");
  expect(seen[0].method).toBe("POST");
  expect(seen[0].url).toBe(s2BatchUrl());
  expect(seen[0].url).not.toContain("secret-key");
  expect(seen[0].key).toBe("secret-key");
  expect(seen[0].type).toBe("application/json");
  expect(seen[0].body).toEqual({ ids });
  expect(hits.length).toBe(3);
  expect(hits[0]?.arxivId).toBe("1706.03762");
  expect(hits[0]?.paperId).toBe("204e3073870fae3d05bcbc2f6a8e263d9b72e776");
  expect(hits[0]?.publicationDate).toBe("2017-06-12");
  expect(hits[0]?.abstract).toContain("sequence transduction");
  expect(hits[1]?.arxivId).toBeNull();
  expect(hits[1]?.doi).toBe("10.1038/s41586-021-03819-2");
  expect(hits[1]?.citationCount).toBe(30000);
  expect(hits[2]).toBeNull();
});

test("the batch asks for the expansion's fields and sends no more than S2 takes", async () => {
  const url = decodeURIComponent(s2BatchUrl());
  for (const f of ["externalIds", "abstract", "publicationDate", "citationCount", "authors"]) expect(url).toContain(f);
  const { seen, fetchFn } = recorder(200, []);
  const many = Array.from({ length: S2_BATCH_MAX + 3 }, (_, i) => `ARXIV:2401.${String(i).padStart(5, "0")}`);
  const hits = await fetchS2Batch(many, fetchFn);
  expect((seen[0].body as { ids: string[] }).ids.length).toBe(S2_BATCH_MAX);
  expect(seen[0].key).toBeNull();
  // A short answer reads as unknown ids, not as a crash.
  expect(hits.length).toBe(S2_BATCH_MAX);
  expect(hits.every((h) => h === null)).toBe(true);
  expect(await fetchS2Batch([], fetchFn)).toEqual([]);
  expect(seen.length).toBe(1);
});

test("recommendations post the positives and negatives and drop untitled papers", async () => {
  const { seen, fetchFn } = recorder(200, S2_RECOMMENDATIONS);
  const hits = await fetchS2Recommendations({ positive: ["p1", "DOI:10.1/x"], negative: ["n1"] }, { limit: 100 }, fetchFn, "k");
  expect(seen[0].method).toBe("POST");
  expect(seen[0].url).toContain("/recommendations/v1/papers/?limit=100&fields=");
  expect(seen[0].body).toEqual({ positivePaperIds: ["p1", "DOI:10.1/x"], negativePaperIds: ["n1"] });
  expect(hits?.map((h) => h.title)).toEqual(["Protein structure prediction at scale", "A bioRxiv preprint on folding"]);
  expect(hits?.[0].arxivId).toBe("2609.01234");
  expect(hits?.[1].arxivId).toBeNull();
  expect(decodeURIComponent(s2RecommendationsUrl(9999))).toContain("limit=500");
});

test("recommendations for positives S2 does not know are a miss; a server error is a failure", async () => {
  const miss = recorder(404, S2_RECOMMENDATIONS_NOT_FOUND);
  expect(await fetchS2Recommendations({ positive: ["x"], negative: [] }, {}, miss.fetchFn)).toBeNull();
  const broken = recorder(400, { error: "bad id" });
  await expect(fetchS2Recommendations({ positive: ["x"], negative: [] }, {}, broken.fetchFn)).rejects.toThrow(/400/);
});

test("an edge page tells edges, an unknown paper and withheld edges apart", async () => {
  const ok = recorder(200, S2_CITATIONS);
  const page = await fetchS2EdgePage("ARXIV:1706.03762", "citations", ok.fetchFn, "k");
  expect(page.kind).toBe("ok");
  if (page.kind !== "ok") throw new Error("unreachable");
  expect(page.hits.map((h) => h.arxivId)).toEqual(["2610.00001", null]);
  expect(page.hits[0].publicationDate).toBe("2026-10-01");
  expect(page.hits[1].doi).toBe("10.1016/j.x.2026.1");
  expect(ok.seen[0].key).toBe("k");
  const url = decodeURIComponent(ok.seen[0].url);
  expect(url).toContain(`limit=${S2_GRAPH_CITATIONS_PAGE}`);
  for (const f of ["externalIds", "abstract", "publicationDate"]) expect(url).toContain(f);
  // docs/pitfall/73: no year filter on an edge endpoint.
  expect(url).not.toContain("year=");
  expect(url).not.toContain("publicationDateOrYear");

  const refs = recorder(200, { data: [] });
  expect(await fetchS2EdgePage("p1", "references", refs.fetchFn)).toEqual({ kind: "ok", hits: [] });
  expect(decodeURIComponent(refs.seen[0].url)).toContain(`/paper/p1/references?fields=`);
  expect(decodeURIComponent(refs.seen[0].url)).toContain(`limit=${S2_GRAPH_REFERENCES_PAGE}`);

  expect(await fetchS2EdgePage("p1", "references", recorder(404, {}).fetchFn)).toEqual({ kind: "not_found" });
  expect(await fetchS2EdgePage("p1", "references", recorder(200, S2_EDGES_ELIDED).fetchFn)).toEqual({ kind: "elided" });
});

test("the reading side's edge urls keep their page sizes and fields", () => {
  const url = decodeURIComponent(s2CitationsUrl("s1"));
  expect(url).toContain("limit=100");
  expect(url).not.toContain("publicationDate");
});
