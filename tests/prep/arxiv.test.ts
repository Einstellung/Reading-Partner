// Unit tests for the arXiv client's pure parts and the retry helper.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  arxivIdUrl,
  arxivTitleSearchUrl,
  fetchFromArxiv,
  normalizeArxivId,
  parseArxivAtom,
  pickArxivMatch,
} from "../../src/prep/arxiv";
import { backoffMs, fetchWithRetry } from "../../src/prep/http";

test("normalizeArxivId accepts the shapes references use", () => {
  expect(normalizeArxivId("2212.06817")).toBe("2212.06817");
  expect(normalizeArxivId("arXiv:2212.06817v2")).toBe("2212.06817");
  expect(normalizeArxivId("https://arxiv.org/abs/2212.06817")).toBe("2212.06817");
  expect(normalizeArxivId("https://arxiv.org/pdf/2212.06817v1.pdf")).toBe("2212.06817");
  expect(normalizeArxivId("cs/0112017")).toBe("cs/0112017");
  expect(normalizeArxivId("Robotics Transformer")).toBeNull();
  expect(normalizeArxivId("10.1234/doi")).toBeNull();
});

test("query URLs are shaped for the export API", () => {
  expect(arxivIdUrl("2212.06817")).toContain("id_list=2212.06817");
  // Quotes inside the title would break the ti:"..." phrase; they are stripped.
  const u = arxivTitleSearchUrl('RT-1: "Robotics" Transformer');
  expect(u).toContain("search_query=");
  expect(decodeURIComponent(u)).toContain('ti:"RT-1: Robotics Transformer"');
});

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
  <entry>
    <id>http://arxiv.org/abs/2212.06817v2</id>
    <title>RT-1: Robotics Transformer for Real-World Control at Scale</title>
    <summary>  We present RT-1, a &amp;quot;scalable&amp;quot; model.
      Second line.</summary>
    <author><name>Anthony Brohan</name></author>
    <author><name>Noah Brown</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models...</summary>
    <author><name>Ashish Vaswani</name></author>
  </entry>
</feed>`;

test("parseArxivAtom extracts entries with normalized ids", () => {
  const entries = parseArxivAtom(ATOM);
  expect(entries).toHaveLength(2);
  expect(entries[0].id).toBe("2212.06817");
  expect(entries[0].title).toBe("RT-1: Robotics Transformer for Real-World Control at Scale");
  expect(entries[0].summary).toContain("We present RT-1");
  expect(entries[0].summary).not.toContain("\n");
  expect(entries[0].authors).toEqual(["Anthony Brohan", "Noah Brown"]);
  expect(entries[0].pdfUrl).toBe("https://arxiv.org/pdf/2212.06817");
});

test("pickArxivMatch requires a real title match", () => {
  const entries = parseArxivAtom(ATOM);
  expect(pickArxivMatch(entries, "attention is all you need")?.id).toBe("1706.03762");
  expect(pickArxivMatch(entries, "RT-1: Robotics Transformer")?.id).toBe("2212.06817");
  expect(pickArxivMatch(entries, "A Totally Different Paper")).toBeNull();
});

test("backoffMs grows exponentially", () => {
  expect(backoffMs(0, 1000)).toBe(1000);
  expect(backoffMs(1, 1000)).toBeGreaterThanOrEqual(2000);
  expect(backoffMs(2, 1000)).toBeGreaterThanOrEqual(4000);
});

test("fetchFromArxiv falls back to the pre-colon title when the exact search misses", async () => {
  const FULL = "RT-1: Robotics Transformer for Real-World Control at Scale";
  const HEAD_ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>http://arxiv.org/abs/2212.06817v2</id>
      <title>${FULL}</title>
      <summary>We present RT-1.</summary>
      <author><name>Anthony Brohan</name></author>
    </entry>
  </feed>`;
  const queries: string[] = [];
  const fetchFn = async (url: string) => {
    if (url.includes("/pdf/")) return new Response(new ArrayBuffer(2), { status: 200 });
    const decoded = decodeURIComponent(url);
    queries.push(decoded);
    // The head-only query carries a closing quote right after "RT-1".
    if (decoded.includes('ti:"RT-1"')) return new Response(HEAD_ATOM, { status: 200 });
    return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"></feed>`, { status: 200 });
  };
  const res = await fetchFromArxiv({ title: FULL, arxivId: null }, fetchFn);
  expect(res?.arxivId).toBe("2212.06817");
  expect(queries.some((q) => q.includes('ti:"RT-1"'))).toBe(true); // the fallback fired
});

test("fetchWithRetry retries 429/5xx and returns the eventual success", async () => {
  let calls = 0;
  const responses = [
    new Response("slow down", { status: 429 }),
    new Response("oops", { status: 500 }),
    new Response("ok", { status: 200 }),
  ];
  const res = await fetchWithRetry(
    "https://export.arxiv.org/api/query",
    undefined,
    {
      fetchFn: async () => responses[calls++],
      sleep: async () => {},
    },
  );
  expect(res.status).toBe(200);
  expect(calls).toBe(3);
});

test("fetchWithRetry does not retry a 404 and throws after exhausting retries", async () => {
  let calls = 0;
  const notFound = await fetchWithRetry("https://x.test/a", undefined, {
    fetchFn: async () => {
      calls++;
      return new Response("no", { status: 404 });
    },
    sleep: async () => {},
  });
  expect(notFound.status).toBe(404);
  expect(calls).toBe(1);

  await expect(
    fetchWithRetry("https://x.test/b", undefined, {
      retries: 2,
      fetchFn: async () => {
        throw new Error("network down");
      },
      sleep: async () => {},
    }),
  ).rejects.toThrow("network down");
});
