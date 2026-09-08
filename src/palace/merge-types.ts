// The vocabulary a palace row uses to say how a file is merged. Here rather
// than in platform/sync/merge so that the table can name a strategy without
// depending on the code that runs it: sync derives its hand-written lists from
// the table, so the arrow points that way and only that way.
//
// Pure types. This file has no runtime half at all.

export type MergeStrategy =
  // JSON collections of identified records: three-way per record. Covers an
  // array of objects carrying an id, an object keyed by id, and JSONL (one
  // record per line, the line itself is the identity).
  | "records"
  // JSON objects of scalar settings: three-way per field.
  | "fields"
  // Fields, where the scalars are watermarks and the lower of two is the safe
  // one: observations/meta.json and nothing else (platform/sync/merge/cursors.ts).
  | "cursors"
  // Markdown the user writes: three-way per line, conflict copy on overlap.
  | "prose"
  // Anything else: keep ours, park theirs beside it.
  | "opaque";

// Where a record file keeps its records and what identifies one, read off the
// writers rather than guessed. A map's key is the identity. A JSONL line is its
// own identity: the lines carry no id of their own and the log is append-only.
export interface RecordShape {
  kind: "array" | "map" | "lines";
  // The key the collection sits under, or null when it is the whole file.
  container: string | null;
  // The field carrying a record's identity in an array. Null for a map, whose
  // key is the identity.
  idField: string | null;
}

// Keys of one file that only mean anything together: which of a file's keys the
// fields strategy is forbidden to settle one at a time. A member is named by the
// same dotted path the merge journals a key under, so a group nested inside an
// object is expressible.
//
// A group belongs here only when splitting it produces a state that cannot
// exist, not merely an unexpected one (pitfall 237).
export type FieldGroups = readonly (readonly string[])[];
