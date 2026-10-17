// A short-lived memo of a run's arXiv page reads (docs/pitfall/502). A paper's
// first read takes the head of its arXiv HTML, and a deeper read (verify.ts
// readPaperFull) asks for the same page again minutes later; with arXiv at one
// request per three seconds and quick to rate-limit, the second fetch is a
// request spent on bytes already in hand. Only 200 answers from arXiv hosts are
// kept, for a while and a handful at a time (an HTML paper runs to megabytes).

import type { FetchText, FetchedText } from "./verify";

const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org"]);

export const MEMO_TTL_MS = 30 * 60_000;
export const MEMO_MAX_ENTRIES = 24;

export function memoArxivFetchText(inner: FetchText, now: () => number = Date.now): FetchText {
  const kept = new Map<string, { at: number; got: Promise<FetchedText> }>();
  return (url, signal) => {
    if (!ARXIV_HOSTS.has(new URL(url).hostname)) return inner(url, signal);
    const t = now();
    const hit = kept.get(url);
    if (hit && t - hit.at < MEMO_TTL_MS) return hit.got;
    const got = inner(url, signal);
    // In the map while in flight, so two reads at once share the one request.
    kept.set(url, { at: t, got });
    while (kept.size > MEMO_MAX_ENTRIES) kept.delete(kept.keys().next().value!);
    got.then(
      (r) => {
        if (r.status !== 200) kept.delete(url);
      },
      () => kept.delete(url),
    );
    return got;
  };
}
