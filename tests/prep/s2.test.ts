// Semantic Scholar client tests. Fake fetch only. Run: bun test.

import { expect, test } from "bun:test";
import { fetchFromS2 } from "../../src/prep/s2";

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
