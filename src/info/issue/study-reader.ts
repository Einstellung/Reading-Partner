// A study's brief in the reader (docs/info/91 「版本」「更新」, slice H), minus
// React: which version the open book is and which one is current, the version
// list, the strip at the top of the book, what happens when a new version lands
// while the book is open, which item the reader is on and where it is in
// another version, and what a tapped section reference shows. Pure.
//
// What it reads: the info shelf's study row (versions and their books), the
// study's record (the returns to older versions), the study's result file
// (items, their parts and keys, the materials), the runs in flight, and — on
// the computer that ran the study only, because run directories do not sync —
// the cached section text of a material.

import { materialBodyPath, type MaterialBody } from "../dossier/registry";
import { quoteOccurs } from "../topic-search/entry-parts";
import { numbersIn } from "../topic-search/model-io";
import type { EntryPartName, TopicSearchResult } from "../topic-search/result-types";
import { runDirOf } from "../topic-search/run-state";
import { currentVersion, type StudyRollback } from "../topic-search/study";
import { anchorOfHref, citeAt, citeOfId, entrySentences, splitAnchor } from "./study-cites";
import { studyOfBook, type InfoShelf, type IssueEntry, type IssueStudyVersion } from "./types";

/** The search id of a study's shelf row (`first:<searchId>`). */
export function studySearchIdOf(issue: Pick<IssueEntry, "key">): string {
  return issue.key.startsWith("first:") ? issue.key.slice("first:".length) : issue.key;
}

export interface StudyBookContext {
  searchId: string;
  issue: IssueEntry;
  /** The version whose book is open. */
  viewing: IssueStudyVersion;
  /** Every version made, oldest first, whose book this device has. */
  versions: IssueStudyVersion[];
  /** The version the brief shows now (study.ts currentVersion). */
  current: number;
  /** The newest version made. */
  newest: number;
}

/** The study a book is a version of, read with the study's returns; null for any other book. */
export function studyBookContext(
  shelf: InfoShelf,
  bookId: string,
  rollbacks: readonly StudyRollback[],
  has: (bookId: string) => boolean = () => true,
): StudyBookContext | null {
  const found = studyOfBook(shelf, bookId);
  if (!found?.issue.study) return null;
  const all = found.issue.study.versions;
  const versions = all.filter((v) => v.bookId === bookId || has(v.bookId));
  const current = currentVersion(versions, rollbacks) ?? found.version.n;
  const newest = all.reduce((m, v) => Math.max(m, v.n), 0);
  return { searchId: studySearchIdOf(found.issue), issue: found.issue, viewing: found.version, versions, current, newest };
}

export interface VersionRow {
  n: number;
  bookId: string;
  at: number;
  /** The version's one line of what changed, as the shelf row has it. */
  line: string;
  current: boolean;
  viewing: boolean;
  /** Open it to look at: any version but the one open. */
  canOpen: boolean;
  /** Make it the brief's content again: any version but the current one. */
  canRollBack: boolean;
}

/** The version list, newest first. */
export function versionRows(ctx: Pick<StudyBookContext, "versions" | "current" | "viewing">): VersionRow[] {
  return [...ctx.versions]
    .sort((a, b) => b.n - a.n)
    .map((v) => ({
      n: v.n,
      bookId: v.bookId,
      at: v.at,
      line: v.line,
      current: v.n === ctx.current,
      viewing: v.n === ctx.viewing.n,
      canOpen: v.n !== ctx.viewing.n,
      canRollBack: v.n !== ctx.current,
    }));
}

const UPDATE_KEY = /^topic-search:(.+):update:(\d+)$/;

/**
 * The version an update in flight is making: newest + 1 while a topic-search
 * run keyed `topic-search:<searchId>:update:<n>` is pending or running. The
 * key's n counts the asks, not the versions (a failed update makes none), so
 * the number comes from the versions made. Null when no update runs.
 */
export function updatingTo(
  runs: readonly { idempotencyKey?: string; state: string }[],
  searchId: string,
  newest: number,
): number | null {
  for (const run of runs) {
    if (run.state !== "pending" && run.state !== "running") continue;
    const m = UPDATE_KEY.exec(run.idempotencyKey ?? "");
    if (m && m[1] === searchId) return newest + 1;
  }
  return null;
}

export type StudyStrip =
  /** A newer version landed while the reader was on a page; they switch when they choose. */
  | { kind: "landed"; n: number }
  /** An older version is open to look at. */
  | { kind: "old"; viewing: number; current: number }
  /** An update is running; the book stays readable. */
  | { kind: "updating"; to: number; viewing: number }
  | null;

/** What the strip at the top of the book says, if anything. */
export function studyStrip(state: { viewing: number; current: number; updating: number | null; landed: number | null }): StudyStrip {
  if (state.landed !== null && state.landed !== state.viewing) return { kind: "landed", n: state.landed };
  if (state.viewing !== state.current) return { kind: "old", viewing: state.viewing, current: state.current };
  if (state.updating !== null && state.updating > state.viewing) return { kind: "updating", to: state.updating, viewing: state.viewing };
  return null;
}

/** How long the page has to have stood still before a new version is put in front of the reader without asking. */
export const SETTLED_MS = 60_000;

/**
 * A new version landed while its study's book is open. The book was the current
 * version: it is replaced by the new one, unless the reader is on the page now
 * (they turned or scrolled within the last minute and the screen is in front),
 * in which case a chip offers the switch (the reader is not moved under their
 * eyes, as a reply does not scroll the conversation). An older version opened
 * to look at stays.
 */
export function landedAction(state: { wasCurrent: boolean; hidden: boolean; lastMovedAt: number; now: number }): "switch" | "chip" | "none" {
  if (!state.wasCurrent) return "none";
  if (state.hidden || state.now - state.lastMovedAt >= SETTLED_MS) return "switch";
  return "chip";
}

export interface VersionItem {
  id: string;
  key: string;
  title: string;
}

/** A version's items in its book order (pinned, main, notes); empty when the file has no such version. */
export function versionItems(result: Pick<TopicSearchResult, "items" | "study">, n: number): VersionItem[] {
  const version = result.study?.versions.find((v) => v.n === n);
  if (!version) return [];
  const byId = new Map(result.items.map((i) => [i.id, i]));
  return version.entries.flatMap((e) => {
    const item = byId.get(e.item);
    return item ? [{ id: item.id, key: item.key, title: item.title }] : [];
  });
}

/**
 * The same item in another version: the one with the same key (a rewritten
 * entry keeps its key under a new id). Null when that version has no such item.
 */
export function sameItemIn(result: Pick<TopicSearchResult, "items" | "study">, fromId: string, toVersion: number): VersionItem | null {
  const key = result.items.find((i) => i.id === fromId)?.key;
  if (!key) return null;
  return versionItems(result, toVersion).find((i) => i.key === key) ?? null;
}

/**
 * The item the reader is on: the last of the version's items whose page
 * (found by its title, reading/issue.ts headingPage) is at or before the page
 * open. Null before the first item (the front page, the contents) or when no
 * page was found.
 */
export function itemAtPage(items: readonly VersionItem[], pageOf: (title: string) => number | null, page: number | null): VersionItem | null {
  if (page === null) return null;
  let best: { item: VersionItem; page: number } | null = null;
  for (const item of items) {
    const p = pageOf(item.title);
    if (p === null || p > page) continue;
    if (!best || p > best.page) best = { item, page: p };
  }
  return best?.item ?? null;
}

// --- a tapped section reference ---------------------------------------------------

/** Paragraphs a sheet shows at most, and characters of each. */
const EXCERPT_PARAS = 6;
const EXCERPT_CHARS = 600;
const OPENING_CHARS = 700;

export interface CiteSheet {
  /** "M3.§2", or "M3" for a whole material. */
  anchor: string;
  /** What the page shows on the link ("§3.3"). */
  label: string;
  /** The material's title and address, from the result file. */
  title: string | null;
  url: string | null;
  /** The section's heading; null for a whole material or one with none. */
  heading: string | null;
  /** The sentence's own quotation of the original, verbatim, when it has one. */
  quote: string | null;
  /**
   * Paragraphs of the section as the program read it: the ones holding the
   * quote, else the ones holding the sentence's figures (a table's rows come
   * out of the read as paragraphs), else its opening. Empty when this device
   * does not have the section's text.
   */
  excerpt: string[];
  excerptBy: "quote" | "figures" | "opening" | null;
  /** The sentence the reference stands behind, in the book's language: what the brief says the section says. */
  gist: string | null;
  part: EntryPartName | null;
}

/** A section's text as paragraphs: split at blank lines, whitespace evened. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
}

/** The text of the anchor's section (or the whole material) in a cached body; null when it has none. */
export function sectionText(body: MaterialBody, anchor: string): string | null {
  const parts = splitAnchor(anchor);
  if (!parts) return null;
  if (parts.section === null) return body.sections.map((s) => s.text).join("\n\n") || null;
  const section = body.sections.find((s) => s.id === anchor) ?? body.sections[parts.section - 1];
  return section ? section.text : null;
}

/** The paragraphs of a section a sheet shows for a sentence. */
export function excerptFor(text: string, sentence: { text: string; quote?: string } | null): { paras: string[]; by: CiteSheet["excerptBy"] } {
  const paras = paragraphs(text);
  if (paras.length === 0) return { paras: [], by: null };
  const quote = sentence?.quote?.trim();
  if (quote) {
    const hit = paras.filter((p) => quoteOccurs(quote, p));
    if (hit.length) return { paras: hit.slice(0, EXCERPT_PARAS).map((p) => clip(p, EXCERPT_CHARS)), by: "quote" };
  }
  const figures = new Set(sentence ? numbersIn(sentence.text) : []);
  if (figures.size) {
    const hit = paras.filter((p) => numbersIn(p).some((n) => figures.has(n)));
    if (hit.length) return { paras: hit.slice(0, EXCERPT_PARAS).map((p) => clip(p, EXCERPT_CHARS)), by: "figures" };
  }
  const out: string[] = [];
  let used = 0;
  for (const p of paras) {
    if (out.length && used + p.length > OPENING_CHARS) break;
    out.push(clip(p, OPENING_CHARS));
    used += p.length;
  }
  return { paras: out, by: "opening" };
}

/**
 * Where a material's cached body may be: the first run's directory, then each
 * later run's that added to the file (an update's materials are read into its
 * own run directory). On the computer that ran the study only.
 */
export function materialBodyPaths(result: Pick<TopicSearchResult, "runDir" | "retries">, material: string): string[] {
  const dirs = [result.runDir, ...(result.retries ?? []).map((r) => runDirOf(r.runId))].filter(Boolean);
  return [...new Set(dirs)].map((dir) => materialBodyPath(dir, material));
}

export interface CiteTap {
  href: string;
  /** The link's id, "rp-cite-E7-3"; null when it has none. */
  id: string | null;
  /** The words on the link. */
  text: string;
}

/**
 * What a tapped section reference shows (docs/info/91 「条目格式」: the section a
 * sentence stands on). The sentence is found by the link's id (the item and the
 * cite's place on its page); the section's text comes from `body` when this
 * device has the material's cached body. Null when the link is not a cite.
 */
export function citeSheet(result: Pick<TopicSearchResult, "items" | "materials">, tap: CiteTap, body: MaterialBody | null): CiteSheet | null {
  const anchor = anchorOfHref(tap.href);
  const parts = anchor ? splitAnchor(anchor) : null;
  if (!anchor || !parts) return null;
  const place = tap.id ? citeOfId(tap.id) : null;
  const item = place ? result.items.find((i) => i.id === place.item) : undefined;
  let found = item?.parts && place ? citeAt(item.parts, place.n) : null;
  if (found && found.anchor !== anchor) found = null;
  if (!found && item?.parts) {
    const first = entrySentences(item.parts).find((s) => s.sentence.cites.includes(anchor));
    if (first) found = { ...first, anchor };
  }
  const material = result.materials.find((m) => m.id === parts.material);
  const heading = parts.section === null ? null : (material?.sections.find((s) => s.id === anchor)?.heading ?? null);
  const text = body ? sectionText(body, anchor) : null;
  const excerpt = text ? excerptFor(text, found?.sentence ?? null) : { paras: [], by: null };
  return {
    anchor,
    label: tap.text.trim() || anchor,
    title: material?.title ?? null,
    url: material?.url ?? null,
    heading,
    quote: found?.sentence.quote ?? null,
    excerpt: excerpt.paras,
    excerptBy: excerpt.by,
    gist: found?.sentence.text ?? null,
    part: found?.part ?? null,
  };
}
