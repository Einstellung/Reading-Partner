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
    pollMinutes: 1440,
    // Discovery-only: title + abstract; full text is PDF-only. Polled once a day
    // because that is arXiv's own rhythm — and because the API 429s under
    // anything faster (the RSS path is the one that survives).
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

  // --- Bloomberg -----------------------------------------------------------
  // pollMinutes 180 on every section: 20 items covering 6-22 hours means a feed
  // read once a day shows a fraction of it. Three hours is half the shortest
  // window measured, which is the margin the pool needs to see a section whole.
  // Official RSS, one feed per section: feeds.bloomberg.com/<section>/news.rss
  // now 301s to www.bloomberg.com/feeds/<section>/news.rss, so the descriptors
  // name the www path. Every section below returned items in the research round;
  // sections that 404 or come back empty (wealth, green, ai, climate, ...) are
  // not listed. The article page is a hard PerimeterX wall (docs/17 red line), so
  // every section is discovery-only: headline + the lead paragraph the feed
  // carries in <description>.
  {
    id: "bloomberg-markets",
    name: "Bloomberg Markets",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/markets/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "bloomberg-economics",
    name: "Bloomberg Economics",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/economics/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "bloomberg-business",
    name: "Bloomberg Business",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/business/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "bloomberg-industries",
    name: "Bloomberg Industries",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/industries/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "bloomberg-technology",
    name: "Bloomberg Technology",
    line: "tech",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/technology/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "bloomberg-politics",
    name: "Bloomberg Politics",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/politics/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "bloomberg-crypto",
    name: "Bloomberg Crypto",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    // Thin: 2 items in the research round, same shape as the others.
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/crypto/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "bloomberg-opinion",
    name: "Bloomberg Opinion",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 180,
    // The opinion section's feed slug is "bview"; /feeds/opinion/news.rss 404s.
    discovery: { kind: "feed", url: "https://www.bloomberg.com/feeds/bview/news.rss", format: "rss" },
    fulltext: { mode: "none" },
  },

  // --- Nature --------------------------------------------------------------
  // RDF (RSS 1.0). The one-line editor summary lives in <content:encoded> and
  // <description> is absent, which the engine's field fallback already covers, so
  // this stays honestly discovery-only. Subject feeds (/subjects/<x>.rss) parse
  // but carry empty descriptions — not usable for the funnel.
  // pollMinutes 1440 on both Nature feeds: 75 items covering a week leaves a
  // daily read nothing to miss, and these feeds 406 a burst — the cheapest way
  // to stay under a rate limit is to want the feed less often.
  {
    id: "nature",
    name: "Nature",
    line: "science",
    builtin: true,
    enabled: false,
    limit: 25,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.nature.com/nature.rss", format: "rdf" },
    fulltext: { mode: "none" },
  },
  {
    id: "nature-machine-intelligence",
    name: "Nature Machine Intelligence",
    line: "science",
    builtin: true,
    enabled: false,
    limit: 15,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.nature.com/natmachintell.rss", format: "rdf" },
    fulltext: { mode: "none" },
  },

  // --- Science (AAAS) ------------------------------------------------------
  // pollMinutes 1440: the newsroom feed carries ~10 items at about two a day,
  // and the research side comes through Crossref's polite pool. Neither wants
  // to be asked more often than the news arrives.
  {
    id: "science-news",
    name: "Science News",
    line: "science",
    builtin: true,
    enabled: false,
    limit: 10,
    pollMinutes: 1440,
    // The newsroom feed's <description> is a real dek; the journal eTOC feeds
    // (action/showFeed?type=etoc) put volume/page boilerplate there instead, so
    // research papers go through Crossref below rather than through eTOC.
    discovery: { kind: "feed", url: "https://www.science.org/rss/news_current.xml", format: "rdf" },
    fulltext: { mode: "none" },
  },
  {
    id: "science-journal",
    name: "Science (research)",
    line: "science",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    // Crossref as the discovery layer: science.org's own eTOC feed has no
    // abstracts, while Crossref carries them for AAAS (JATS XML, flattened by the
    // engine's summary pass). 0036-8075 is Science's ISSN; mailto is Crossref's
    // polite-pool identity, same address the paper lookups use.
    discovery: {
      kind: "json-api",
      listUrl:
        "https://api.crossref.org/journals/0036-8075/works?sort=published&order=desc&rows=40&select=DOI,title,abstract,URL,created,type&mailto=einstellungsu@gmail.com",
      itemsPath: "message.items",
      fields: {
        id: "DOI",
        title: "title.0",
        url: "URL",
        publishedAt: "created.date-time",
        summary: "abstract",
      },
    },
    fulltext: { mode: "none" },
  },

  // --- The Economist -------------------------------------------------------
  // Official RSS per section, ~300 items each (weeks of backlog), standfirst in
  // <description>. Three weeks of window is why pollMinutes is 1440 on all of
  // them: a daily read misses nothing, and the first one backfills weeks. Bodies are 403 behind Cloudflare and paywalled, so every
  // section is discovery-only until the logged-in webview pipe exists.
  {
    id: "economist-latest",
    name: "The Economist",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 40,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/latest/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-leaders",
    name: "The Economist Leaders",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/leaders/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-briefing",
    name: "The Economist Briefing",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/briefing/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-the-world-this-week",
    name: "The Economist: The World This Week",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    discovery: {
      kind: "feed",
      url: "https://www.economist.com/the-world-this-week/rss.xml",
      format: "rss",
    },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-finance-and-economics",
    name: "The Economist Finance & Economics",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 30,
    pollMinutes: 1440,
    discovery: {
      kind: "feed",
      url: "https://www.economist.com/finance-and-economics/rss.xml",
      format: "rss",
    },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-business",
    name: "The Economist Business",
    line: "business",
    builtin: true,
    enabled: false,
    limit: 30,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/business/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-science-and-technology",
    name: "The Economist Science & Technology",
    line: "science",
    builtin: true,
    enabled: false,
    limit: 30,
    pollMinutes: 1440,
    discovery: {
      kind: "feed",
      url: "https://www.economist.com/science-and-technology/rss.xml",
      format: "rss",
    },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-china",
    name: "The Economist China",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/china/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-united-states",
    name: "The Economist United States",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/united-states/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-asia",
    name: "The Economist Asia",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/asia/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
  {
    id: "economist-international",
    name: "The Economist International",
    line: "world",
    builtin: true,
    enabled: false,
    limit: 20,
    pollMinutes: 1440,
    discovery: { kind: "feed", url: "https://www.economist.com/international/rss.xml", format: "rss" },
    fulltext: { mode: "none" },
  },
];

const BY_ID = new Map(BUILTIN_SOURCES.map((s) => [s.id, s]));

export function builtinById(id: string): SourceDescriptor | undefined {
  return BY_ID.get(id);
}

// Per-source engineering pitfalls from the ingestion research: facts a fresh
// generic probe cannot see (undocumented behavior, a broken feed path, a paywall
// the descriptor already routes around). The verified descriptor above encodes
// the fix; this text is the caveat the probe surfaces to the AI when the user
// names a covered domain, so it can explain the source honestly. Not a
// recommendation menu — it is read only after the user points at the source.

// One site's sections share one pipe and therefore one caveat: expand it over
// every builtin id under a prefix ("bloomberg" covers bloomberg-markets, ...) so
// the facts are written once and no section can silently lose them.
function everySection(prefix: string, caveat: string): Record<string, string> {
  const ids = BUILTIN_SOURCES.filter((s) => s.id === prefix || s.id.startsWith(prefix + "-")).map((s) => s.id);
  return Object.fromEntries(ids.map((id) => [id, caveat]));
}

const BUILTIN_CAVEATS: Record<string, string> = {
  jiqizhixin:
    "Undocumented internal JSON API; the official RSS is now paywalled. The URL/UA may need to stay configurable, with the WeChat mirror as a fallback.",
  qbitai: "The feed carries only the last ~10 items and needs a browser UA (403 otherwise).",
  interconnects: "Paid Substack posts arrive truncated with a 'Read more' CTA; the descriptor flags them via the truncation marker.",
  "arxiv-cs-ro":
    "Discovery-only (title + abstract; full text is PDF-only). The API endpoint 429s under frequent polling; the rss.arxiv.org feed is the daily path.",
  "mit-tech-review":
    "The article page is a metered paywall (the descriptor never fetches it); long features may be excerpted in the feed.",
  xinzhiyuan: "The /feed/ path is broken (500); the descriptor uses the wp-json REST endpoint, which carries the full body inline.",
  ...everySection(
    "bloomberg",
    "Discovery-only. The article page answers 403 with a PerimeterX bot check, so items stay summary-only: headline plus the lead paragraph (~200 chars) the feed carries. " +
      "Each section feed holds exactly 20 items covering only 6-22 hours, so a once-a-day poll misses most of a day; polling every 2-4 hours is what it takes to see a section whole. " +
      "Recorded facts, not a verdict: Bloomberg's terms of service forbid using any \"scraper, robot, bot, spider, data mining\" tool to access the service and forbid recirculating or redistributing its material; robots.txt disallows Google-Extended but restricts neither /feeds/ nor the article paths. " +
      "Bodies would only ever come from the full-text newsletters (Money Stuff, Points of Return) over the planned mail pipe.",
  ),
  nature:
    "Discovery-only. Research papers are paywalled and most news needs a subscription; reading a body would take the logged-in webview pipe, which does not exist yet, so items are summary-only. " +
      "The one-line editor summary is real signal but sits in <content:encoded> with no <description> — the engine's field fallback handles that. Each item's summary opens with a \"Nature, Published online: <date>; doi:...\" boilerplate line. " +
      "Every nature.com HTML page (article, robots.txt, terms) answers 406 to plain HTTP with any header set, so nothing but the .rss paths is reachable and the terms text could not be read. " +
      "The feeds rate-limit: fetch them serially with a gap, since a burst gets 406 and the same URL then succeeds. Journal feeds are https://www.nature.com/<slug>.rss and each slug must be checked (ncomms, nphys, nchem, natmachintell work; nbt, natbiotechnol, nnano 406). " +
      "Subject feeds (/subjects/<x>.rss) parse but carry empty descriptions — headline-only, not worth adding. Crossref has no abstracts for Nature DOIs, so it cannot backfill summaries here.",
  "nature-machine-intelligence":
    "Same pipe and same limits as the Nature main feed: discovery-only, summary in <content:encoded>, all nature.com HTML pages 406 to plain HTTP, and the feeds rate-limit under concurrent fetches.",
  "science-news":
    "Discovery-only, and the least restricted of the four: the newsroom feed carries a real dek and Science news is free to read on the site, but the article page answers 403 with a Cloudflare challenge, so a body would take the logged-in webview pipe (not built yet). " +
      "Only ~10 items, about 2 a day, so a daily poll is enough. robots.txt explicitly allows /action/showFeed while disallowing the rest of /action, and blocks a list of training crawlers site-wide. The terms page itself is 403 and could not be read.",
  "science-journal":
    "The journal's own eTOC feed puts \"Science, Volume 393, Issue 6811, Page 569\" in <description> instead of an abstract, so this descriptor discovers through Crossref, which does carry AAAS abstracts (JATS XML; the engine flattens it). " +
      "Discovery-only: research papers are paywalled for a year and science.org pages are behind the same Cloudflare 403. Keep the mailto — it is Crossref's polite pool. " +
      "Rows include corrections and editorials alongside journal-article. Swap the ISSN for a sibling journal: 2375-2548 is Science Advances (fully open access). Crossref works for AAAS but not for Nature.",
  ...everySection(
    "economist",
    "Discovery-only. Every article is paywalled and the page answers 403 with a Cloudflare challenge, so items are summary-only (headline plus the standfirst, ~70 chars) until the logged-in webview pipe exists. " +
      "The discovery layer is generous: one section feed returns ~300 items covering about three weeks, so a once-a-day poll never misses anything and a first run can backfill weeks of history. " +
      "Recorded fact, not a verdict: the Economist's robots.txt has a section headed \"USER-FACING LLM BOTS / Allowed to fetch on behalf of a user\" that confines those agents (Claude-User, ChatGPT-User and peers) to /pro, and blocks training crawlers site-wide; feed and article paths are not disallowed for ordinary agents. The terms page is 403 and could not be read.",
  ),
};

export function builtinCaveat(id: string): string | undefined {
  return BUILTIN_CAVEATS[id];
}
