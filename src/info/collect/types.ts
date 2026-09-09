// Data model for the daily info briefing (docs/16): a Briefing is the AI's triage
// of a day's items (sources/item.ts) into tiers. Derived and rebuildable — the
// briefing and the article cache stay out of sync range, only the profile and
// feedback log travel between devices.

// Each tier references an item by id; the Briefing carries a denormalized
// `items` map so the page can render titles/links without the article cache.
// What one room has to say about the day (docs/63): the cover it wrote, and the
// judgments it added while writing it. Lives here rather than in boxes/ only
// until the briefing itself moves.
export interface LabCover {
  labId: string;
  name: string;
  // One paragraph: what changed in this room today.
  cover: string;
  // Judgment ids added today, so the cover can be read against the picture.
  judgments: string[];
}

export interface MustRead {
  itemId: string;
  // A personal reason written to the user, referencing their profile.
  reason: string;
  // Which room picked it. Absent on a legacy briefing.
  labId?: string;
}

export interface OneLiner {
  itemId: string;
  // The whole point of the article in one line — reading it is the consumption.
  line: string;
  labId?: string;
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

// The two shapes in one type, for as long as both exist. Version 2 is cut by
// room: covers on top and no overview. Absent version is the triage-era
// briefing, which a device that has not run since the rebuild still has on disk
// and which the UI still has to render.
export interface Briefing {
  // Absent means the legacy shape.
  version?: 2;
  // Local "YYYY-MM-DD" the briefing is for; only today's is ever shown.
  date: string;
  generatedAt: number;
  // The rooms that changed today. [] means every room that ran was quiet, which
  // is a different day from `labs` being absent.
  labs?: LabCover[];
  // Names of the rooms that ran and had nothing to say.
  quiet?: string[];
  // Legacy: one honest line summarizing the day.
  overview?: string;
  mustRead: MustRead[];
  oneLiners: OneLiner[];
  // Zero or one anti-echo-chamber pick.
  outOfLane: OutOfLane[];
  // Legacy, and never rendered again once the pages are cut over.
  filtered?: Filtered[];
  items: Record<string, BriefingItemMeta>;
  // Legacy. Absent on briefings written before the funnel, and on any run where
  // nothing was screened.
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
