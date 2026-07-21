// Data model for the daily info briefing (docs/16). An InfoItem is one fetched
// article; a Briefing is the AI's triage of a day's items into tiers. Both are
// derived and rebuildable: the briefing and the article cache stay out of sync
// range, only the profile and feedback log travel between devices.

export type InfoSource = "jiqizhixin" | "qbitai";

export interface InfoItem {
  // Stable hash of source + slug/url, so the same article keeps its id across
  // refetches and the feedback log can reference it (see itemId below).
  id: string;
  source: InfoSource;
  title: string;
  url: string;
  // ISO-ish string as the feed/API supplies it; may be "" if none was given.
  publishedAt: string;
  // Short list-view summary (jiqizhixin ships one; qbitai's is usually empty).
  summary?: string;
  // Full readable article HTML, sanitized at render time. Cached separately from
  // the briefing (per day) so the article view and chat can read it.
  contentHtml?: string;
  // Plain text of the article, fed to triage (trimmed) and to the chat context.
  textContent?: string;
}

// Each tier references an item by id; the Briefing carries a denormalized
// `items` map so the page can render titles/links without the article cache.
export interface MustRead {
  itemId: string;
  // A personal reason written to the user, referencing their profile.
  reason: string;
}

export interface OneLiner {
  itemId: string;
  // The whole point of the article in one line — reading it is the consumption.
  line: string;
}

export interface OutOfLane {
  itemId: string;
  // Why it matters even though the user would not normally follow it.
  reason: string;
}

export interface Filtered {
  itemId: string;
  // A short label for why it was dropped, e.g. "vendor PR", "conference recap".
  category: string;
}

// A denormalized view of an item, enough to render a card/link without the
// article cache. Kept inside the briefing so a briefing file is self-sufficient.
export interface BriefingItemMeta {
  title: string;
  url: string;
  source: InfoSource;
  publishedAt: string;
}

export interface Briefing {
  // Local "YYYY-MM-DD" the briefing is for; only today's is ever shown.
  date: string;
  generatedAt: number;
  // One honest line summarizing the day (allowed to say it's mostly noise).
  overview: string;
  mustRead: MustRead[];
  oneLiners: OneLiner[];
  // Zero or one anti-echo-chamber pick.
  outOfLane: OutOfLane[];
  filtered: Filtered[];
  items: Record<string, BriefingItemMeta>;
}

// The strict JSON shape triage returns (tiers only; the host attaches `items`,
// `date`, and `generatedAt`). Validated in triage.ts before it becomes a Briefing.
export interface TriageResult {
  overview: string;
  mustRead: MustRead[];
  oneLiners: OneLiner[];
  outOfLane: OutOfLane[];
  filtered: Filtered[];
}

// Feedback events (append-only info-feedback.jsonl). "opened" fires from the
// article view, "dismissed" from a card's ×, "appealed" from Filtered's
// "Show anyway".
export type FeedbackAction = "opened" | "dismissed" | "appealed";

export interface FeedbackEvent {
  ts: number;
  itemId: string;
  title: string;
  action: FeedbackAction;
  // The item's filtered/dismissal category when the event carries one.
  category?: string;
}
