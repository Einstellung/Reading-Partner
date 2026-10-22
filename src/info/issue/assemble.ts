// Assembling an issue of the nightly brief (docs/info/88 「简报书的实现」), and
// deciding when. Each topic-search run tells this file it has closed; a night's
// issue is assembled once the run of that night of every search the night
// follows (active, and not a study: docs/info/91) has closed,
// or at the night's end (04:40) from whatever closed by then. A first look
// (kind "first") gets an issue of its own as soon as it closes, and so does what
// a retry of it, or its own slow part, added (keyed `first:<search>#<run>`). A
// split first look closes its first part early; that issue says which slow
// sources are still being read (the file's `awaiting`). A night where
// nothing is new gets no issue.
//
// Assembly: the plan (plan.ts), the document (render.ts), the EPUB, the
// library entry (kind "issue", on no reading topic), the originals attached as
// the book's supplements, the row on the info shelf and one box item. Every
// step is idempotent: the bytes are a function of the plan and the issue
// number, the number is taken from the shelf before the shelf row is written,
// and the box item id is written on the row before the item is put. A crash
// at any point is repaired by assembling the same key again.
//
// A study (docs/info/91) has one brief in versions, each a book of its own:
// version 1 is its first look's issue (`first:<search>`), each later version
// an update run's (`study:<search>:v<n>`). Every version is filed on the same
// shelf row, `first:<search>`, whose `study` lists them; the row keeps its
// number and points at the newest version's book. A study's versions carry
// every original as a supplement, with no cap.
//
// Everything outside — files, the library, the bindery, the box, the clock —
// comes in through IssueDeps; live.ts wires the real ones. This directory
// imports topic-search's types, never the other way round, and nothing of
// reading.

import type { Locale } from "../../i18n/locale";
import { translate } from "../../i18n/translate";
import { DEFAULT_COMPANION_NAME, languageInstruction } from "../../platform/app/settings";
import type { RegisteredMaterial } from "../dossier/registry";
import type { SectionedEpubInput } from "../../workshop/bindery/build-article";
import { firstPart, parseResultFile, retryPart, versionPart, type TopicSearchResult } from "../topic-search/result-types";
import { QUESTIONS_FILE, parseQuestionsFile } from "../topic-search/questions";
import { runStageFailure, stageFailureLine } from "../topic-search/stage-failure";
import { parseStudyFile, studyFileName } from "../topic-search/study";
import { openingPrompt, openingRecord, pickIssueQuestions, returnUnasked, type IssueOpeningRecord } from "./opening-record";
import { planIssue, type IssuePlan, type IssueTopic, type PlannedItem } from "./plan";
import { issueBookName, issueCoverLine, issueEpubInput, issueFileName } from "./render";
import { studyBookFile, studyBookName, studyBoxLine, studyChangeLine, studyEpubInput } from "./render-study";
import { loadStudyExcerpts } from "./study-excerpts";
import { planStudyIssue, withStudyVersions } from "./study-plan";
import { INFO_SHELF_FILE, ISSUE_BOX_KIND, nextIssueNumber, parseShelf, type InfoShelf, type IssueEntry, type IssueStudyVersion, type ShelfStall } from "./types";

/** This device's record of which runs closed on which night (local, collector only). */
export const ISSUE_STATE_FILE = "info-issue-state.json";
/** Originals attached to one issue as supplements (initial value): the cost is one fetch each. */
export const SUPPLEMENTS_MAX = 12;
/** Keys remembered as done, newest last. */
const DONE_KEPT = 120;

export interface IssueState {
  version: 1;
  /** Per night: each search whose run closed, and the result file it left (null: nothing). */
  nights: Record<string, Record<string, string | null>>;
  /** First looks that closed and are waiting for their own issue: search id to result file. */
  firsts: Record<string, string | null>;
  /** Study versions an update run made, waiting for their book: "<searchId>:v<n>" to result file. */
  studies: Record<string, string | null>;
  /** Keys assembled, or found to need no issue. */
  done: string[];
}

export function emptyIssueState(): IssueState {
  return { version: 1, nights: {}, firsts: {}, studies: {}, done: [] };
}

export function parseIssueState(text: string | null): IssueState {
  if (!text) return emptyIssueState();
  try {
    const v = JSON.parse(text) as Partial<IssueState>;
    return {
      version: 1,
      nights: v.nights && typeof v.nights === "object" ? v.nights : {},
      firsts: v.firsts && typeof v.firsts === "object" ? v.firsts : {},
      studies: v.studies && typeof v.studies === "object" ? v.studies : {},
      done: Array.isArray(v.done) ? v.done : [],
    };
  } catch {
    return emptyIssueState();
  }
}

export interface ClosedRun {
  searchId: string;
  /**
   * "retry": what was added to a first look's file afterwards, an issue of its
   * own: a retry's (topic-search/retry.ts), or the first look's slow part
   * (topic-search/pace.ts), under the first run's id.
   * "update": a study's update run (docs/info/91 更新), which made `version`.
   */
  kind: "first" | "daily" | "retry" | "update";
  /** The night's anchor date, for a daily run. */
  night: string | null;
  /** The result file, relative to AppData; null when the run left none. */
  resultFile: string | null;
  /** The run's id; a retry's issue is keyed by it. */
  runId?: string;
  /** The study version an update run made. Only with kind "update". */
  version?: number;
}

const RETRY_MARK = "#";

/** The ledger with one more run closed. Pure. */
export function noteClosed(state: IssueState, run: ClosedRun): IssueState {
  if (run.kind === "first") return { ...state, firsts: { ...state.firsts, [run.searchId]: run.resultFile } };
  if (run.kind === "update") {
    if (!run.version) return state;
    return { ...state, studies: { ...state.studies, [`${run.searchId}${VERSION_MARK}${run.version}`]: run.resultFile } };
  }
  // Keyed `first:<search>#<run>`: the first look's own key is long done.
  if (run.kind === "retry") {
    return { ...state, firsts: { ...state.firsts, [`${run.searchId}${RETRY_MARK}${run.runId ?? ""}`]: run.resultFile } };
  }
  // A run that closes after its night was assembled has nothing left to join.
  if (!run.night || state.done.includes(nightKey(run.night))) return state;
  return { ...state, nights: { ...state.nights, [run.night]: { ...state.nights[run.night], [run.searchId]: run.resultFile } } };
}

export function nightKey(night: string): string {
  return `night:${night}`;
}

export function firstKey(searchId: string): string {
  return `first:${searchId}`;
}

const VERSION_MARK = ":v";

/** The key a study version after the first is assembled under: "study:<searchId>:v<n>". */
export function studyKey(searchId: string, n: number): string {
  return `study:${searchId}${VERSION_MARK}${n}`;
}

/** The search and version a study key names; null for any other key. */
export function parseStudyKey(key: string): { searchId: string; n: number } | null {
  const m = /^study:(.+):v(\d+)$/.exec(key);
  return m ? { searchId: m[1], n: Number(m[2]) } : null;
}

/** What is ready to assemble now. Pure: `endAt` is the night's 04:40. */
export function dueIssues(
  state: IssueState,
  active: readonly string[],
  now: number,
  endAt: (night: string) => number,
): { key: string; date: string | null; files: string[] }[] {
  const out: { key: string; date: string | null; files: string[] }[] = [];
  for (const [night, closed] of Object.entries(state.nights).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const key = nightKey(night);
    if (state.done.includes(key)) continue;
    const all = active.every((id) => id in closed);
    if (!all && now < endAt(night)) continue;
    out.push({ key, date: night, files: Object.values(closed).filter((f): f is string => !!f) });
  }
  for (const [searchId, file] of Object.entries(state.firsts)) {
    const key = firstKey(searchId);
    if (!state.done.includes(key)) out.push({ key, date: null, files: file ? [file] : [] });
  }
  for (const [version, file] of Object.entries(state.studies)) {
    const key = `study:${version}`;
    if (!state.done.includes(key)) out.push({ key, date: null, files: file ? [file] : [] });
  }
  return out;
}

export function markDone(state: IssueState, key: string): IssueState {
  const done = [...state.done.filter((k) => k !== key), key].slice(-DONE_KEPT);
  const nights = { ...state.nights };
  if (key.startsWith("night:")) delete nights[key.slice("night:".length)];
  const firsts = { ...state.firsts };
  if (key.startsWith("first:")) delete firsts[key.slice("first:".length)];
  const studies = { ...state.studies };
  if (key.startsWith("study:")) delete studies[key.slice("study:".length)];
  return { ...state, nights, firsts, studies, done };
}

export interface IssueFiles {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export interface IssueDeps {
  files: IssueFiles;
  /** The topic searches, for names and subtopic names. */
  topics(): Promise<IssueTopic[]>;
  /** Ids of the searches the night follows (active, not a study): a night waits for each of their runs. */
  activeSearchIds(): Promise<string[]>;
  buildEpub(input: SectionedEpubInput): Promise<Uint8Array>;
  /** File the issue in the library as kind "issue", on no topic. Injected (reading or the shell). */
  importBook(bytes: Uint8Array, fileName: string, meta: { kind: "issue"; publishedAt: string; filename: string }): Promise<{ hash: string }>;
  /** Read an original through the bindery, file it and attach it to the issue; false when it could not be. */
  attachOriginal(bookId: string, material: RegisteredMaterial): Promise<boolean>;
  putBox(item: { id: string; boxId: string; kind: string; cover: string; body: string; origin: { place: "door"; date: string } }): Promise<void>;
  newBoxItemId(): string;
  /**
   * The everyday-tier model writing the companion's opening (opening-record.ts); null
   * or a throw leaves the program's line alone. Absent: no model is asked.
   */
  writeOpening?(prompt: { system: string; user: string }): Promise<string | null>;
  /** The companion's name the opening is said under (companionNameOf); the default when absent. */
  companionName?(): Promise<string>;
  /** The language the issue is written in (topic-search/book-language.ts); English when absent. */
  locale?(): Promise<Locale>;
  /** The night's end, epoch ms. */
  nightEndAt(night: string): number;
  now(): number;
  /** Local date, YYYY-MM-DD. */
  today(): string;
}

export type AssembleOutcome = { key: string; issue: IssueEntry | null; supplements: number };

async function loadState(deps: IssueDeps): Promise<IssueState> {
  return parseIssueState(await deps.files.read(ISSUE_STATE_FILE));
}

async function saveState(deps: IssueDeps, state: IssueState): Promise<void> {
  await deps.files.write(ISSUE_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/** The originals of an issue worth attaching: each item's first non-X material, entries first, at most `max`. */
export function supplementCandidates(plan: IssuePlan, results: readonly TopicSearchResult[], max = SUPPLEMENTS_MAX): RegisteredMaterial[] {
  const byResult = new Map(results.map((r) => [r.id, r]));
  const out: RegisteredMaterial[] = [];
  const seen = new Set<string>();
  const pick = (p: PlannedItem) => {
    const r = byResult.get(p.resultId);
    const m = p.item.materials.map((id) => r?.materials.find((x) => x.id === id)).find((x) => x && x.reader !== "x");
    if (m && !seen.has(m.canonicalUrl) && out.length < max) {
      seen.add(m.canonicalUrl);
      out.push(m);
    }
  };
  plan.entries.forEach(pick);
  plan.notes.forEach(pick);
  return out;
}

/** Assemble one issue (or find that none is due). Idempotent by key. */
export async function assembleIssue(deps: IssueDeps, key: string, date: string, files: readonly string[]): Promise<AssembleOutcome> {
  const study = await studyVersionOf(deps, key, files);
  if (study) return assembleStudy(deps, key, study, date, files);
  const shelf = parseShelf(await deps.files.read(INFO_SHELF_FILE));
  const existing = shelf.issues.find((i) => i.key === key);
  const locale = deps.locale ? await deps.locale() : "en";
  if (existing) {
    // Filed before a crash: the box item may not be there yet; putting it again is a no-op.
    await deps.putBox(boxItem(existing, locale));
    return { key, issue: existing, supplements: 0 };
  }
  // A retry's issue carries only what the retry (or the first look's slow part) added to the first look's file;
  // the first look's own issue only what it had before anything was added.
  const retryOf = key.startsWith("first:") && key.includes(RETRY_MARK) ? key.slice(key.indexOf(RETRY_MARK) + 1) : null;
  const firstOnly = key.startsWith("first:") && retryOf === null;
  const results: TopicSearchResult[] = [];
  for (const f of files) {
    const r = parseResultFile((await deps.files.read(f)) ?? "");
    const part = r && retryOf !== null && r.retries?.some((x) => x.runId === retryOf) ? retryPart(r, retryOf) : r && firstOnly ? firstPart(r) : r;
    if (part) results.push(part);
  }
  const plan = planIssue(results, await deps.topics());
  if (!plan) return { key, issue: null, supplements: 0 };
  const meta = { number: nextIssueNumber(shelf), date, locale };
  const bytes = await deps.buildEpub(issueEpubInput(plan, meta));
  const { hash } = await deps.importBook(bytes, issueFileName(meta), {
    kind: "issue",
    publishedAt: date,
    // The library takes this as the entry's title: a name, not "….epub".
    filename: issueBookName(meta),
  });
  const opening = await writeOpening(deps, plan, results, locale);
  let supplements = 0;
  for (const m of supplementCandidates(plan, results)) {
    try {
      if (await deps.attachOriginal(hash, m)) supplements++;
    } catch (e) {
      console.warn(`an original of the brief could not be attached (${m.url})`, e);
    }
  }
  const issue: IssueEntry = {
    key,
    number: meta.number,
    date,
    topics: plan.topics,
    results: plan.results,
    items: plan.entries.length + plan.notes.length,
    bookId: hash,
    boxItemId: deps.newBoxItemId(),
    createdAt: deps.now(),
    opening,
  };
  // Read again: a volume may have been written meanwhile.
  const latest = parseShelf(await deps.files.read(INFO_SHELF_FILE));
  await deps.files.write(INFO_SHELF_FILE, `${JSON.stringify({ ...latest, issues: [...latest.issues, issue] }, null, 2)}\n`);
  await deps.putBox(boxItem(issue, locale));
  return { key, issue, supplements };
}

/** The study version a key assembles: `study:<search>:v<n>`, or a study's first look (version 1); null for any other. */
async function studyVersionOf(deps: IssueDeps, key: string, files: readonly string[]): Promise<{ searchId: string; n: number } | null> {
  const later = parseStudyKey(key);
  if (later) return later;
  if (!key.startsWith("first:") || key.includes(RETRY_MARK)) return null;
  const searchId = key.slice("first:".length);
  const topic = (await deps.topics()).find((t) => t.searchId === searchId);
  if (topic) return topic.study ? { searchId, n: 1 } : null;
  // A topic no longer in the store: its file still says whether it was a study.
  const result = files[0] ? parseResultFile((await deps.files.read(files[0])) ?? "") : null;
  return result?.study ? { searchId, n: 1 } : null;
}

/** The reader's words behind each confirmed study line, from the study's record; empty when there is none. */
async function studySaid(deps: IssueDeps, searchId: string): Promise<Record<string, string>> {
  try {
    const text = await deps.files.read(studyFileName(searchId));
    const file = text ? parseStudyFile(JSON.parse(text)) : null;
    return Object.fromEntries((file?.lines ?? []).filter((l) => l.state === "confirmed").map((l) => [l.id, l.said]));
  } catch {
    return {};
  }
}

/**
 * One version of a study's brief: its book, its originals, its record on the
 * study's shelf row and its box item. Idempotent by version: a version already
 * on the row only has its box item put again.
 */
async function assembleStudy(deps: IssueDeps, key: string, target: { searchId: string; n: number }, date: string, files: readonly string[]): Promise<AssembleOutcome> {
  const rowKey = firstKey(target.searchId);
  const shelf = parseShelf(await deps.files.read(INFO_SHELF_FILE));
  const row = shelf.issues.find((i) => i.key === rowKey);
  const locale = deps.locale ? await deps.locale() : "en";
  const made = row?.study?.versions.find((v) => v.n === target.n);
  if (row && made) {
    await deps.putBox(studyBoxItem(row, made, locale));
    return { key, issue: row, supplements: 0 };
  }
  // A study's first look filed before its brief had versions: that issue stands.
  if (row && !row.study && target.n === 1) {
    await deps.putBox(boxItem(row, locale));
    return { key, issue: row, supplements: 0 };
  }
  const raw = files[0] ? parseResultFile((await deps.files.read(files[0])) ?? "") : null;
  if (!raw) return { key, issue: null, supplements: 0 };
  const topics = await deps.topics();
  const topic = topics.find((t) => t.searchId === target.searchId);
  const part = versionPart(withStudyVersions(raw, topics, topic?.study?.seeds ?? []), target.n);
  const plan = part ? planStudyIssue(part, topic, await studySaid(deps, target.searchId)) : null;
  if (!part || !plan?.study) return { key, issue: null, supplements: 0 };
  const number = row?.number ?? nextIssueNumber(shelf);
  const name = plan.topics[0].name;
  const companionName = deps.companionName ? await deps.companionName() : DEFAULT_COMPANION_NAME;
  // The cited sections' text travels in the book: the run directory does not sync (docs/info/91).
  const excerpts = await loadStudyExcerpts((path) => deps.files.read(path), raw, plan.entries.map((p) => p.item));
  const bytes = await deps.buildEpub(studyEpubInput(plan, { number, date, locale, companionName }, excerpts));
  const { hash } = await deps.importBook(bytes, studyBookFile(target.searchId, target.n), {
    kind: "issue",
    publishedAt: date,
    filename: studyBookName(name, target.n, locale),
  });
  const opening = await writeOpening(deps, plan, [part], locale);
  let supplements = 0;
  // Every item's original, not the nightly cap (docs/info/91 「一份简报」).
  for (const m of supplementCandidates(plan, [part], Number.POSITIVE_INFINITY)) {
    try {
      if (await deps.attachOriginal(hash, m)) supplements++;
    } catch (e) {
      console.warn(`an original of the study's brief could not be attached (${m.url})`, e);
    }
  }
  const items = plan.entries.length + plan.notes.length;
  const version: IssueStudyVersion = {
    n: target.n,
    bookId: hash,
    at: plan.study.version.at,
    date,
    line: studyChangeLine(plan.study.version, items, locale),
    items,
    boxItemId: deps.newBoxItemId(),
  };
  // Read again: an issue or a volume may have been written meanwhile.
  const latest = parseShelf(await deps.files.read(INFO_SHELF_FILE));
  const current = latest.issues.find((i) => i.key === rowKey);
  // A row filed before its brief had versions holds the first look's book: it is version 1.
  const before: IssueStudyVersion[] =
    current?.study?.versions ??
    (current
      ? [{ n: 1, bookId: current.bookId, at: current.createdAt, date: current.date, line: "", items: current.items, boxItemId: current.boxItemId }]
      : []);
  const versions = [...before.filter((v) => v.n !== target.n), version].sort((a, b) => a.n - b.n);
  const newest = versions[versions.length - 1].n === target.n;
  const issue: IssueEntry = current
    ? {
        ...current,
        ...(newest ? { bookId: hash, items, opening, topics: plan.topics } : {}),
        study: { current: versions[versions.length - 1].n, versions },
      }
    : {
        key: rowKey,
        number,
        date,
        topics: plan.topics,
        results: [raw.id],
        items,
        bookId: hash,
        boxItemId: version.boxItemId,
        createdAt: deps.now(),
        opening,
        study: { current: target.n, versions },
      };
  const issues = current ? latest.issues.map((i) => (i.key === rowKey ? issue : i)) : [...latest.issues, issue];
  await deps.files.write(INFO_SHELF_FILE, `${JSON.stringify({ ...latest, issues }, null, 2)}\n`);
  await deps.putBox(studyBoxItem(issue, version, locale));
  return { key, issue, supplements };
}

/** The box item that hands the reader one version of a study's brief. */
function studyBoxItem(issue: IssueEntry, v: IssueStudyVersion, locale: Locale) {
  const searchId = issue.key.slice("first:".length);
  return {
    id: v.boxItemId,
    boxId: v.n === 1 ? `issue:${issue.key}` : `issue:${studyKey(searchId, v.n)}`,
    kind: ISSUE_BOX_KIND,
    cover: studyBoxLine(issue.topics[0]?.name ?? "", v.n, v.line, locale),
    body: v.bookId,
    origin: { place: "door" as const, date: v.date },
  };
}

/**
 * The companion's opening and the issue's questions. The questions it had no room for
 * wait in their queue again. A model that fails or is absent leaves the text
 * null: the program's line and the questions are said all the same.
 */
async function writeOpening(deps: IssueDeps, plan: IssuePlan, results: readonly TopicSearchResult[], locale: Locale): Promise<IssueOpeningRecord> {
  const used = results.filter((r) => plan.results.includes(r.id));
  const names = new Map(plan.topics.map((t) => [t.searchId, t.name]));
  const { asked, left } = pickIssueQuestions(used, (id, fallback) => names.get(id) ?? fallback);
  if (left.length > 0) {
    try {
      const file = parseQuestionsFile(await deps.files.read(QUESTIONS_FILE));
      await deps.files.write(QUESTIONS_FILE, `${JSON.stringify(returnUnasked(file, left), null, 2)}\n`);
    } catch (e) {
      console.warn("the brief's unasked questions could not go back to their queue", e);
    }
  }
  let reply: string | null = null;
  // An issue that only says what waits to be judged has nothing for the model to point at.
  if (deps.writeOpening && plan.entries.length + plan.notes.length > 0) {
    try {
      // The book's language, so the opening and the book agree (docs/pitfall/647).
      const name = deps.companionName ? await deps.companionName() : DEFAULT_COMPANION_NAME;
      reply = await deps.writeOpening(openingPrompt(plan, asked, languageInstruction(locale), name));
    } catch (e) {
      console.warn("The companion's opening for the brief could not be written", e);
    }
  }
  return openingRecord(plan, asked, reply);
}

function boxItem(issue: IssueEntry, locale: Locale) {
  return {
    id: issue.boxItemId,
    boxId: `issue:${issue.key}`,
    kind: ISSUE_BOX_KIND,
    cover: issueCoverLine(issue.date, issue.items, locale),
    body: issue.bookId,
    origin: { place: "door" as const, date: issue.date },
  };
}

/** Assemble whatever is due. Each key is marked done once assembled (or found empty). */
export async function assembleDue(deps: IssueDeps): Promise<AssembleOutcome[]> {
  const state = await loadState(deps);
  const due = dueIssues(state, await deps.activeSearchIds(), deps.now(), (n) => deps.nightEndAt(n));
  const out: AssembleOutcome[] = [];
  for (const d of due) {
    out.push(await assembleIssue(deps, d.key, d.date ?? deps.today(), d.files));
    await saveState(deps, markDone(await loadState(deps), d.key));
  }
  return out;
}

/** A box item that says a topic search failed at a model call, and why; its body is empty. */
export const STALL_BOX_KIND = "topic-search-failed";

function withStalls(shelf: InfoShelf, stalls: ShelfStall[]): InfoShelf {
  const { stalls: _, ...rest } = shelf;
  return stalls.length ? { ...rest, stalls } : rest;
}

/**
 * Whether the run that closed failed at a model call (its result's `unjudged`
 * says so, topic-search/stage-failure.ts): if so the search's stall goes on
 * the shelf and a box item says why; if not, a stall the search had is gone.
 * A run that left no result file changes nothing.
 */
export async function noteStall(deps: IssueDeps, run: ClosedRun): Promise<ShelfStall | null> {
  if (!run.resultFile) return null;
  const result = parseResultFile((await deps.files.read(run.resultFile)) ?? "");
  if (!result) return null;
  const failure = runStageFailure(result.unjudged, run.runId);
  const shelf = parseShelf(await deps.files.read(INFO_SHELF_FILE));
  const before = shelf.stalls ?? [];
  const others = before.filter((x) => x.searchId !== run.searchId);
  if (!failure || !result.unjudged) {
    if (others.length !== before.length) await deps.files.write(INFO_SHELF_FILE, `${JSON.stringify(withStalls(shelf, others), null, 2)}\n`);
    return null;
  }
  const topic = (await deps.topics()).find((x) => x.searchId === run.searchId);
  const stall: ShelfStall = {
    searchId: run.searchId,
    topic: topic?.name ?? result.name,
    runId: run.runId ?? result.unjudged.runId ?? null,
    why: result.unjudged.why,
    at: result.unjudged.at,
    study: Boolean(topic ? topic.study : result.study),
  };
  await deps.files.write(INFO_SHELF_FILE, `${JSON.stringify(withStalls(shelf, [...others, stall]), null, 2)}\n`);
  const locale = deps.locale ? await deps.locale() : "en";
  await deps.putBox({
    id: deps.newBoxItemId(),
    boxId: `stall:${run.searchId}:${stall.runId ?? stall.at}`,
    kind: STALL_BOX_KIND,
    cover: translate(locale, "info.topicSearch.failBox", { topic: stall.topic, reason: stageFailureLine(failure, locale) }),
    body: "",
    origin: { place: "door", date: deps.today() },
  });
  return stall;
}

/** A run closed: note it and whether it failed, then assemble whatever that made due. */
export async function runClosed(deps: IssueDeps, run: ClosedRun): Promise<AssembleOutcome[]> {
  await saveState(deps, noteClosed(await loadState(deps), run));
  try {
    await noteStall(deps, run);
  } catch (e) {
    console.warn("whether the topic search's run failed could not be put on the shelf", e);
  }
  return assembleDue(deps);
}
