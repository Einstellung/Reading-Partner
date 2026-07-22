// Factory-preset source descriptors (docs/17). These are inert templates: a new
// user starts with zero sources and adds from here via onboarding; an existing
// user is migrated to jiqizhixin + qbitai (source-store.ts). Every URL, endpoint,
// field, and header below is from the five rounds of ingestion research recorded
// in the info-source-ingestion memory — none is invented. `enabled` is false on every
// template; whoever adds a source flips it on.

import type { SourceDescriptor } from "./descriptor";

// A plain browser UA is forced by the http wrapper; only sources needing a
// different identity set `userAgent`. None here do.

export const BUILTIN_SOURCES: SourceDescriptor[] = [
  {
    id: "jiqizhixin",
    name: "机器之心",
    line: "AI",
    builtin: true,
    enabled: false,
    discovery: {
      kind: "json-api",
      listUrl: "https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=20",
      itemsPath: "articles",
      urlTemplate: "https://www.jiqizhixin.com/articles/{id}",
      fields: {
        id: "slug",
        title: "title",
        publishedAt: ["publishedAt", "published_at", "published_time"],
        summary: ["content", "summary", "description"],
      },
    },
    fulltext: {
      mode: "detail-endpoint",
      urlTemplate: "https://www.jiqizhixin.com/api/article_library/articles/{id}.json",
      contentPath: ["content", "body", "html", "content_html"],
      titlePath: "title",
      publishedAtPath: ["publishedAt", "published_at", "published_time"],
    },
  },
  {
    id: "qbitai",
    name: "量子位",
    line: "AI",
    builtin: true,
    enabled: false,
    limit: 10,
    discovery: { kind: "feed", url: "https://www.qbitai.com/feed", format: "rss" },
    fulltext: { mode: "fetch-page" },
  },
  {
    id: "simonwillison",
    name: "Simon Willison",
    line: "AI",
    builtin: true,
    enabled: false,
    // Atom full-text; the body is in <summary>, not <content>.
    discovery: { kind: "feed", url: "https://simonwillison.net/atom/everything/", format: "atom" },
    fulltext: { mode: "feed-field", field: "summary" },
  },
  {
    id: "interconnects",
    name: "Interconnects",
    line: "AI",
    builtin: true,
    enabled: false,
    // Substack: content:encoded is the full body; paid posts arrive truncated.
    discovery: { kind: "feed", url: "https://interconnects.ai/feed", format: "rss" },
    fulltext: { mode: "feed-field", field: "content:encoded", truncationMarker: "Read more" },
  },
  {
    id: "therobotreport",
    name: "The Robot Report",
    line: "robotics",
    builtin: true,
    enabled: false,
    limit: 15,
    discovery: { kind: "feed", url: "https://www.therobotreport.com/feed/", format: "rss" },
    fulltext: { mode: "feed-field", field: "content:encoded" },
  },
  {
    id: "ieee-spectrum-robotics",
    name: "IEEE Spectrum Robotics",
    line: "robotics",
    builtin: true,
    enabled: false,
    // Full text is in the <description> CDATA; the article page is a metered
    // paywall, so never fetch it.
    noFetchPage: true,
    discovery: { kind: "feed", url: "https://spectrum.ieee.org/feeds/topic/robotics.rss", format: "rss" },
    fulltext: { mode: "feed-field", field: "description" },
  },
  {
    id: "arxiv-cs-ro",
    name: "arXiv cs.RO",
    line: "robotics",
    builtin: true,
    enabled: false,
    // Discovery-only: title + abstract; full text is PDF-only.
    discovery: { kind: "feed", url: "https://rss.arxiv.org/rss/cs.RO", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "jiemian",
    name: "界面新闻",
    line: "China tech",
    builtin: true,
    enabled: false,
    limit: 10,
    // No feed; SSR list page whose article links are /article/{id}.html.
    discovery: {
      kind: "listpage",
      url: "https://www.jiemian.com/lists/65.html",
      linkPattern: "/article/\\d+\\.html",
      base: "https://www.jiemian.com",
    },
    fulltext: { mode: "fetch-page" },
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    line: "AI",
    builtin: true,
    enabled: false,
    // Algolia front-page JSON: discovery-only (headline + external link + score);
    // the body lives at the external url. Ask-HN rows have a null url, so fall
    // back to the HN item page.
    discovery: {
      kind: "json-api",
      listUrl: "https://hn.algolia.com/api/v1/search?tags=front_page",
      itemsPath: "hits",
      urlTemplate: "https://news.ycombinator.com/item?id={id}",
      fields: { id: "objectID", title: "title", url: "url", publishedAt: "created_at" },
    },
    fulltext: { mode: "none" },
  },
  {
    id: "techcrunch-robotics",
    name: "TechCrunch Robotics",
    line: "robotics",
    builtin: true,
    enabled: false,
    limit: 10,
    discovery: { kind: "feed", url: "https://techcrunch.com/category/robotics/feed/", format: "rss" },
    fulltext: { mode: "fetch-page" },
  },
  {
    id: "bair-blog",
    name: "BAIR Blog",
    line: "robotics",
    builtin: true,
    enabled: false,
    // Berkeley AI Research; full text in the feed body (RSS description / Atom
    // content — the field selector falls back across both).
    discovery: { kind: "feed", url: "https://bair.berkeley.edu/blog/feed.xml" },
    fulltext: { mode: "feed-field", field: "description" },
  },
  {
    id: "mit-tech-review",
    name: "MIT Technology Review",
    line: "AI",
    builtin: true,
    enabled: false,
    // content:encoded carries the body; the article page is a metered paywall.
    // The feed body was verified in research; this is the canonical WordPress feed path.
    noFetchPage: true,
    discovery: { kind: "feed", url: "https://www.technologyreview.com/feed/", format: "rss" },
    fulltext: { mode: "feed-field", field: "content:encoded" },
  },
  {
    id: "xinzhiyuan",
    name: "新智元",
    line: "AI",
    builtin: true,
    enabled: false,
    // wp-json posts carry the full body inline (content.rendered) — no second
    // request per article.
    discovery: {
      kind: "json-api",
      listUrl: "https://aiera.com.cn/wp-json/wp/v2/posts?per_page=20",
      urlTemplate: "https://aiera.com.cn/?p={id}",
      fields: {
        id: "id",
        title: "title.rendered",
        url: "link",
        publishedAt: "date",
        summary: "excerpt.rendered",
        content: "content.rendered",
      },
    },
    fulltext: { mode: "feed-field" },
  },
];

const BY_ID = new Map(BUILTIN_SOURCES.map((s) => [s.id, s]));

export function builtinById(id: string): SourceDescriptor | undefined {
  return BY_ID.get(id);
}
