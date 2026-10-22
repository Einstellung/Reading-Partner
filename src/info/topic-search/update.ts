// A study's update (docs/info/91 更新): the next version of the one brief, made
// from the lines the reader confirmed. The run (run.ts, kind `update`) reads
// the extra queries and those the last version left unrun, then the builder
// (build-update.ts) judges every candidate the study's runs ever read again,
// keeps what did not change, writes only what is new or asked to be rewritten,
// and records the version (result-types.ts StudyVersion) on the study's file.
//
// What is here is the pure part: which queries an update reads, what the
// reader's lines and labels say of single items (pinned, demoted, rewritten),
// where each item sits, and how a version differs from the one it was made from.

import { arxivEventKey } from "../rank/events";
import { arxivQueries } from "./arxiv-read";
import { latestLabels, type TopicLabel } from "./labels";
import { LABEL_BOUNDARY } from "./questions";
import type { Candidate } from "./rank-pool";
import { firstPart, type StudyPlace, type StudyVersion, type TopicSearchResult, type TopicSearchResultItem } from "./result-types";
import type { SeedPaper } from "./seed-lookup";
import type { StudyLine } from "./study";
import type { TopicSearch, TopicSeed } from "./types";

/** Extra queries one update may add (initial value, docs/info/91 更新). */
export const UPDATE_QUERIES_MAX = 3;
/** Papers new to an update's brief it reads in full before writing (initial value). */
export const UPDATE_DEEP_READS = 3;
/** The longest cooldown an update waits out before making its version without the queries left (initial value). */
export const UPDATE_COOLDOWN_WAIT_MS = 60 * 60_000;
/** Times an update's read waits out a cooldown and searches again what it held back. */
export const UPDATE_READ_ROUNDS = 3;
/** Labelled items of each kind (on, borderline, off the mark) the rerank is shown as examples. */
export const LABEL_EXAMPLES = 6;

/**
 * The query ids an update searches on the paper sources: those the newest
 * version left unrun first (a cooldown), then those the update asked for, each
 * once, of the queries the topic still has with words to search.
 */
export function planUpdate(search: TopicSearch, result: TopicSearchResult | null, asked: readonly string[]): string[] {
  const versions = result?.study?.versions ?? [];
  const newest = versions.reduce<StudyVersion | null>((a, b) => (!a || b.n > a.n ? b : a), null);
  const searchable = new Set(arxivQueries(search, null));
  return [...new Set([...(newest?.skipped ?? []), ...asked])].filter((id) => searchable.has(id));
}

/** The study's first look, the file updates add to: the newest result of kind `first`. */
export function studyTarget(history: readonly TopicSearchResult[]): TopicSearchResult | null {
  return [...history].reverse().find((r) => r.kind === "first") ?? null;
}

/** The runs whose reads make a study's candidate pool: the first look's and every run merged into its file. */
export function studyRuns(result: TopicSearchResult): string[] {
  const first = result.runDir.replace(/\/+$/, "").split("/").pop() ?? "";
  return [...new Set([first, ...(result.retries ?? []).map((r) => r.runId), ...(result.judged ?? [])].filter(Boolean))];
}

const byScore = (a: { score: number }, b: { score: number }) => b.score - a.score;

/** Where an item sits: pinned, a demoted one in the Notes, else by score against the Note line. */
export function placeOf(score: number, pinned: boolean, demoted: boolean): StudyPlace {
  if (pinned) return "pinned";
  if (demoted) return "note";
  return score >= LABEL_BOUNDARY ? "main" : "note";
}

/** Whether two key lists name the same item. */
const overlaps = (a: readonly string[], b: ReadonlySet<string>) => a.some((k) => b.has(k));

/**
 * Version 1 of a study (docs/info/91 数据): its first look's own items, the
 * seeds that made it pinned first in seed order, then the entries, then the
 * Notes, each by score. Also what a file written before updates existed counts
 * as its first version.
 */
export function firstVersion(result: TopicSearchResult, runId: string, seeds: readonly TopicSeed[] = []): StudyVersion {
  const own = firstPart(result);
  const seedKeys = seeds.map((s) => s.key);
  const pinnedRank = (i: TopicSearchResultItem) => seedKeys.findIndex((k) => i.keys.includes(k) || i.key === k);
  const pinned = own.items.filter((i) => pinnedRank(i) >= 0).sort((a, b) => pinnedRank(a) - pinnedRank(b));
  const rest = own.items.filter((i) => pinnedRank(i) < 0).sort(byScore);
  const entries = [
    ...pinned.map((i) => ({ item: i.id, place: "pinned" as const, tag: null })),
    ...rest.map((i) => ({ item: i.id, place: placeOf(i.score, false, false), tag: null })),
  ].sort((a, b) => PLACE_ORDER[a.place] - PLACE_ORDER[b.place]);
  return { n: 1, at: own.createdAt, runId, base: null, entries, removed: [], changes: [], lines: [], overview: own.overview };
}

const PLACE_ORDER: Record<StudyPlace, number> = { pinned: 0, main: 1, note: 2 };

/**
 * The version a run that adds to a study's file makes (docs/info/91 数据): its
 * slow part (X, read after version 1 was out) or a retry. The base version's
 * entries stay as they are and the run's items join them by score (a seed
 * pinned), each an add with no line behind it; the overview is the merged
 * file's. Null when the run added nothing: no version is made.
 */
export function addedVersion(
  base: StudyVersion,
  newest: number,
  added: readonly TopicSearchResultItem[],
  runId: string,
  at: number,
  seeds: readonly TopicSeed[] = [],
): StudyVersion | null {
  if (added.length === 0) return null;
  const seedKeys = seeds.map((s) => s.key);
  const joined = [...added]
    .sort(byScore)
    .map((i) => ({ item: i.id, place: placeOf(i.score, seedKeys.some((k) => i.key === k || i.keys.includes(k)), false), tag: "new" as const }));
  const entries = [...base.entries.map((e) => ({ ...e, tag: null })), ...joined].sort((a, b) => PLACE_ORDER[a.place] - PLACE_ORDER[b.place]);
  return {
    n: newest + 1,
    at,
    runId,
    base: base.n,
    entries,
    removed: [],
    changes: added.map((i) => ({ kind: "add" as const, item: i.key, line: null })),
    lines: [],
    overview: base.overview,
  };
}

/** The study's versions on file; a file from before updates gets its first look as version 1. */
export function studyVersions(result: TopicSearchResult, seeds: readonly TopicSeed[] = []): StudyVersion[] {
  if (result.study?.versions.length) return result.study.versions;
  return [firstVersion(result, studyRuns(result)[0] ?? "", seeds)];
}

/**
 * A pinned paper no read found, as a candidate (docs/info/91 起草与种子): what
 * the seed lookup gave of it, found by no query. Null for a paper with no
 * arXiv id: the pool holds arXiv papers and posts only.
 */
export function pinnedCandidate(paper: SeedPaper, since: number): Candidate | null {
  const key = paper.arxivId ? arxivEventKey(paper.arxivId) : null;
  if (!key || !paper.title.trim()) return null;
  const id = key.slice("arxiv:".length);
  const at = paper.date ? Date.parse(paper.date) : NaN;
  return {
    key,
    kind: "paper",
    source: "arxiv",
    queries: [],
    foundIn: [],
    text: paper.title,
    author: paper.authors[0] ?? "",
    at: Number.isFinite(at) ? at : since,
    post: null,
    paper: { id, title: paper.title, abstract: "", authors: paper.authors, publishedAt: paper.date || null, url: `https://arxiv.org/abs/${id}` },
    links: [],
    relevance: 0,
    engagement: null,
    order: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * The rerank's pool with every held candidate in it (pinned, demoted, or in
 * the version an update starts from): one the relevance floor or the fusion's
 * cut left out joins at the end, unfused. Pure.
 */
export function withHeld(
  fused: readonly { cand: Candidate; rrf: number }[],
  candidates: readonly Candidate[],
  held: ReadonlySet<string>,
): { cand: Candidate; rrf: number }[] {
  const pooled = new Set(fused.map((f) => f.cand.key));
  const added = new Set<string>();
  const out = [...fused];
  for (const cand of candidates) {
    if (!held.has(cand.key) || pooled.has(cand.key) || added.has(cand.key)) continue;
    added.add(cand.key);
    out.push({ cand, rrf: 0 });
  }
  return out;
}

/** What the reader's labels and this update's lines say of single items, by item key, each with the line behind it. */
export interface StudyMarks {
  pinned: Map<string, string | null>;
  demoted: Map<string, string | null>;
  /** Rewrite lines, by the key of the item they are about. */
  rewrite: Map<string, StudyLine>;
}

/**
 * Pinned and demoted items, from the reader's latest word on each: its latest
 * label (`pinned` pins; a `borderline` a confirmed line wrote demotes; any
 * other unmarks) or a confirmed pin or demote line, this update's or an
 * earlier one's, whichever came last. A pin or demotion so holds across
 * versions until the reader says otherwise. Rewrite lines are this update's
 * only. Each mark carries the line behind it (null: a label with no line).
 */
export function studyMarks(labels: readonly TopicLabel[], lines: readonly StudyLine[], used: readonly StudyLine[] = []): StudyMarks {
  const marks: StudyMarks = { pinned: new Map(), demoted: new Map(), rewrite: new Map() };
  const confirmed = [...used, ...lines].filter((l) => l.state === "confirmed" && l.item !== null);
  const lineOf = (key: string, kind: StudyLine["kind"]) =>
    confirmed.filter((l) => l.item === key && l.kind === kind).sort((a, b) => b.at - a.at)[0]?.id ?? null;
  type Word = { key: string; at: number; kind: "pin" | "demote" | "clear"; line: string | null };
  const words: Word[] = [];
  for (const [key, label] of latestLabels(labels)) {
    const kind = label.label === "pinned" ? "pin" : label.label === "borderline" && label.source === "line" ? "demote" : "clear";
    words.push({ key, at: label.at, kind, line: kind === "clear" ? null : lineOf(key, kind) });
  }
  for (const l of confirmed) if (l.kind === "pin" || l.kind === "demote") words.push({ key: l.item!, at: l.at, kind: l.kind, line: l.id });
  // Stable: a line written with its label (the same moment) names itself.
  words.sort((a, b) => a.at - b.at);
  for (const w of words) {
    marks.pinned.delete(w.key);
    marks.demoted.delete(w.key);
    if (w.kind === "pin") marks.pinned.set(w.key, w.line);
    else if (w.kind === "demote") marks.demoted.set(w.key, w.line);
  }
  for (const l of lines) if (l.state === "confirmed" && l.item && l.kind === "rewrite") marks.rewrite.set(l.item, l);
  return marks;
}

/**
 * The label examples the update's rerank is shown: each item's label in force,
 * newest first, so many of each kind. A pinned item is on the mark (a seed is
 * labelled yes and pinned at the same moment, and the pin is the label in force);
 * borderline and off the mark are shown as the reader said them.
 */
export function labelExamples(labels: readonly TopicLabel[]): LabelExample[] {
  const latest = [...latestLabels(labels).values()].sort((a, b) => b.at - a.at);
  const kindOf = (l: TopicLabel): LabelExample["label"] => (l.label === "pinned" ? "yes" : l.label);
  const pick = (kind: LabelExample["label"]) =>
    latest
      .filter((l) => kindOf(l) === kind)
      .slice(0, LABEL_EXAMPLES)
      .map((l) => ({ label: kind, title: l.title, reason: l.reason }));
  return [...pick("yes"), ...pick("borderline"), ...pick("no")];
}

export interface LabelExample {
  label: "yes" | "borderline" | "no";
  title: string;
  reason: string;
}

/** One item of the next version as the selection chose it. */
export interface NextEntry {
  key: string;
  keys: readonly string[];
  place: StudyPlace;
  score: number;
  /** The line the rerank said put it in; null when none did. */
  because: string | null;
}

/** How an entry of the next version is made. */
export interface EntryPlan {
  key: string;
  place: StudyPlace;
  /** The file's item it shows as it is (a kept entry); null when it is written now. */
  keep: string | null;
  /** The file's item it is written again from (a rewrite line); null otherwise. */
  from: string | null;
  /** The rewrite line, for one written again. */
  rewrite: StudyLine | null;
  tag: StudyVersion["entries"][number]["tag"];
}

export interface VersionDiff {
  entries: EntryPlan[];
  removed: StudyVersion["removed"];
  changes: StudyVersion["changes"];
}

/**
 * The next version against its base (docs/info/91 更新): each chosen entry
 * kept as the file has it, written again from it (a rewrite line), or new; an
 * item the file had in an older version comes back with its text. What the
 * base had and the next does not is removed; pinned items never are (the
 * selection keeps them). Each change carries the line behind it: the pin,
 * demote or rewrite line, else the rerank's `because`. `outBecause`: why the
 * rerank put a removed item's candidate out, by key. Pure.
 */
export function diffVersion(
  base: StudyVersion,
  items: readonly TopicSearchResultItem[],
  next: readonly NextEntry[],
  marks: StudyMarks,
  outBecause: ReadonlyMap<string, string | null> = new Map(),
): VersionDiff {
  const byId = new Map(items.map((i) => [i.id, i]));
  const baseEntries = base.entries.map((e) => ({ entry: e, item: byId.get(e.item) })).filter((b) => b.item !== undefined);
  // The newest item of the file under one of the keys: what an item back from an older version shows.
  const newestOf = (keys: ReadonlySet<string>) => [...items].reverse().find((i) => keys.has(i.key) || overlaps(i.keys, keys)) ?? null;
  const markOf = <T>(map: ReadonlyMap<string, T>, keys: readonly string[]) => {
    for (const k of keys) if (map.has(k)) return { found: true, value: map.get(k) as T };
    return { found: false, value: undefined };
  };
  const entries: EntryPlan[] = [];
  const changes: StudyVersion["changes"] = [];
  const matched = new Set<string>();
  for (const n of next) {
    const keys = new Set([n.key, ...n.keys]);
    const inBase = baseEntries.find((b) => !matched.has(b.entry.item) && (keys.has(b.item!.key) || overlaps(b.item!.keys, keys)));
    if (inBase) matched.add(inBase.entry.item);
    const known = inBase?.item ?? newestOf(keys);
    const rewrite = markOf(marks.rewrite, [...keys]).value ?? null;
    const pinLine = markOf(marks.pinned, [...keys]);
    const demoteLine = markOf(marks.demoted, [...keys]);
    const key = known?.key ?? n.key;
    let tag: EntryPlan["tag"] = null;
    if (!inBase) {
      tag = "new";
      changes.push({ kind: "add", item: key, line: n.place === "pinned" && pinLine.found ? (pinLine.value ?? null) : n.because });
    } else {
      if (rewrite) {
        tag = "rewritten";
        changes.push({ kind: "rewrite", item: key, line: rewrite.id });
      }
      if (n.place === "note" && inBase.entry.place !== "note") {
        tag ??= "demoted";
        changes.push({ kind: "demote", item: key, line: demoteLine.found ? (demoteLine.value ?? null) : n.because });
      }
      if (n.place === "pinned" && inBase.entry.place !== "pinned") {
        tag ??= "pinned";
        changes.push({ kind: "pin", item: key, line: pinLine.found ? (pinLine.value ?? null) : null });
      }
    }
    const again = !!rewrite && !!known;
    entries.push({ key, place: n.place, keep: known && !again ? known.id : null, from: again ? known!.id : null, rewrite: again ? rewrite : null, tag });
  }
  const removed: StudyVersion["removed"] = [];
  for (const b of baseEntries) {
    if (matched.has(b.entry.item)) continue;
    const line = outBecause.get(b.item!.key) ?? null;
    removed.push({ key: b.item!.key, title: b.item!.title, line });
    changes.push({ kind: "remove", item: b.item!.key, line });
  }
  return { entries: [...entries].sort((a, b) => PLACE_ORDER[a.place] - PLACE_ORDER[b.place]), removed, changes };
}

/** "add 3 · remove 2 · demote 1 · rewrite 1": a version's changes counted, for the progress line and the run's outcome. */
export function changeCounts(changes: StudyVersion["changes"]): string {
  const order = ["add", "remove", "demote", "rewrite", "pin"] as const;
  const counts = order.map((k) => [k, changes.filter((c) => c.kind === k).length] as const).filter(([, n]) => n > 0);
  return counts.length ? counts.map(([k, n]) => `${k} ${n}`).join(" · ") : "no change";
}
