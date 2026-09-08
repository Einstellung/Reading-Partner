// What sync does when both sides changed the same file. The inputs are the
// three git has: the content at the last successful sync, ours, and theirs.
//
// Two rules hold for every strategy. Nothing the user wrote is dropped without
// leaving a copy or a journal entry. And every decision is deterministic from
// the three inputs alone: both devices merge the same pair independently and
// must land on the same bytes, so nothing may depend on which side happens to
// be "local", on a wall clock, or on the order the two devices sync in.

import { resolvePalace, rowOf } from "../../../palace";
import type { FieldGroups, MergeStrategy } from "../../../palace/merge-types";

// How sync merges two edits of one file, and which of a file's keys the fields
// strategy may not settle one at a time. Both are declared beside the palace
// table (palace/merge-types.ts) so a row can name a strategy without the table
// depending on the code that runs it; re-exported here because this is where
// every caller has always reached for them.
export type { MergeStrategy };

export interface MergeInput {
  // AppData-relative path of the file being merged.
  path: string;
  // Content at the last successful sync. Null when this device has no base for
  // it (first sync after upgrade, or a file it has never pulled) — with no base
  // a strategy cannot tell an add from a delete, so it must not delete.
  base: Uint8Array | null;
  local: Uint8Array;
  remote: Uint8Array;
}

export interface ConflictCopy {
  // AppData-relative path. Named from a hash of its own content so that both
  // devices produce the same name for the same conflict and the copies
  // converge instead of multiplying.
  path: string;
  bytes: Uint8Array;
}

export interface DroppedRecord {
  id: string;
  record: unknown;
}

export interface MergeOutput {
  // The content to keep at `input.path`.
  merged: Uint8Array;
  // Files to write beside it. An existing path is never overwritten.
  copies: ConflictCopy[];
  // Versions of a record, or of a settings key, that this merge did not keep:
  // the other side deleted it, or the other side's edit won the tie-break. The
  // engine journals them locally so nothing a device wrote is only recoverable
  // from the device that no longer has it.
  dropped: DroppedRecord[];
  // The merge had to choose between two edits of the same record, field, or
  // line. Reported for the UI; not an error.
  contested: boolean;
}

export type MergeFile = (input: MergeInput) => MergeOutput;

// Which of a file's keys the fields strategy is forbidden to settle one at a
// time. The groups are declared on the rows (palace/kinds.ts); this is where
// the callers have always reached for the type.
//
// sttApiBase and sttModel are the two halves of one endpoint and deliberately
// not a group: settings.ts says they sync freely, and a base from one device
// with a model name from the other is a configuration, not a contradiction.
export type { FieldGroups };

const NO_GROUPS: FieldGroups = [];

// The one group there is, taken off the settings row rather than written out
// again here: a model id is only meaningful under its own provider, and a
// device on DeepSeek merged key by key against one on Cerebras lands on a pair
// neither device ever held (pitfall 237).

const SETTINGS_GROUPS: FieldGroups = rowOf("settings").fieldGroups ?? NO_GROUPS;

export function fieldGroupsFor(path: string): FieldGroups {
  const row = resolvePalace(path)?.row;
  if (row) return row.fieldGroups ?? NO_GROUPS;
  // A settings file somewhere the table has never heard of still gets the
  // group: the tail of strategyFor merges it as fields, and fields without the
  // group is exactly the split the group exists to prevent.
  return path.slice(path.lastIndexOf("/") + 1) === "settings.json" ? SETTINGS_GROUPS : NO_GROUPS;
}

/**
 * How sync merges two edits of this file.
 *
 * The answer is the palace row's (palace/kinds.ts), where every kind of file
 * the app writes is described once. The strategy, the record shape and the sync
 * range used to be three hand-written lists that agreed only by accident. A
 * file the table claims but does not sync carries no strategy at all and falls
 * through to the same tail as a file the table has never heard of.
 *
 * The tail is for paths from older builds and from directories no longer in
 * range: markdown is prose, a settings or plan state is fields, a tombstone log
 * is records wherever it sits — opaque would park one device's whole list in a
 * conflict copy and undo every deletion in it (pitfall 208) — and anything else
 * keeps ours.
 */
export function strategyFor(path: string): MergeStrategy {
  const strategy = resolvePalace(path)?.row.merge;
  if (strategy) return strategy;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.endsWith(".md")) return "prose";
  if (name === "deleted-observations.jsonl") return "records";
  if (name === "settings.json" || name === "state.json") return "fields";
  return "opaque";
}

