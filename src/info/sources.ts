// Source endpoints and the request identity for the info briefing (docs/16).
// Both feeds gate on a browser User-Agent: jiqizhixin's JSON API needs one, and
// qbitai's WordPress returns 403 without it. Kept in one place so the two
// adapters and the http wrapper never disagree on host or UA.

// A plain desktop-browser UA. The feeds reject the polite bot UA the prep
// pipeline uses (arxiv/openalex), so this path presents as an ordinary browser.
export const INFO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const JIQIZHIXIN = {
  // Article list; per=20 pulls one page (the API paginates with page/per).
  list: "https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=20",
  // Full text by slug (e.g. "2026-07-20-23").
  article: (slug: string) =>
    `https://www.jiqizhixin.com/api/article_library/articles/${encodeURIComponent(slug)}.json`,
} as const;

export const QBITAI = {
  // Native WordPress RSS: ~10 items, title/link/pubDate/category only.
  feed: "https://www.qbitai.com/feed",
} as const;
