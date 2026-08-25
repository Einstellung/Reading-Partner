// What sync does when both sides changed the same file. The inputs are the
// three git has: the content at the last successful sync, ours, and theirs.
//
// Two rules hold for every strategy. Nothing the user wrote is dropped without
// leaving a copy or a journal entry. And every decision is deterministic from
// the three inputs alone: both devices merge the same pair independently and
// must land on the same bytes, so nothing may depend on which side happens to
// be "local", on a wall clock, or on the order the two devices sync in.

export type MergeStrategy =
  // JSON collections of identified records: three-way per record. Covers an
  // array of objects carrying an id, an object keyed by id, and JSONL (one
  // record per line, the line itself is the identity).
  | "records"
  // JSON objects of scalar settings: three-way per field.
  | "fields"
  // Markdown the user writes: three-way per line, conflict copy on overlap.
  | "prose"
  // Anything else: keep ours, park theirs beside it.
  | "opaque";

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

const RECORD_FILES = new Set([
  "library.json",
  "topics.json",
  "reading-state.json",
  "info-sources.json",
  "info-feedback.jsonl",
  "saved-articles.json",
  // What the collector has already put in a briefing (docs/35). Not derived —
  // losing it means pushing the same item twice — and it travels so that a
  // machine taking over collection knows what its predecessor already sent.
  "info-pool-marks.json",
]);

export function strategyFor(path: string): MergeStrategy {
  // What the reader said on one pass over a deck (docs/43),
  // runs/<rehearsalId>/<runId>.json. Judged by where it sits and not by its
  // name, because its name is a run id: an id that happened to read as
  // "state.json" would otherwise be merged field by field. Opaque, and never
  // exercised — the file is written once, under an id nothing else will ever
  // use, so the same path on two devices is the same pass.
  if (path.startsWith("runs/")) return "opaque";
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.endsWith(".md")) return "prose";
  if (RECORD_FILES.has(name)) return "records";
  if (name === "settings.json" || name === "state.json") return "fields";
  if (/^annotations-.+\.json$/.test(name)) return "records";
  // A talk's outline (docs/44). The segments are identified records — two
  // devices working on different parts of the same talk must keep both, and
  // opaque would park one whole file in a conflict copy nobody opens. The spine
  // beside them is fields, which is what a record file's wrapper keys already
  // get (writeCollection, records.ts), so one file covers both layers.
  if (/^outline-.+\.json$/.test(name)) return "records";
  if (/^threads-.+\.json$/.test(name)) return "records";
  // A rehearsal's index of passes (docs/43): identified rows in a `runs` array,
  // and a row is a pass that happened — nothing ever edits one. Records, so two
  // devices that each gave the deck a turn keep both passes; opaque would park
  // one of them in a conflict copy nobody opens. It could only be records once
  // the transcripts moved out: merging row by row is cheap, merging thirty KB of
  // talk per row was not the shape to grow into.
  if (/^runs-rehearsal-.+\.json$/.test(name)) return "records";
  // article-bodies/<hash>.json falls through here on purpose. A body file is
  // named after the hash of its own bytes, so two devices holding the same name
  // hold the same content and there is no conflict to resolve; keeping ours is
  // the right answer and the conflict copy never gets written.
  return "opaque";
}
