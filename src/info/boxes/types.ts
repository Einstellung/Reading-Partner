// What a day is boxed into (docs/63 呈现): the briefing, cut by research room.
// Derived and rebuildable — the briefing and the article cache stay out of sync
// range, only the labs, the pictures and the cables travel between devices.
//
// Each tier references an item by id; the Briefing carries a denormalized
// `items` map so the page can render titles/links without the article cache.

import type { LabCover, MustRead, OneLiner } from "../analysis/types";

// Declared where the analysis produces them, re-exported here because this is
// where a reader of a briefing looks for them. One declaration, two names for
// the same import: analysis may not import boxes, so the arrow only goes this
// way round.
export type { LabCover, MustRead, OneLiner };

export interface OutOfLane {
  itemId: string;
  // Why it matters even though no room covers it.
  reason: string;
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

// Bumped when the shape stops being readable as it stands. Version 1 was the
// triage-era briefing: one overview, a filtered pile and a screen tally.
// parseBriefing reads one of those and hands back this shape, so nothing past
// the parse has two shapes to render.
export const BRIEFING_VERSION = 2 as const;

export interface Briefing {
  version: typeof BRIEFING_VERSION;
  // Local "YYYY-MM-DD" the briefing is for; only today's is ever shown.
  date: string;
  generatedAt: number;
  // The rooms that changed today. [] means every room that ran was quiet, which
  // is the empty day the page says out loud.
  labs: LabCover[];
  // Names of the rooms that ran and had nothing to say.
  quiet: string[];
  mustRead: MustRead[];
  oneLiners: OneLiner[];
  // Zero or one anti-echo-chamber pick.
  outOfLane: OutOfLane[];
  items: Record<string, BriefingItemMeta>;
}
