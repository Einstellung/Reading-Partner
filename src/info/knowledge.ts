// Source knowledge base (docs/17): distilled facts for the future AI add-source
// skill — what each preset source is, which pipe it uses, and a one-line content
// positioning — so the AI can recommend and explain sources without re-running
// the five rounds of ingestion research. This is knowledge, not configuration:
// it corresponds to the builtin descriptors (builtins.ts) by id but is kept
// separate. Distilled from the info-source-ingestion memory. English (code data).

export interface SourceKnowledge {
  id: string;
  name: string;
  line: string;
  // The pipe-type conclusion: how items and full text are obtained.
  pipe: string;
  // One line placing the source: what it covers, who it is for.
  note: string;
  // Recommendation tier: "core" = a sensible first pick, "extra" = opt-in.
  tier: "core" | "extra";
  // A gotcha the add-source flow should surface (undocumented API, paywall, ...).
  caveat?: string;
}

export const SOURCE_KNOWLEDGE: SourceKnowledge[] = [
  {
    id: "jiqizhixin",
    name: "机器之心",
    line: "AI",
    pipe: "Internal JSON API: a list endpoint of slugs + summaries, a per-slug detail endpoint for the full body.",
    note: "China's leading AI-industry outlet; broad daily coverage of research, models, and companies.",
    tier: "core",
    caveat: "Undocumented API; the official RSS is now paywalled. URL/UA must stay configurable, WeChat mirror as a fallback.",
  },
  {
    id: "qbitai",
    name: "量子位",
    line: "AI",
    pipe: "WordPress RSS gives titles only; fetch each article page and extract with Readability.",
    note: "Popular Chinese AI news; fast, high-volume coverage of models and product launches.",
    tier: "core",
    caveat: "Feed carries only the last ~10 items and needs a browser UA (403 otherwise).",
  },
  {
    id: "simonwillison",
    name: "Simon Willison",
    line: "AI",
    pipe: "Atom feed is full text; the body is in <summary>, not <content>. No page fetch.",
    note: "Daily hands-on notes on LLM tooling and practice from a widely-read independent developer.",
    tier: "core",
  },
  {
    id: "interconnects",
    name: "Interconnects",
    line: "AI",
    pipe: "Substack RSS content:encoded is the full body. No page fetch.",
    note: "Nathan Lambert's deep essays on post-training, RLHF, and the open-model landscape.",
    tier: "core",
    caveat: "Paid posts arrive truncated with a 'Read more' CTA — detect the truncation marker.",
  },
  {
    id: "therobotreport",
    name: "The Robot Report",
    line: "robotics",
    pipe: "WordPress RSS content:encoded is the full body. No page fetch.",
    note: "Daily robotics-industry trade coverage; the workhorse robotics source.",
    tier: "core",
  },
  {
    id: "ieee-spectrum-robotics",
    name: "IEEE Spectrum Robotics",
    line: "robotics",
    pipe: "RSS full text in the <description> CDATA; the article page is a metered paywall, never fetch it.",
    note: "IEEE's robotics desk; substantive reporting and research explainers. The topic path generalizes (e.g. artificial-intelligence.rss).",
    tier: "core",
  },
  {
    id: "arxiv-cs-ro",
    name: "arXiv cs.RO",
    line: "robotics",
    pipe: "RSS of title + abstract; full text is PDF-only. Discovery-layer only, triage on the abstract.",
    note: "The daily robotics preprint firehose; a one-a-day batch on weekdays.",
    tier: "core",
    caveat: "The API endpoint 429s under frequent polling; the rss.arxiv.org feed is the daily path.",
  },
  {
    id: "jiemian",
    name: "界面新闻",
    line: "China tech",
    pipe: "No feed; SSR list page yields /article/{id}.html links, then fetch each page and extract.",
    note: "Mainland business/tech news with no paywall on article pages; broad Chinese tech coverage.",
    tier: "core",
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    line: "AI",
    pipe: "Algolia front-page JSON (title + external link + score). Discovery-layer only; the body is on the linked site.",
    note: "The tech community's ranked front page; use points as a relevance filter.",
    tier: "extra",
  },
  {
    id: "techcrunch-robotics",
    name: "TechCrunch Robotics",
    line: "robotics",
    pipe: "Category RSS gives summaries; fetch each article page and extract with Readability.",
    note: "Startup and funding angle on robotics; complements the trade press.",
    tier: "extra",
  },
  {
    id: "bair-blog",
    name: "BAIR Blog",
    line: "robotics",
    pipe: "Feed body carries the full post. No page fetch.",
    note: "Berkeley AI Research's own blog; first-hand academic write-ups, roughly monthly.",
    tier: "extra",
  },
  {
    id: "mit-tech-review",
    name: "MIT Technology Review",
    line: "AI",
    pipe: "RSS content:encoded carries the body; the article page is a metered paywall, never fetch it.",
    note: "Magazine-depth technology reporting; The Download briefs arrive complete in the feed.",
    tier: "extra",
    caveat: "Long features may be excerpted in the feed; do not fetch the paywalled page.",
  },
  {
    id: "xinzhiyuan",
    name: "新智元",
    line: "AI",
    pipe: "wp-json posts carry the full body inline (content.rendered); no per-article second request.",
    note: "High-volume Chinese AI news aggregator.",
    tier: "extra",
    caveat: "The /feed/ path is broken (500); use the wp-json REST endpoint.",
  },
];

const BY_ID = new Map(SOURCE_KNOWLEDGE.map((k) => [k.id, k]));

export function knowledgeById(id: string): SourceKnowledge | undefined {
  return BY_ID.get(id);
}
