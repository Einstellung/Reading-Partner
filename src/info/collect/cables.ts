// Turning a finished run into the day's cables (docs/63 电报). Every item the
// screen kept becomes one cable, tagged with the rooms it hit — that is the
// whole translation between the funnel and the evidence layer.
//
// The cable is not the article. The body stays in the day's article cache and is
// pruned with it; the cable record outlives it, so a judgment made in March
// still says what it was made on.
//
// Pure: the file is cable/store.ts, the run is the pipeline's.

import { CABLES_VERSION, type Cable, type CableDay } from "../cable/types";
import type { InfoItem } from "../sources/item";
import { keepVerdict, type ScreenVerdict } from "./screen";

// The cable's own summary, per cable/types.ts. Long enough to say what happened,
// short enough that a room's whole day fits in one analyst prompt.
export const CABLE_SUMMARY_CHARS = 400;

export interface CablesFromRunInput {
  date: string;
  items: readonly InfoItem[];
  verdicts: Record<string, ScreenVerdict>;
  // The item ids the selection kept, in discovery order.
  selected: readonly string[];
}

/**
 * One cable per selected item, in discovery order.
 *
 * A selected item with no verdict, or one whose verdict kept nothing, is not a
 * cable: the selection is derived from the verdicts, so this only happens to a
 * checkpoint somebody edited, and inventing an untagged cable would file
 * evidence under no room at all.
 *
 * Only the first `outside` survives, the same rule selectKept applies — both
 * walk the day in discovery order, so both land on the same item.
 */
export function cablesFromRun(input: CablesFromRunInput): CableDay {
  const byId = new Map(input.items.map((it) => [it.id, it]));
  const cables: Cable[] = [];
  let outsideTaken = false;
  for (const id of input.selected) {
    const item = byId.get(id);
    const verdict = input.verdicts[id];
    if (!item || !verdict || !keepVerdict(verdict)) continue;
    const outside = verdict.outside && !outsideTaken ? verdict.outside : undefined;
    if (verdict.outside) outsideTaken = true;
    const summary = cableSummary(item);
    cables.push({
      id: item.id,
      date: input.date,
      title: item.title,
      url: item.url,
      source: item.source,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      hits: verdict.hits.map((h) => ({ labId: h.labId, observables: [...h.observables] })),
      ...(summary ? { summary } : {}),
      ...(outside ? { outside } : {}),
    });
  }
  return { version: CABLES_VERSION, date: input.date, cables };
}

// The feed's own blurb when it shipped one, otherwise the head of the body. Both
// are cut to the same length: what goes in the cable is a handle on the item, not
// a substitute for reading it.
function cableSummary(item: InfoItem): string | undefined {
  const text = (item.summary || item.textContent || "").trim();
  return text ? text.slice(0, CABLE_SUMMARY_CHARS).trim() : undefined;
}

/**
 * The article text an analyst run reads for one cable, cut to the caller's cap.
 * Undefined when the body never came — the analyst then has the cable's summary
 * and nothing more, which is what a summary-only item is.
 */
export function cableText(item: InfoItem, maxChars: number): string | undefined {
  const text = (item.textContent || "").trim();
  if (!text) return undefined;
  return maxChars > 0 ? text.slice(0, maxChars) : undefined;
}
