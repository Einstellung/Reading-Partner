// Settling one parked prose copy with a model (docs/59 §6).
//
// The model reads the base sync last agreed on (when there is one), the version
// that was kept, the version that was parked, and what the file is for, and
// answers with one text — or says it cannot. Its text is written the way the
// file is always written: an observation through its store, which also folds
// the frontmatter and stamps `resolvedBy`; any other file whole. Then the copy
// is removed. Both are ordinary local writes and sync carries them like any
// edit. Nothing here touches sync-base/, sync-state.json or the holdings.
//
// A model that is not sure writes nothing: the run fails with its reason and
// the copy stays on disk for a person. That is a GiveUpError, so the runner
// does not spend two more calls asking again.

import { GiveUpError } from "../../legion/stop";
import { encode, textDigest } from "../../platform/sync/merge/text";
import { parseObservation } from "../observations/files";
import { resolvedByOf } from "../observations/store";
import type { Observation } from "../observations/types";
import { isObservationType } from "../observations/types";
import type { ProseConflict } from "./conflicts";

/** Where sync keeps the bytes it last agreed on (platform/sync/localStore.ts). */
export const SYNC_BASE_DIR = "sync-base";

export interface ProseFs {
  /** Null when the file is not there. */
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface ObservationResolver {
  resolveConflict(
    copyPath: string,
    resolved: { summary: string; body: string; type?: Observation["type"] },
    resolvedBy: string,
  ): Promise<Observation | null>;
}

export interface AdjudicateRequest {
  systemPrompt: string;
  task: string;
}

export interface AdjudicateDeps {
  fs: ProseFs;
  observations: ObservationResolver;
  /** The one model call. Live, the everyday tier on the background budget. */
  callModel(request: AdjudicateRequest): Promise<string>;
  /** Only to render the observation the store wrote back into its bytes. */
  serializeObservation(entry: Observation): string;
}

export type AdjudicationOutcome =
  /** The adjudicated text is on disk and the copy is gone. */
  | { status: "resolved"; path: string; digest: string }
  /** The copy was already gone: somebody settled it first. */
  | { status: "gone" };

/** The provenance an adjudicated file carries, or its run records. */
export function resolvedByFor(runId: string): string {
  return `legion/${runId}`;
}

export const ADJUDICATE_SYSTEM_PROMPT = [
  "Two devices edited the same file before either saw the other's edit, and a sync kept one version and set the other aside. You write the one version the file should hold now.",
  "",
  "Keep what each side added unless the other side deliberately replaced or removed it. Where both rewrote the same passage, write the passage once, keeping what is true in each. Do not add anything neither version says. Write in the language the file is written in.",
  "",
  "If you cannot tell what the file should say — the versions contradict each other on a fact, or one side reads as a deliberate deletion of what the other kept — do not guess. Say you are not confident and why.",
  "",
  "Answer with one JSON object and nothing else:",
  '- confident, a file with a summary and a body: {"confident": true, "summary": "<one line>", "body": "<markdown>"}',
  '- confident, any other file: {"confident": true, "text": "<the whole file>"}',
  '- not confident: {"confident": false, "reason": "<one sentence>"}',
].join("\n");

function section(title: string, text: string | null, absent: string): string {
  return text === null ? `## ${title}\n\n(${absent})` : `## ${title}\n\n<<<\n${text}\n>>>`;
}

/** The task the model is given for one conflict. */
export function adjudicationTask(
  conflict: ProseConflict,
  texts: { base: string | null; kept: string; parked: string },
): string {
  const answer =
    conflict.role.shape === "observation"
      ? "This file has a summary and a body: answer with summary and body. The frontmatter is kept by the app; do not write it."
      : "Answer with text: the whole file.";
  return [
    `File: ${conflict.path}`,
    `What it is: ${conflict.role.about}`,
    answer,
    "",
    section("Base (both sides started from this)", texts.base, "no base: the two versions were written independently"),
    "",
    section("Version A (kept)", texts.kept, ""),
    "",
    section("Version B (set aside)", texts.parked, ""),
  ].join("\n");
}

export type Verdict =
  | { confident: true; summary: string; body: string; type?: Observation["type"] }
  | { confident: true; text: string }
  | { confident: false; reason: string };

function jsonObject(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(reply.slice(start, end + 1));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The model's answer, or null when it cannot be read as one of the three.
 * A confident answer with nothing in it is read as not confident.
 */
export function parseVerdict(reply: string, shape: ProseConflict["role"]["shape"]): Verdict | null {
  const obj = jsonObject(reply);
  if (!obj || typeof obj.confident !== "boolean") return null;
  if (!obj.confident) {
    const reason = typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim() : "no reason given";
    return { confident: false, reason };
  }
  if (shape === "observation") {
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    const body = typeof obj.body === "string" ? obj.body.trim() : "";
    if (!summary || !body) return { confident: false, reason: "the answer left the summary or the body empty" };
    const type = typeof obj.type === "string" && isObservationType(obj.type) ? obj.type : undefined;
    return { confident: true, summary, body, ...(type ? { type } : {}) };
  }
  const text = typeof obj.text === "string" ? obj.text : "";
  if (!text.trim()) return { confident: false, reason: "the answer left the file empty" };
  return { confident: true, text: text.endsWith("\n") ? text : `${text}\n` };
}

/**
 * Whether both versions were themselves written by an adjudication. Such a
 * conflict is never adjudicated again: two runs that each settled the file are
 * two edits, and settling their conflict would only make a third (docs/59 §6).
 * Only an observation carries the mark in the file; see sweep.ts for the rest.
 */
export function bothObservationsAdjudicated(kept: string, parked: string): boolean {
  return resolvedByOf(parseObservation(kept)) !== null && resolvedByOf(parseObservation(parked)) !== null;
}

/** The digest sync names a copy with, of text about to be written. */
export function digestOf(text: string): string {
  return textDigest(encode(text));
}

/**
 * Settle one conflict. Throws GiveUpError when the model is not confident or
 * the conflict is not one to settle; any other throw is an attempt that failed
 * and may be tried again.
 */
export async function adjudicate(
  conflict: ProseConflict,
  runId: string,
  deps: AdjudicateDeps,
): Promise<AdjudicationOutcome> {
  const parked = await deps.fs.read(conflict.copyPath);
  if (parked === null) return { status: "gone" };
  const kept = await deps.fs.read(conflict.path);
  if (kept === null) throw new GiveUpError(`${conflict.path} is gone; its conflict copy is left for a person`);
  const observation = conflict.role.shape === "observation";
  if (observation && bothObservationsAdjudicated(kept, parked)) {
    throw new GiveUpError(`both versions of ${conflict.path} were adjudicated already; left for a person`);
  }
  const base = await deps.fs.read(`${SYNC_BASE_DIR}/${conflict.path}`);

  const reply = await deps.callModel({
    systemPrompt: ADJUDICATE_SYSTEM_PROMPT,
    task: adjudicationTask(conflict, { base, kept, parked }),
  });
  const verdict = parseVerdict(reply, conflict.role.shape);
  if (!verdict) throw new Error("the adjudication reply could not be read");
  if (!verdict.confident) throw new GiveUpError(`not confident: ${verdict.reason}`);

  const resolvedBy = resolvedByFor(runId);
  if ("summary" in verdict) {
    const entry = await deps.observations.resolveConflict(
      conflict.copyPath,
      { summary: verdict.summary, body: verdict.body, ...(verdict.type ? { type: verdict.type } : {}) },
      resolvedBy,
    );
    if (!entry) return { status: "gone" };
    return { status: "resolved", path: conflict.path, digest: digestOf(deps.serializeObservation(entry)) };
  }
  await deps.fs.write(conflict.path, verdict.text);
  await deps.fs.remove(conflict.copyPath);
  return { status: "resolved", path: conflict.path, digest: digestOf(verdict.text) };
}
