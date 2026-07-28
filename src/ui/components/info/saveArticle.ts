// Saving a briefing article into reading (docs/21, first slice). The mapping
// from info's shapes to reading's SavedArticle lives here rather than in either
// domain: info and reading have no import between them, and ui is the layer
// allowed to touch both.
//
// Store + display only. Nothing here feeds a prompt, packs a fulltext, or
// proposes a topic — those are later slices.

import type { BriefingItemMeta, InfoItem } from "../../../info/briefing/types";
import type { SavedArticleInput } from "../../../reading/saved-articles";

// What the host has in hand at the moment the reader hits Save.
export interface SaveArticleContext {
  topicId: string;
  meta: BriefingItemMeta;
  // The article body as the view is showing it (may already have data: images
  // inlined — the store strips them) and its plain text from the day's cache.
  html: string | null;
  text: string | null;
  // The day's items snapshot, the only place summaryOnly is recorded;
  // BriefingItemMeta does not carry it.
  items: InfoItem[];
  itemId: string;
}

// Whether only a summary was ever obtained. Read off the day's item snapshot by
// item id, falling back to the paranoid answer: an unknown provenance is treated
// as evidence-incomplete, so nothing later quotes a summary as if it were the
// article (docs/21).
export function resolveSummaryOnly(items: InfoItem[], itemId: string): boolean {
  const item = items.find((i) => i.id === itemId);
  if (!item) return true;
  return item.summaryOnly ?? false;
}

export function toSavedArticleInput(ctx: SaveArticleContext): SavedArticleInput {
  return {
    topicId: ctx.topicId,
    url: ctx.meta.url,
    title: ctx.meta.title,
    source: ctx.meta.source,
    sourceName: ctx.meta.sourceName,
    publishedAt: ctx.meta.publishedAt,
    summaryOnly: resolveSummaryOnly(ctx.items, ctx.itemId),
    text: ctx.text ?? "",
    html: ctx.html ?? "",
  };
}
