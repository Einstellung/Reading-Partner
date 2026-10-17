import { expect, test } from "bun:test";
import { MEMO_MAX_ENTRIES, MEMO_TTL_MS, memoArxivFetchText } from "../../../src/info/topic-search/fetch-memo";
import type { FetchedText } from "../../../src/info/topic-search/verify";

const signal = new AbortController().signal;

function counting(answer: (url: string) => FetchedText | Error) {
  const calls: string[] = [];
  const fn = async (url: string): Promise<FetchedText> => {
    calls.push(url);
    const a = answer(url);
    if (a instanceof Error) throw a;
    return a;
  };
  return { calls, fn };
}

test("a paper's arXiv HTML read twice in a run is fetched once", async () => {
  let t = 0;
  const inner = counting(() => ({ status: 200, text: "<article>body</article>" }));
  const memo = memoArxivFetchText(inner.fn, () => t);
  const url = "https://arxiv.org/html/2401.00001";
  const [a, b] = await Promise.all([memo(url, signal), memo(url, signal)]);
  expect(await memo(url, signal)).toEqual(a);
  expect(b).toEqual(a);
  expect(inner.calls).toEqual([url]);
  t += MEMO_TTL_MS;
  await memo(url, signal);
  expect(inner.calls.length).toBe(2);
});

test("only 200s from arXiv are kept", async () => {
  const inner = counting((url) =>
    url.includes("fail") ? new Error("network") : { status: url.includes("404") ? 404 : 200, text: "" },
  );
  const memo = memoArxivFetchText(inner.fn, () => 0);
  for (const url of ["https://arxiv.org/html/404", "https://example.com/page", "https://arxiv.org/html/fail"]) {
    await memo(url, signal).catch(() => {});
    await memo(url, signal).catch(() => {});
  }
  expect(inner.calls.length).toBe(6);
});

test("the memo holds a handful of pages, oldest dropped first", async () => {
  const inner = counting(() => ({ status: 200, text: "x" }));
  const memo = memoArxivFetchText(inner.fn, () => 0);
  for (let i = 0; i <= MEMO_MAX_ENTRIES; i++) await memo(`https://arxiv.org/html/${i}`, signal);
  await memo(`https://arxiv.org/html/${MEMO_MAX_ENTRIES}`, signal);
  expect(inner.calls.length).toBe(MEMO_MAX_ENTRIES + 1);
  await memo("https://arxiv.org/html/0", signal);
  expect(inner.calls.length).toBe(MEMO_MAX_ENTRIES + 2);
});
