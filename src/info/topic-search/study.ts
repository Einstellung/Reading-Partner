// A study's record (docs/info/91 数据): the lines the reader confirmed or
// dropped while talking the brief over, and every return to an older version.
// One file per study, `topic-study-<searchId>.json`, synced, written by any
// device. Lines are records-merged on their id; the returns sit in a map keyed
// by the moment, so two devices adding one each keep both (an array beside the
// records would be merged as one field, and one side's return lost). The
// versions themselves live in the study's result file (result-types.ts
// StudyVersion); which one is current is decided from both (`currentVersion`).
//
// Read through readGuardedFile for the reason labels.ts is.

import {
  appGuardedFileIo,
  quarantineBeforeWrite,
  readGuardedFile,
  type GuardedFileIo,
} from "../../platform/app/guarded-file";
import { isObject } from "../../platform/std/json";
import type { StudyVersion } from "./result-types";
import { entryId, splitRecords } from "./topic-searches";

export const STUDY_FILE_VERSION = 1;
const PREFIX = "topic-study-";

export type StudyLineKind = "avoid" | "judgment" | "pin" | "demote" | "rewrite";

export interface StudyLine {
  // "L" + n, what the rerank and the update's 「这次更新」 cite.
  id: string;
  kind: StudyLineKind;
  // The line on the card; the reader's edit of it when they changed it.
  text: string;
  // The reader's words it came from.
  said: string;
  // The anchor of that message.
  evidence: string;
  // The item key a pin, a demotion or a rewrite is about; null otherwise.
  item: string | null;
  state: "confirmed" | "dropped";
  at: number;
  // The version it went into; null until an update used it.
  usedIn: number | null;
}

/** A return to an older version: the brief points at version `to` from `at` on. */
export interface StudyRollback {
  to: number;
  at: number;
}

export interface StudyFile {
  version: typeof STUDY_FILE_VERSION;
  searchId: string;
  lines: StudyLine[];
  /** Oldest first. On disk a map keyed `rb-<at>`. */
  rollbacks: StudyRollback[];
}

export interface ParsedStudyFile extends StudyFile {
  foreign: unknown[];
  repaired: boolean;
}

export type StudyIo = GuardedFileIo<ParsedStudyFile>;

export const studyIo: StudyIo = appGuardedFileIo();

export function studyFileName(searchId: string): string {
  return `${PREFIX}${searchId}.json`;
}

const LINE_KINDS: readonly StudyLineKind[] = ["avoid", "judgment", "pin", "demote", "rewrite"];

export function validateStudyLine(entry: unknown): StudyLine | null {
  if (!isObject(entry)) return null;
  for (const key of ["id", "text", "said", "evidence"] as const) {
    if (typeof entry[key] !== "string") return null;
  }
  if (!LINE_KINDS.includes(entry.kind as StudyLineKind)) return null;
  if (entry.item !== null && typeof entry.item !== "string") return null;
  if (entry.state !== "confirmed" && entry.state !== "dropped") return null;
  if (typeof entry.at !== "number") return null;
  if (entry.usedIn !== null && typeof entry.usedIn !== "number") return null;
  return entry as unknown as StudyLine;
}

const rollbackKey = (r: StudyRollback) => `rb-${r.at}`;

export function parseStudyFile(raw: unknown): ParsedStudyFile | null {
  if (!isObject(raw) || typeof raw.searchId !== "string" || !Array.isArray(raw.lines)) return null;
  const back = raw.rollbacks ?? {};
  if (!isObject(back)) return null;
  const rollbacks: StudyRollback[] = [];
  for (const r of Object.values(back)) {
    if (isObject(r) && typeof r.to === "number" && typeof r.at === "number") rollbacks.push({ to: r.to, at: r.at });
  }
  rollbacks.sort((a, b) => a.at - b.at);
  const { records, foreign, repaired } = splitRecords(raw.lines, validateStudyLine);
  return { version: STUDY_FILE_VERSION, searchId: raw.searchId, lines: records, rollbacks, foreign, repaired };
}

export function studyFileBody(file: StudyFile, foreign: readonly unknown[] = []): string {
  return JSON.stringify(
    {
      version: STUDY_FILE_VERSION,
      searchId: file.searchId,
      lines: [...file.lines, ...foreign],
      rollbacks: Object.fromEntries(file.rollbacks.map((r) => [rollbackKey(r), r])),
    },
    null,
    2,
  );
}

export function emptyStudyFile(searchId: string): StudyFile {
  return { version: STUDY_FILE_VERSION, searchId, lines: [], rollbacks: [] };
}

/** The next line id: one past the highest "L<n>" there is, foreign entries counted. */
export function nextLineId(ids: readonly string[]): string {
  const most = ids.reduce((m, id) => Math.max(m, Number(/^L(\d+)$/.exec(id)?.[1] ?? 0)), 0);
  return `L${most + 1}`;
}

/**
 * The version the brief shows: the newest event among the newest version's
 * arrival and the latest return to an older one. A return to a version the
 * file does not have (yet: the result file syncs separately) is passed over.
 * Null when there is no version. Pure.
 */
export function currentVersion(versions: readonly StudyVersion[], rollbacks: readonly StudyRollback[]): number | null {
  if (versions.length === 0) return null;
  const newest = versions.reduce((a, b) => (b.at > a.at || (b.at === a.at && b.n > a.n) ? b : a));
  const known = new Set(versions.map((v) => v.n));
  const back = rollbacks.filter((r) => known.has(r.to)).reduce<StudyRollback | null>((a, b) => (!a || b.at >= a.at ? b : a), null);
  return back && back.at > newest.at ? back.to : newest.n;
}

/** A study's record; the empty one when there is no file yet. */
export async function loadStudy(searchId: string, io: StudyIo = studyIo): Promise<StudyFile> {
  const read = await readGuardedFile(io, studyFileName(searchId), parseStudyFile);
  if (!read) return emptyStudyFile(searchId);
  return { version: STUDY_FILE_VERSION, searchId: read.searchId, lines: read.lines, rollbacks: read.rollbacks };
}

// Apply a change and write the file; lines this build could not read go back
// unchanged, and a line id one of them holds is not reused. A change that
// returns null writes nothing. Returns what is on disk afterwards.
async function mutate(
  searchId: string,
  io: StudyIo,
  change: (file: StudyFile, taken: ReadonlySet<string>) => StudyFile | null,
): Promise<StudyFile> {
  const name = studyFileName(searchId);
  const read = (await readGuardedFile(io, name, parseStudyFile)) ?? { ...emptyStudyFile(searchId), foreign: [], repaired: false };
  const { foreign, repaired, ...file } = read;
  const next = change(file, new Set(foreign.map(entryId)));
  if (next === null) return file;
  if (repaired && !(await quarantineBeforeWrite(io, name))) return file;
  await io.write(name, studyFileBody(next, foreign));
  return next;
}

/**
 * Write lines: one whose id is already there is replaced (a state or usedIn
 * change), a new one is added after the rest. A line whose id is held by an
 * entry this build cannot read is not written.
 */
export async function putStudyLines(searchId: string, lines: readonly StudyLine[], io: StudyIo = studyIo): Promise<StudyFile> {
  return mutate(searchId, io, (file, taken) => {
    const put = lines.filter((l) => !taken.has(l.id));
    if (put.length === 0) return null;
    const byId = new Map(put.map((l) => [l.id, l]));
    const kept = file.lines.map((l) => byId.get(l.id) ?? l);
    const added = put.filter((l) => !file.lines.some((o) => o.id === l.id));
    return { ...file, lines: [...kept, ...added] };
  });
}

/** Record a return to version `to` at `at`. */
export async function addRollback(searchId: string, to: number, at: number, io: StudyIo = studyIo): Promise<StudyFile> {
  return mutate(searchId, io, (file) => {
    if (file.rollbacks.some((r) => r.at === at && r.to === to)) return null;
    return { ...file, rollbacks: [...file.rollbacks, { to, at }].sort((a, b) => a.at - b.at) };
  });
}
