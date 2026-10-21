// A study's confirm-lines card and its end (docs/info/91 对话里改, 更新, 结束).
// propose_study_lines draws the card; the reader marks each line 对, 改一下 or
// 别记; the card's 「按这几条更新简报」 (or update_study_brief, which does the
// same) writes the confirmed lines and only then asks for the update: the
// lines into the study's record, 不要 and judgments into the topic's config,
// pins and demotions into its labels (source "line"). Dropped lines write
// nothing. end_study's card files the current version's book into reading and
// stops the study. Pure, or behind ports, so the order and the failures are
// tested without a disk.

import type { RunState } from "../../legion/run/types";
import { asArray, asString, isObject } from "../../platform/std/json";
import type { StudyLineDraft, StudyLinesCardData, StudyMoveCardData } from "./cards";
import { latestLabels, newTopicLabelId, type TopicLabel } from "./labels";
import { openingAnchor, type ReaderLine } from "./propose-tool";
import type { StudyPlace, TopicSearchResult, TopicSearchResultItem } from "./result-types";
import { currentVersion, nextLineId, type StudyFile, type StudyLine, type StudyLineKind, type StudyRollback } from "./study";
import { numberQueries, type DraftQuery } from "./topic-searches";
import type { TopicQuery, TopicSearch } from "./types";
import { studyVersions, UPDATE_QUERIES_MAX } from "./update";

export const STUDY_LINE_KINDS: readonly StudyLineKind[] = ["avoid", "judgment", "pin", "demote", "rewrite"];
/** The kinds that are about one item of the brief. */
const ITEM_KINDS: readonly StudyLineKind[] = ["pin", "demote", "rewrite"];
/** The kinds written into the topic's config. */
const CONFIG_KINDS: readonly StudyLineKind[] = ["avoid", "judgment"];

// --- the brief the lines are about ---------------------------------------------

export interface StudyBriefItem {
  // The file's item id of the text the current version shows ("E7"), else the newest text's.
  id: string;
  key: string;
  title: string;
  // Where the current version has it; null when it is not in that version.
  place: StudyPlace | null;
  // Its position in the current version's book order, from 1; null when not in it.
  rank: number | null;
  score: number | null;
}

export interface StudyBrief {
  // The version the reader sees (the newest, or the one they went back to); null before the first.
  version: number | null;
  // Every item the study's file has, one per key.
  items: StudyBriefItem[];
}

/** The study's brief as the reader sees it now, from its result file and its record's returns. Pure. */
export function studyBrief(result: TopicSearchResult | null, rollbacks: readonly StudyRollback[]): StudyBrief {
  if (!result) return { version: null, items: [] };
  const versions = result.study?.versions ?? studyVersions(result);
  const n = currentVersion(versions, rollbacks);
  const version = versions.find((v) => v.n === n) ?? null;
  const byId = new Map(result.items.map((i) => [i.id, i]));
  const placed = new Map<string, { item: TopicSearchResultItem; place: StudyPlace; rank: number }>();
  version?.entries.forEach((e, i) => {
    const item = byId.get(e.item);
    if (item && !placed.has(item.key)) placed.set(item.key, { item, place: e.place, rank: i + 1 });
  });
  const newest = new Map<string, TopicSearchResultItem>();
  for (const item of result.items) newest.set(item.key, item);
  const items = [...newest.values()].map((latest): StudyBriefItem => {
    const p = placed.get(latest.key);
    const shown = p?.item ?? latest;
    return { id: shown.id, key: latest.key, title: shown.title, place: p?.place ?? null, rank: p?.rank ?? null, score: p ? shown.score : null };
  });
  return { version: n, items };
}

const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The item a line names: its id ("E3"), its key or bare arXiv id, its title,
 * or a part of the title only one item has. Null when none or several match.
 */
export function resolveBriefItem(ref: string, brief: StudyBrief): StudyBriefItem | null {
  const r = fold(ref);
  if (!r) return null;
  const exact = brief.items.find((i) => i.id.toLowerCase() === r || i.key.toLowerCase() === r || i.key.toLowerCase() === `arxiv:${r}` || fold(i.title) === r);
  if (exact) return exact;
  const part = brief.items.filter((i) => fold(i.title).includes(r));
  return part.length === 1 ? part[0] : null;
}

/** The brief's items as the tool lists them for the model, the current version's first. */
export function briefItemLines(brief: StudyBrief): string[] {
  const placed = brief.items.filter((i) => i.place).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const rest = brief.items.filter((i) => !i.place);
  return [
    ...placed.map((i) => `- ${i.id} — ${i.title} (${i.place})`),
    ...rest.map((i) => `- ${i.id} — ${i.title} (not in version ${brief.version ?? "?"})`),
  ];
}

// --- propose_study_lines ---------------------------------------------------------

/** The tool's lines as drawn on the card, and what was wrong with the ones that cannot be. Pure. */
export function draftStudyLines(
  raw: unknown,
  brief: StudyBrief,
  readerLines: readonly ReaderLine[],
  threadId: string,
): { lines: StudyLineDraft[]; problems: string[] } {
  const lines: StudyLineDraft[] = [];
  const problems: string[] = [];
  asArray(raw).forEach((entry, i) => {
    const at = `Line ${i + 1}`;
    if (!isObject(entry)) return void problems.push(`${at} is not a line.`);
    const kind = asString(entry.kind) as StudyLineKind;
    const text = asString(entry.text).trim();
    const said = asString(entry.said).trim();
    if (!STUDY_LINE_KINDS.includes(kind)) return void problems.push(`${at}: kind must be one of ${STUDY_LINE_KINDS.join(", ")}.`);
    if (!text) return void problems.push(`${at} has no text.`);
    if (!said) return void problems.push(`${at} has no said: copy the reader's own words it came from.`);
    let item: StudyBriefItem | null = null;
    if (ITEM_KINDS.includes(kind)) {
      item = resolveBriefItem(asString(entry.item), brief);
      if (!item) return void problems.push(`${at} (${kind}) names no item of the brief: "${asString(entry.item)}".`);
      if (kind !== "pin" && !item.place) return void problems.push(`${at} (${kind}): ${item.title} is not in the version the reader has.`);
    }
    lines.push({
      kind,
      text,
      said,
      evidence: openingAnchor(readerLines, said, threadId),
      item: item?.key ?? null,
      itemTitle: item?.title ?? null,
      verdict: null,
    });
  });
  return { lines, problems };
}

// --- the reader's marks on the card ------------------------------------------------

/** The card with line `i` marked 对 or 别记; pressing the mark it has clears it. The same card when the arg is not one, or the card is past deciding. */
export function withLineVerdict(card: StudyLinesCardData, arg: string): StudyLinesCardData {
  const [index, verdict] = arg.split(":");
  const i = Number(index);
  if (card.phase !== "open" || !Number.isInteger(i) || !card.lines[i] || (verdict !== "ok" && verdict !== "drop")) return card;
  return { ...card, lines: card.lines.map((l, k) => (k === i ? { ...l, verdict: l.verdict === verdict ? null : verdict } : l)) };
}

/** The card with line `i` reworded by the reader ("<i>:<text>"): changed counts as confirmed. */
export function withLineEdit(card: StudyLinesCardData, arg: string): StudyLinesCardData {
  const cut = arg.indexOf(":");
  const i = Number(arg.slice(0, cut));
  const text = arg.slice(cut + 1).trim();
  if (card.phase !== "open" || cut < 0 || !Number.isInteger(i) || !card.lines[i] || !text) return card;
  return { ...card, lines: card.lines.map((l, k) => (k === i ? { ...l, text, verdict: "edit" } : l)) };
}

/** The indexes of the lines not decided yet. */
export function undecidedLines(card: Pick<StudyLinesCardData, "lines">): number[] {
  return card.lines.flatMap((l, i) => (l.verdict === null ? [i] : []));
}

const confirmed = (l: StudyLineDraft) => l.verdict === "ok" || l.verdict === "edit";

// --- what the send writes ---------------------------------------------------------

/**
 * The extra queries an update searches, numbered on after the topic's own and
 * at most UPDATE_QUERIES_MAX: only ones with arXiv words, the paper sources
 * being all an update reads. Pure.
 */
export function extraQueries(search: TopicSearch, drafts: readonly DraftQuery[]): TopicQuery[] {
  const words = drafts.map((q) => ({ ...q, x: q.x.trim() || q.arxiv }));
  const most = search.queries.reduce((m, q) => Math.max(m, Number(/^q(\d+)$/.exec(q.id)?.[1] ?? 0)), 0);
  return numberQueries(words, search.subtopics)
    .filter((q) => q.arxiv)
    .slice(0, UPDATE_QUERIES_MAX)
    .map((q, i) => ({ ...q, id: `q${most + i + 1}` }));
}

/** The topic's config with the card's 不要 and judgments and the extra queries; the same search when there is nothing for it. Pure. */
export function withCardLines(search: TopicSearch, card: StudyLinesCardData, queries: readonly TopicQuery[], now: number): TopicSearch {
  const kept = card.lines.filter((l) => confirmed(l) && CONFIG_KINDS.includes(l.kind));
  if (kept.length === 0 && queries.length === 0) return search;
  const add = (list: readonly string[], kind: StudyLineKind) => [
    ...list,
    ...kept.filter((l) => l.kind === kind && !list.includes(l.text)).map((l) => l.text),
  ];
  return {
    ...search,
    avoid: add(search.avoid, "avoid"),
    judgments: add(search.judgments, "judgment"),
    queries: [...search.queries, ...queries],
    answers: [...search.answers, ...kept.map((l) => ({ asked: l.text, answer: l.said, at: now }))],
    revision: search.revision + 1,
  };
}

/** The study lines the card's confirmed lines are written as, ids numbered on from the record's, and each card line's id (null: dropped). Pure. */
export function cardStudyLines(card: StudyLinesCardData, study: StudyFile, now: number): { lines: StudyLine[]; ids: (string | null)[] } {
  const taken = study.lines.map((l) => l.id);
  const lines: StudyLine[] = [];
  const ids = card.lines.map((l) => {
    if (!confirmed(l)) return null;
    const id = nextLineId([...taken, ...lines.map((x) => x.id)]);
    lines.push({ id, kind: l.kind, text: l.text, said: l.said, evidence: l.evidence ?? "", item: l.item, state: "confirmed", at: now, usedIn: null });
    return id;
  });
  return { lines, ids };
}

/** The labels a pin (`pinned`) and a demotion (`borderline`) leave, with where the item stood in the brief. Pure. */
export function lineLabels(
  lines: readonly StudyLine[],
  card: StudyLinesCardData,
  brief: StudyBrief,
  criteria: number,
  now: number,
  random?: () => number,
): TopicLabel[] {
  return lines.flatMap((l): TopicLabel[] => {
    if ((l.kind !== "pin" && l.kind !== "demote") || !l.item) return [];
    const item = brief.items.find((i) => i.key === l.item);
    return [
      {
        id: newTopicLabelId(random),
        searchId: card.searchId,
        item: l.item,
        title: item?.title ?? card.lines.find((c) => c.item === l.item)?.itemTitle ?? l.item,
        label: l.kind === "pin" ? "pinned" : "borderline",
        reason: l.said,
        source: "line",
        evidence: l.evidence,
        at: now,
        brief:
          brief.version === null
            ? null
            : { version: brief.version, place: item?.place ?? "absent", rank: item?.rank ?? null, score: item?.score ?? null },
        criteria,
      },
    ];
  });
}

// --- the send ---------------------------------------------------------------------

/** An update ask's outcome (run-worker.ts UpdateAsk, as far as the card needs it). */
export type StudyAsk = { status: "asked"; runId: string; n: number } | { status: "busy" } | { status: "refused"; reason: string };

export interface SendLinesPorts {
  searches(): Promise<TopicSearch[]>;
  change(id: string, change: (s: TopicSearch) => TopicSearch): Promise<TopicSearch | null>;
  study(searchId: string): Promise<StudyFile>;
  putLines(searchId: string, lines: readonly StudyLine[]): Promise<unknown>;
  addLabels(searchId: string, labels: readonly TopicLabel[]): Promise<unknown>;
  brief(searchId: string): Promise<StudyBrief>;
  /** runs-live.ts askStudyUpdate. */
  ask(searchId: string, ask: { lines: readonly string[]; queries: readonly string[] }): Promise<StudyAsk>;
  now(): number;
  random?(): number;
}

export type SendResult =
  | { ok: true; card: StudyLinesCardData; ask: StudyAsk }
  /** Lines on the card are not decided yet: nothing was written. */
  | { ok: false; why: "undecided"; undecided: number[] }
  /** The study is gone or ended: nothing was written. */
  | { ok: false; why: "ended" }
  /** The update was asked for this card already. */
  | { ok: false; why: "asked" };

/**
 * The card's 「按这几条更新简报」: on an open card, the config first (it is what
 * the lines' labels date by), then the study lines, then the labels, written
 * once; then the update is asked. A card whose ask was busy or refused is only
 * asked again, with the same lines.
 */
export async function sendStudyLines(card: StudyLinesCardData, drafts: readonly DraftQuery[], ports: SendLinesPorts): Promise<SendResult> {
  if (card.phase === "asked") return { ok: false, why: "asked" };
  let next = card;
  if (card.phase === "open") {
    const undecided = undecidedLines(card);
    if (undecided.length) return { ok: false, why: "undecided", undecided };
    const search = (await ports.searches()).find((s) => s.id === card.searchId);
    if (!search || search.status !== "active") return { ok: false, why: "ended" };
    const now = ports.now();
    const queries = extraQueries(search, drafts);
    let written = search;
    if (withCardLines(search, card, queries, now) !== search) {
      const changed = await ports.change(search.id, (s) => withCardLines(s, card, extraQueries(s, drafts), now));
      if (!changed) return { ok: false, why: "ended" };
      written = changed;
    }
    const queryIds = written.queries.filter((q) => !search.queries.some((o) => o.id === q.id)).map((q) => q.id);
    const { lines, ids } = cardStudyLines(card, await ports.study(card.searchId), now);
    if (lines.length) await ports.putLines(card.searchId, lines);
    const labels = lineLabels(lines, card, await ports.brief(card.searchId), written.revision, now, ports.random);
    if (labels.length) {
      try {
        await ports.addLabels(card.searchId, labels);
      } catch (e) {
        // The lines carry the pins and demotions for the update all the same (update.ts studyMarks).
        console.warn("the study lines' labels could not be written", e);
      }
    }
    next = { ...card, phase: "recorded", ids, queries: queryIds };
  }
  const ask = await ports.ask(card.searchId, {
    lines: (next.ids ?? []).filter((id): id is string => id !== null),
    queries: next.queries ?? [],
  });
  return { ok: true, card: { ...next, phase: ask.status === "asked" ? "asked" : "recorded", ask }, ask };
}

// --- the update run, as the card shows it ------------------------------------------

export type StudyRunStatus =
  | { kind: "waiting" }
  | { kind: "running" }
  | { kind: "cooling"; minutes: number }
  | { kind: "done" }
  | { kind: "failed" };

// run.ts reports this while the read waits out a paper source's cooldown.
const COOLING = /cooldown; searching again in about (\d+) minutes?/;

/** What the card says of the update run it asked; null before there is one. Pure. */
export function studyRunStatus(run: { state: RunState; progress?: string } | null): StudyRunStatus | null {
  if (!run) return null;
  if (run.state === "pending") return { kind: "waiting" };
  if (run.state === "done") return { kind: "done" };
  if (run.state === "failed" || run.state === "cancelled") return { kind: "failed" };
  const m = run.progress ? COOLING.exec(run.progress) : null;
  return m ? { kind: "cooling", minutes: Number(m[1]) } : { kind: "running" };
}

// --- the end ---------------------------------------------------------------------------

/** What the end card says is kept: the items pinned (labels in force) and the 不要 and judgments the reader confirmed. Pure. */
export function keptCounts(labels: readonly TopicLabel[], lines: readonly StudyLine[]): { pins: number; marks: number } {
  const pins = [...latestLabels(labels).values()].filter((l) => l.label === "pinned").length;
  const marks = lines.filter((l) => l.state === "confirmed" && CONFIG_KINDS.includes(l.kind)).length;
  return { pins, marks };
}

export type MoveTarget = { topicId: string } | { newName: string };

/** The move card's arg: `{"topicId": …}` or `{"newName": …}`; null otherwise. */
export function parseMoveTarget(arg: string | undefined): MoveTarget | null {
  try {
    const raw: unknown = JSON.parse(arg ?? "");
    if (!isObject(raw)) return null;
    if (typeof raw.topicId === "string" && raw.topicId) return { topicId: raw.topicId };
    if (typeof raw.newName === "string" && raw.newName.trim()) return { newName: raw.newName.trim() };
  } catch {
    // not one
  }
  return null;
}

/** The topic the end card suggests: the one the model named (id or name), when it is a reading topic. */
export function suggestedTopic(raw: string, topics: readonly { id: string; name: string }[]): string | null {
  const r = fold(raw);
  if (!r) return null;
  return topics.find((tp) => tp.id === raw.trim() || fold(tp.name) === r)?.id ?? null;
}

export interface EndPorts {
  makeTopic(name: string): Promise<{ id: string; name: string }>;
  /**
   * The book filed into the reading topic the way the info shelf's Move to…
   * files a volume; returns the name of the topic it is in (another one when
   * it was already filed there).
   */
  fileBook(card: StudyMoveCardData, topic: { id: string; name: string }): Promise<string>;
  /** apply.ts stopFollowing: stopped, concern lapsed. */
  stop(searchId: string): Promise<TopicSearch | null>;
  /** The books of the study's other versions. */
  oldBooks(searchId: string, keep: string): Promise<string[]>;
  /** The book-delete cascade (reading/delete/delete-book.ts). */
  deleteBook(bookId: string): Promise<void>;
  kept(searchId: string): Promise<{ pins: number; marks: number }>;
}

/**
 * The move card's confirm: the current version's book into the reading topic
 * (made first when it is a new one), then the study stopped, then the other
 * versions' books deleted; labels, seeds, record and config are kept. Null
 * when the book could not be filed: nothing was stopped.
 */
export async function endStudy(card: StudyMoveCardData, target: MoveTarget, ports: EndPorts): Promise<StudyMoveCardData | null> {
  if (card.phase === "moved") return card;
  let filedIn: string;
  try {
    const topic = "newName" in target ? await ports.makeTopic(target.newName) : (card.topics.find((tp) => tp.id === target.topicId) ?? null);
    if (!topic) return null;
    filedIn = await ports.fileBook(card, topic);
  } catch (e) {
    console.warn("the study's brief could not be moved into reading", e);
    return null;
  }
  try {
    await ports.stop(card.searchId);
  } catch (e) {
    console.warn("the study could not be stopped", e);
  }
  for (const bookId of await ports.oldBooks(card.searchId, card.bookId).catch(() => [])) {
    try {
      await ports.deleteBook(bookId);
    } catch (e) {
      console.warn("an older version of the study's brief could not be deleted", e);
    }
  }
  const kept = await ports.kept(card.searchId).catch(() => ({ pins: 0, marks: 0 }));
  return { ...card, phase: "moved", failed: false, moved: { topic: filedIn, ...kept } };
}
