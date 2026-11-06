// The one draft not saved yet, as a file (docs/platform/687 三餐): what
// propose_meal_plan wrote, read back by the draft card, by 「就这样」 and
// apply_meal_plan, by the read tools and by a run with no card in front of it.
//
// The card is drawn from this file (buildDraftCard over a check of `draft`),
// so a new version written here, on this device or pulled from another, is
// what the card in the conversation is patched to. `previous` is the draft of
// the version before, kept so a device that only pulled the file can still mark
// which meals the revision changed.

import type { MealsDraftCardData } from "./cards";
import { buildDraftCard } from "./build-draft-card";
import type { Region } from "./nutrition/targets";
import { targetsOf } from "./plan/solve-week";
import type { MealsState } from "./plan/types";
import { checkDraft } from "./planner/checks";
import { parseDraft, type PlanDraft } from "./planner/draft";
import { planLibrary, type PlanLibrary } from "./planner/library";
import { draftContext } from "./planner/redraft";
import type { DraftResult } from "./planner/checks";
import { isObject } from "../../platform/std/json";
import type { LatticeJoin } from "../../platform/sync/merge/lattice";
import type { Json } from "../../platform/sync/merge/text";

export const MEALS_DRAFT_FILE = "info-meals-draft.json";
export const MEALS_DRAFT_KIND = "info-meals-draft";

export interface MealsDraftFile {
  /** Stable across revisions: the card is addressed by it. */
  draftId: string;
  /** The conversation the card is in. */
  threadId: string;
  /** 1 for the first draft; each revision adds one. */
  version: number;
  /** Local date of day 1. */
  startDate: string;
  /** The checked draft with the program's additions. */
  draft: PlanDraft;
  /** The model's picks it was filled from (cards.ts MealsDraftCardData.picks). */
  picks?: PlanDraft;
  /** The draft of the version before, for marking what this one changed. Absent on version 1. */
  previous?: PlanDraft;
  updatedAt: number;
  /** "applied" once 「就这样」 or apply_meal_plan wrote the plan; the next draft is a new one. */
  phase: "proposed" | "applied";
}

/** What reading a draft takes, on a card or in the file: the two share these fields. */
export type DraftOnFile = Pick<MealsDraftFile, "draftId" | "threadId" | "version" | "startDate" | "draft" | "picks" | "phase">;

/** The draft file's disk, as the tools and the apply see it. */
export interface MealsDraftPorts {
  load(): Promise<MealsDraftFile | null>;
  save(file: MealsDraftFile): Promise<void>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isDraft = (v: unknown): boolean => isObject(v) && Array.isArray(v.days);

/** The file's value, or null when it is not this shape. */
export function parseDraftFile(raw: unknown): MealsDraftFile | null {
  if (!isObject(raw)) return null;
  const { draftId, threadId, version, startDate, updatedAt, phase } = raw;
  if (typeof draftId !== "string" || typeof threadId !== "string" || typeof startDate !== "string") return null;
  if (!isNum(version) || !isNum(updatedAt) || (phase !== "proposed" && phase !== "applied") || !isDraft(raw.draft)) return null;
  return {
    draftId,
    threadId,
    version,
    startDate,
    draft: parseDraft(raw.draft),
    ...(isDraft(raw.picks) ? { picks: parseDraft(raw.picks) } : {}),
    ...(isDraft(raw.previous) ? { previous: parseDraft(raw.previous) } : {}),
    updatedAt,
    phase,
  };
}

export function draftFileBody(file: MealsDraftFile): string {
  return JSON.stringify(file, null, 2);
}

/** The draft waiting for 「就这样」 in this conversation, or null. */
export function currentDraft(file: MealsDraftFile | null, threadId: string): MealsDraftFile | null {
  return file && file.phase === "proposed" && file.threadId === threadId ? file : null;
}

/**
 * The file a new draft writes: the next version of the one waiting in this
 * conversation, or a first version under `newId`.
 */
export function nextDraftFile(
  waiting: MealsDraftFile | null,
  next: { draft: PlanDraft; picks?: PlanDraft; startDate: string; threadId: string; newId: string; now: number },
): MealsDraftFile {
  return {
    draftId: waiting?.draftId ?? next.newId,
    threadId: next.threadId,
    version: waiting ? waiting.version + 1 : 1,
    startDate: next.startDate,
    draft: next.draft,
    ...(next.picks ? { picks: next.picks } : {}),
    ...(waiting ? { previous: waiting.draft } : {}),
    updatedAt: next.now,
    phase: "proposed",
  };
}

/** The file once its draft is the saved plan. */
export function appliedDraftFile(file: MealsDraftFile, now: number): MealsDraftFile {
  return { ...file, phase: "applied", updatedAt: now };
}

/** The card for a version of the file, from a check of its draft. */
export function draftCardOf(file: MealsDraftFile, result: DraftResult, lib: PlanLibrary): MealsDraftCardData {
  const card = buildDraftCard({
    result,
    lib,
    startDate: file.startDate,
    threadId: file.threadId,
    previous: file.previous && file.version > 1 ? { draftId: file.draftId, version: file.version - 1, draft: file.previous } : null,
    newId: file.draftId,
    ...(file.picks ? { picks: file.picks } : {}),
  });
  return { ...card, version: file.version, phase: file.phase };
}

/**
 * What the card in the conversation becomes after the file changed: null when
 * it already shows this version, the applied form when only that changed, else
 * the card drawn again from the file. A card already applied is never redrawn.
 */
export function draftCardFromFile(
  file: MealsDraftFile,
  card: MealsDraftCardData,
  state: MealsState,
  region: Region,
): MealsDraftCardData | null {
  if (card.draftId !== file.draftId || card.phase === "applied") return null;
  if (card.version === file.version) return file.phase === "applied" ? { ...card, phase: "applied" } : null;
  const targets = targetsOf(state.charter, region);
  if (!state.charter || !targets) return null;
  const profile = state.charter.profile;
  const lib = planLibrary(profile);
  const result = checkDraft(file.draft, draftContext(profile, targets, file.startDate, file.draft.days.length, lib));
  return draftCardOf(file, result, lib);
}

/** The later-written copy, whole; null when both were written at the same moment or either is not a draft file. */
export const joinDraftFiles: LatticeJoin = (a: Json, b: Json) => {
  const left = parseDraftFile(a);
  const right = parseDraftFile(b);
  if (!left || !right || left.updatedAt === right.updatedAt) return null;
  return left.updatedAt > right.updatedAt ? { merged: a, loser: b } : { merged: b, loser: a };
};
