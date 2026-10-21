// One version of a study's brief, planned as a book (docs/info/91 「一份简报」):
// the version's own order (pinned, main, notes) as the update run left it in
// the study's result file, not the nightly brief's score rules. Pure.
//
// A study's file written before its runs recorded versions (the first look of a
// study made before slice E) has none; `withStudyVersions` reads its first look
// as version 1: the reader's seeds pinned, the rest placed the nightly way.

import type { RunSource } from "../topic-search/pace";
import {
  firstPart,
  type StudyPlace,
  type StudyVersion,
  type TopicSearchResult,
  type TopicSearchResultItem,
} from "../topic-search/result-types";
import { planIssue, type IssuePlan, type IssueTopic, type PlannedAnnex, type PlannedItem } from "./plan";

export type StudyTag = StudyVersion["entries"][number]["tag"];

export interface StudyIssuePlan {
  /** The version drawn: its number, base, time, changes, removals and skipped searches. */
  version: StudyVersion;
  /** The topic's scope, what the front page says the brief answers. */
  scope: string;
  /** The sources the study reads (pace.ts topicSources). */
  sources: RunSource[];
  /** The first look's window, epoch ms. */
  window: { since: number; until: number };
  /** How many of the plan's entries, from the first, are pinned. */
  pinned: number;
  /** By item id: its place in this version and what changed in it. */
  places: Record<string, { place: StudyPlace; tag: StudyTag }>;
  /** Item keys the reader gave as seeds. */
  seeds: string[];
  /** The reader's words behind each study line ("L2"), where the study record has them. */
  said: Record<string, string>;
  /** Section headings by anchor ("M3.§2"); a whole material ("M3") by its title. */
  headings: Record<string, string | null>;
  /** By item key: the item's id in this version, for the update block's links. */
  idOfKey: Record<string, string>;
}

function isSeed(item: Pick<TopicSearchResultItem, "key" | "keys">, seeds: readonly string[]): boolean {
  return seeds.includes(item.key) || item.keys.some((k) => seeds.includes(k));
}

/**
 * The file with its versions: as written, or, for a study's file with none, its
 * first look as version 1 (seeds pinned, the rest by the nightly plan's rules).
 */
export function withStudyVersions(result: TopicSearchResult, topics: readonly IssueTopic[], seeds: readonly string[]): TopicSearchResult {
  if (result.study?.versions.length) return result;
  const own = firstPart(result);
  const pinned = own.items.filter((i) => isSeed(i, seeds));
  const rest = own.items.filter((i) => !isSeed(i, seeds));
  const plan = rest.length ? planIssue([{ ...own, items: rest, empty: false, unjudged: undefined }], topics) : null;
  const version: StudyVersion = {
    n: 1,
    at: result.createdAt,
    runId: "",
    base: null,
    entries: [
      ...pinned.map((i) => ({ item: i.id, place: "pinned" as const, tag: null })),
      ...(plan?.entries ?? []).map((p) => ({ item: p.item.id, place: "main" as const, tag: null })),
      ...(plan?.notes ?? []).map((p) => ({ item: p.item.id, place: "note" as const, tag: null })),
    ],
    removed: [],
    changes: [],
    lines: [],
    overview: own.overview,
  };
  return { ...result, study: { versions: [version] } };
}

/**
 * The plan of one version (`part` is `versionPart`'s view of it): pinned and
 * main items are the entries, in that order, then the notes; the version's
 * panorama is the Annex. Null when the version has nothing to show.
 */
export function planStudyIssue(
  part: TopicSearchResult,
  topic: IssueTopic | undefined,
  said: Readonly<Record<string, string>>,
): IssuePlan | null {
  const version = part.studyVersion;
  if (!version) return null;
  const name = topic?.name ?? part.name;
  const subName = new Map((topic?.subtopics ?? []).map((s) => [s.id, s.name]));
  const byId = new Map(part.items.map((i) => [i.id, i]));
  const planned = (item: TopicSearchResultItem): PlannedItem => ({
    searchId: part.searchId,
    topic: name,
    subtopic: item.subtopic ? (subName.get(item.subtopic) ?? null) : null,
    resultId: part.id,
    item,
  });
  const placed = version.entries.filter((e) => byId.has(e.item));
  const of = (place: StudyPlace) => placed.filter((e) => e.place === place).map((e) => planned(byId.get(e.item)!));
  const pinned = of("pinned");
  const entries = [...pinned, ...of("main")];
  const notes = of("note");
  const overview = version.overview?.text ? version.overview : null;
  if (entries.length + notes.length === 0 && !overview) return null;
  const annex: PlannedAnnex[] = overview
    ? [
        {
          searchId: part.searchId,
          topic: name,
          text: overview.text,
          cites: [...new Set([...overview.cites, ...(overview.text.match(/\bE\d+\b/g) ?? [])])]
            .filter((id) => byId.has(id))
            .map((id) => ({ id, title: byId.get(id)!.title })),
        },
      ]
    : [];
  const headings: Record<string, string | null> = {};
  for (const m of part.materials) {
    headings[m.id] = m.title;
    for (const s of m.sections) headings[s.id] = s.heading;
  }
  return {
    entries,
    notes,
    annex,
    topics: [{ searchId: part.searchId, name }],
    results: [part.id],
    awaiting: [],
    unjudged: [],
    study: {
      version,
      scope: topic?.study?.scope ?? "",
      sources: [...(topic?.study?.sources ?? [])],
      window: part.window,
      pinned: pinned.length,
      places: Object.fromEntries(placed.map((e) => [e.item, { place: e.place, tag: e.tag }])),
      seeds: [...(topic?.study?.seeds ?? [])],
      said: { ...said },
      idOfKey: Object.fromEntries(part.items.map((i) => [i.key, i.id])),
      headings,
    },
  };
}
