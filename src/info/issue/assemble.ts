// Assembling an issue of the nightly brief (docs/info/88 「简报书的实现」), and
// deciding when. Each topic-search run tells this file it has closed; a night's
// issue is assembled once every active search's run of that night has closed,
// or at the night's end (04:40) from whatever closed by then. A first look
// (kind "first") gets an issue of its own as soon as it closes. A night where
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
// Everything outside — files, the library, the bindery, the box, the clock —
// comes in through IssueDeps; live.ts wires the real ones. This directory
// imports topic-search's types, never the other way round, and nothing of
// reading.

import type { RegisteredMaterial } from "../dossier/registry";
import type { SectionedEpubInput } from "../../workshop/bindery/build-article";
import { parseResultFile, type TopicSearchResult } from "../topic-search/result-types";
import { QUESTIONS_FILE, parseQuestionsFile } from "../topic-search/questions";
import { openingPrompt, openingRecord, pickIssueQuestions, returnUnasked, type IssueOpeningRecord } from "./opening-record";
import { planIssue, type IssuePlan, type IssueTopic, type PlannedItem } from "./plan";
import { issueBookName, issueCoverLine, issueEpubInput, issueFileName } from "./render";
import { INFO_SHELF_FILE, ISSUE_BOX_KIND, nextIssueNumber, parseShelf, type IssueEntry } from "./types";

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
  /** Keys assembled, or found to need no issue. */
  done: string[];
}

export function emptyIssueState(): IssueState {
  return { version: 1, nights: {}, firsts: {}, done: [] };
}

export function parseIssueState(text: string | null): IssueState {
  if (!text) return emptyIssueState();
  try {
    const v = JSON.parse(text) as Partial<IssueState>;
    return {
      version: 1,
      nights: v.nights && typeof v.nights === "object" ? v.nights : {},
      firsts: v.firsts && typeof v.firsts === "object" ? v.firsts : {},
      done: Array.isArray(v.done) ? v.done : [],
    };
  } catch {
    return emptyIssueState();
  }
}

export interface ClosedRun {
  searchId: string;
  kind: "first" | "daily";
  /** The night's anchor date, for a daily run. */
  night: string | null;
  /** The result file, relative to AppData; null when the run left none. */
  resultFile: string | null;
}

/** The ledger with one more run closed. Pure. */
export function noteClosed(state: IssueState, run: ClosedRun): IssueState {
  if (run.kind === "first") return { ...state, firsts: { ...state.firsts, [run.searchId]: run.resultFile } };
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
  return out;
}

function markDone(state: IssueState, key: string): IssueState {
  const done = [...state.done.filter((k) => k !== key), key].slice(-DONE_KEPT);
  const nights = { ...state.nights };
  if (key.startsWith("night:")) delete nights[key.slice("night:".length)];
  const firsts = { ...state.firsts };
  if (key.startsWith("first:")) delete firsts[key.slice("first:".length)];
  return { ...state, nights, firsts, done };
}

export interface IssueFiles {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export interface IssueDeps {
  files: IssueFiles;
  /** The topic searches, for names and subtopic names. */
  topics(): Promise<IssueTopic[]>;
  /** Ids of the searches still followed: a night waits for each of their runs. */
  activeSearchIds(): Promise<string[]>;
  buildEpub(input: SectionedEpubInput): Promise<Uint8Array>;
  /** File the issue in the library as kind "issue", on no topic. Injected (reading or the shell). */
  importBook(bytes: Uint8Array, fileName: string, meta: { kind: "issue"; publishedAt: string; filename: string }): Promise<{ hash: string }>;
  /** Read an original through the bindery, file it and attach it to the issue; false when it could not be. */
  attachOriginal(bookId: string, material: RegisteredMaterial): Promise<boolean>;
  putBox(item: { id: string; boxId: string; kind: string; cover: string; body: string; origin: { place: "door"; date: string } }): Promise<void>;
  newBoxItemId(): string;
  /**
   * The everyday-tier model writing Lumen's opening (opening-record.ts); null
   * or a throw leaves the program's line alone. Absent: no model is asked.
   */
  writeOpening?(prompt: { system: string; user: string }): Promise<string | null>;
  /** The reader's language instruction for the model. */
  language?(): Promise<string>;
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

/** The originals of an issue worth attaching: each item's first non-X material, entries first. */
export function supplementCandidates(plan: IssuePlan, results: readonly TopicSearchResult[]): RegisteredMaterial[] {
  const byResult = new Map(results.map((r) => [r.id, r]));
  const out: RegisteredMaterial[] = [];
  const seen = new Set<string>();
  const pick = (p: PlannedItem) => {
    const r = byResult.get(p.resultId);
    const m = p.item.materials.map((id) => r?.materials.find((x) => x.id === id)).find((x) => x && x.reader !== "x");
    if (m && !seen.has(m.canonicalUrl) && out.length < SUPPLEMENTS_MAX) {
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
  const shelf = parseShelf(await deps.files.read(INFO_SHELF_FILE));
  const existing = shelf.issues.find((i) => i.key === key);
  if (existing) {
    // Filed before a crash: the box item may not be there yet; putting it again is a no-op.
    await deps.putBox(boxItem(existing));
    return { key, issue: existing, supplements: 0 };
  }
  const results: TopicSearchResult[] = [];
  for (const f of files) {
    const r = parseResultFile((await deps.files.read(f)) ?? "");
    if (r) results.push(r);
  }
  const plan = planIssue(results, await deps.topics());
  if (!plan) return { key, issue: null, supplements: 0 };
  const meta = { number: nextIssueNumber(shelf), date };
  const bytes = await deps.buildEpub(issueEpubInput(plan, meta));
  const { hash } = await deps.importBook(bytes, issueFileName(meta), {
    kind: "issue",
    publishedAt: date,
    // The library takes this as the entry's title: a name, not "….epub".
    filename: issueBookName(meta),
  });
  const opening = await writeOpening(deps, plan, results);
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
  await deps.putBox(boxItem(issue));
  return { key, issue, supplements };
}

/**
 * Lumen's opening and the issue's questions. The questions it had no room for
 * wait in their queue again. A model that fails or is absent leaves the text
 * null: the program's line and the questions are said all the same.
 */
async function writeOpening(deps: IssueDeps, plan: IssuePlan, results: readonly TopicSearchResult[]): Promise<IssueOpeningRecord> {
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
  if (deps.writeOpening) {
    try {
      const language = deps.language ? await deps.language() : "";
      reply = await deps.writeOpening(openingPrompt(plan, asked, language));
    } catch (e) {
      console.warn("Lumen's opening for the brief could not be written", e);
    }
  }
  return openingRecord(plan, asked, reply);
}

function boxItem(issue: IssueEntry) {
  return {
    id: issue.boxItemId,
    boxId: `issue:${issue.key}`,
    kind: ISSUE_BOX_KIND,
    cover: issueCoverLine(issue.date, issue.items),
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

/** A run closed: note it, then assemble whatever that made due. */
export async function runClosed(deps: IssueDeps, run: ClosedRun): Promise<AssembleOutcome[]> {
  await saveState(deps, noteClosed(await loadState(deps), run));
  return assembleDue(deps);
}
