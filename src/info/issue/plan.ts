// One issue of the nightly brief, planned from the night's result files
// (docs/info/88 「简报书」): which items are entries in the body, which go to
// the Notes, and what the Annex holds. Pure.
//
// Initial rules, to be tuned after the first issues (第一期后调):
//   - every item of every result is ranked by its score, highest first;
//   - the first MAIN_MAX items scoring at least NOTE_BELOW, with a written
//     conclusion and paragraphs, are the entries; the rest are Notes. A
//     continuing item (a story already reported that only grew) is a Note;
//   - up to MAIN_POSTS of those entries are kept for post items (items that
//     list X posts, whose claims verify compared with the original), so
//     papers outscoring every post cannot push posts all into the Notes;
//   - when nothing qualifies for the body, the best-scored item with a written
//     entry is promoted, so an issue never opens on Notes alone;
//   - a topic's first look (kind "first") puts its panorama in the Annex.

import { SOURCE_NAME } from "../topic-search/pace";
import type { TopicSearchResult, TopicSearchResultItem } from "../topic-search/result-types";

/** Entries in the body of one issue (initial value). */
export const MAIN_MAX = 6;
/** Items scoring under this are Notes (initial value; scores are 0-100). */
export const NOTE_BELOW = 45;
/** Entries kept for post items scoring at least NOTE_BELOW. */
export const MAIN_POSTS = 2;

/** What the plan needs to know about a topic beyond its result file. */
export interface IssueTopic {
  searchId: string;
  name: string;
  subtopics: readonly { id: string; name: string }[];
}

export interface PlannedItem {
  searchId: string;
  topic: string;
  /** The subtopic's name, when the item has one. */
  subtopic: string | null;
  resultId: string;
  item: TopicSearchResultItem;
}

export interface PlannedAnnex {
  searchId: string;
  topic: string;
  text: string;
  /** The items the panorama cites: their E number in the result and their title. */
  cites: { id: string; title: string }[];
}

export interface IssuePlan {
  entries: PlannedItem[];
  notes: PlannedItem[];
  annex: PlannedAnnex[];
  topics: { searchId: string; name: string }[];
  results: string[];
  /** A split first look's first part (topic-search/pace.ts): the slow sources still being read, by topic. */
  awaiting: { searchId: string; topic: string; sources: string[] }[];
}

function written(item: TopicSearchResultItem): boolean {
  return !!item.summary && (item.body?.length ?? 0) > 0;
}

/**
 * An item that lists X posts: a post on its own, or posts merged into the
 * paper (repo, page) they quote. The result reserved its slot by the post's
 * own score (topic-search/select.ts); here the item's score, which is at least
 * that, decides.
 */
function postItem(item: TopicSearchResultItem): boolean {
  return item.links.posts.length > 0;
}

/** Topic and subtopic, as the contents line and the entry's kicker put them. */
export function itemLabel(p: Pick<PlannedItem, "topic" | "subtopic">): string {
  return p.subtopic ? `${p.topic} / ${p.subtopic}` : p.topic;
}

/** The plan, or null when no result has anything in it (no issue that night). */
export function planIssue(results: readonly TopicSearchResult[], topics: readonly IssueTopic[]): IssuePlan | null {
  const usable = results.filter((r) => !r.empty && r.items.length > 0);
  if (usable.length === 0) return null;
  const topicOf = new Map(topics.map((t) => [t.searchId, t]));
  const order = new Map(usable.map((r, i) => [r.id, i]));
  const all: PlannedItem[] = usable.flatMap((r) => {
    const t = topicOf.get(r.searchId);
    const subName = new Map((t?.subtopics ?? []).map((s) => [s.id, s.name]));
    return r.items.map((item) => ({
      searchId: r.searchId,
      topic: t?.name ?? r.name,
      subtopic: item.subtopic ? (subName.get(item.subtopic) ?? null) : null,
      resultId: r.id,
      item,
    }));
  });
  all.sort(
    (a, b) =>
      b.item.score - a.item.score ||
      order.get(a.resultId)! - order.get(b.resultId)! ||
      Number(a.item.id.slice(1)) - Number(b.item.id.slice(1)),
  );
  const fit = (p: PlannedItem) => p.item.score >= NOTE_BELOW && !p.item.continuing && written(p.item);
  const kept = new Set(all.filter((p) => fit(p) && postItem(p.item)).slice(0, MAIN_POSTS));
  const entries: PlannedItem[] = [];
  const notes: PlannedItem[] = [];
  let open = MAIN_MAX - kept.size;
  for (const p of all) {
    let main = kept.has(p);
    if (!main && open > 0 && fit(p)) {
      main = true;
      open--;
    }
    (main ? entries : notes).push(p);
  }
  if (entries.length === 0) {
    const best = notes.findIndex((p) => written(p.item));
    if (best >= 0) entries.push(...notes.splice(best, 1));
  }
  const annex: PlannedAnnex[] = usable
    .filter((r) => r.kind === "first" && r.overview?.text)
    .map((r) => {
      const byId = new Map(r.items.map((i) => [i.id, i.title]));
      const cited = [...new Set([...r.overview!.cites, ...(r.overview!.text.match(/\bE\d+\b/g) ?? [])])];
      return {
        searchId: r.searchId,
        topic: topicOf.get(r.searchId)?.name ?? r.name,
        text: r.overview!.text,
        cites: cited.filter((c) => byId.has(c)).map((id) => ({ id, title: byId.get(id)! })),
      };
    });
  const seen = new Set<string>();
  const topicList = usable
    .filter((r) => !seen.has(r.searchId) && seen.add(r.searchId))
    .map((r) => ({ searchId: r.searchId, name: topicOf.get(r.searchId)?.name ?? r.name }));
  const awaiting = usable
    .filter((r) => r.awaiting?.length)
    .map((r) => ({ searchId: r.searchId, topic: topicOf.get(r.searchId)?.name ?? r.name, sources: r.awaiting!.map((s) => SOURCE_NAME[s] ?? s) }));
  return { entries, notes, annex, topics: topicList, results: usable.map((r) => r.id), awaiting };
}
