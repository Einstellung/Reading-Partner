// Data model for the daily info briefing (docs/16): a Briefing is the AI's triage
// of a day's items (sources/item.ts) into tiers. Derived and rebuildable — the
// briefing and the article cache stay out of sync range, only the profile and
// feedback log travel between devices.

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
  source: string;
  // Display name for the source tag, denormalized so the briefing file renders
  // without loading the source descriptors.
  sourceName: string;
  publishedAt: string;
}

// What the screening stage did to the day (docs/35): how many items the sources
// published, how many were judged worth fetching, and the ids of the ones that
// were not. Counts and ids only — deliberately not titles or reasons. This is
// the coarse half of a two-level filtered record: the fine half is the tiered
// `filtered` list below, which triage wrote after reading the full text.
export interface ScreenSummary {
  discovered: number;
  kept: number;
  dropped: number;
  // Keeps cut by the daily fetch ceiling rather than by the screen's judgement.
  cappedOut: number;
  droppedIds: string[];
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
  // Absent on briefings written before the funnel, and on any run where nothing
  // was screened.
  screen?: ScreenSummary;
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
