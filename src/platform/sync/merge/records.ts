// The records strategy: a JSON collection of identified records, merged one
// record at a time against the base. A record is atomic — two devices editing
// the same annotation get one of the two, not a blend of both — which is the
// difference between this and the fields strategy.

import type { DroppedRecord } from "./contract";
import { mergeField } from "./fields";
import {
  chooseByContent,
  isPlainObject,
  orderIds,
  pickByContent,
  sameValue,
  type Json,
} from "./text";

// Where each record file keeps its records and what identifies one, read off
// the writers rather than guessed:
//   annotations-<bookId>.json  array of Annotation, `id`      (platform/app/annotations.ts)
//   info-sources.json          array of SourceDescriptor, `id` (info/sources/source-store.ts)
//   saved-articles.json        array of SavedArticle, `id`     (reading/saved-articles.ts)
//   topics.json                { topics: Topic[] }, `id`       (platform/app/topics.ts)
//   threads-<key>.json         { threads: Record<id, Thread> } (platform/app/threads.ts)
//   library.json               { books: Record<hash, Entry> }  (platform/app/library.ts)
//   reading-state.json         { states: Record<bookId, ViewState> } (platform/app/storage.ts)
//   info-feedback.jsonl        one JSON object per line        (observation/profile/feedback.ts)
// A map's key is the identity. A JSONL line is its own identity: the events
// carry no id of their own and the log is append-only.
export interface RecordShape {
  kind: "array" | "map" | "lines";
  // The key the collection sits under, or null when it is the whole file.
  container: string | null;
  // The field carrying a record's identity in an array. Null for a map, whose
  // key is the identity.
  idField: string | null;
}

export function recordShape(path: string): RecordShape | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "info-feedback.jsonl") return { kind: "lines", container: null, idField: null };
  if (name === "info-sources.json") return { kind: "array", container: null, idField: "id" };
  if (name === "saved-articles.json") return { kind: "array", container: null, idField: "id" };
  if (name === "topics.json") return { kind: "array", container: "topics", idField: "id" };
  if (name === "library.json") return { kind: "map", container: "books", idField: null };
  if (name === "reading-state.json") return { kind: "map", container: "states", idField: null };
  // Keyed by item id (info/extract/id.ts), which is a hash of source:key and so
  // is the same on every device. `version` sits beside `marks` as a wrapper key
  // and readCollection keeps it.
  if (name === "info-pool-marks.json") return { kind: "map", container: "marks", idField: null };
  if (/^annotations-.+\.json$/.test(name)) return { kind: "array", container: null, idField: "id" };
  if (/^threads-.+\.json$/.test(name)) return { kind: "map", container: "threads", idField: null };
  return null;
}

// The records of one file, plus the wrapper keys sitting beside them (none
// today; a field added next to the collection later must not be dropped).
export interface Collection {
  ids: string[];
  byId: Map<string, Json>;
  wrapper: { [key: string]: Json } | null;
}

// Null when the file on disk is not the shape the writer produces — a record
// without an identity, two records sharing one, a collection that turned out to
// be a scalar. The caller then falls back to opaque rather than guessing.
export function readCollection(value: Json | undefined, shape: RecordShape): Collection | null {
  if (value === undefined) return null;
  let holder: Json | undefined = value;
  let wrapper: { [key: string]: Json } | null = null;
  if (shape.container !== null) {
    if (!isPlainObject(value)) return null;
    wrapper = value;
    holder = value[shape.container];
    // A file written before the collection had anything in it.
    if (holder === undefined) holder = shape.kind === "array" ? [] : {};
  }

  const ids: string[] = [];
  const byId = new Map<string, Json>();
  if (shape.kind === "array") {
    if (!Array.isArray(holder)) return null;
    const field = shape.idField as string;
    for (const record of holder) {
      if (!isPlainObject(record)) return null;
      const id = record[field];
      if (typeof id !== "string" || id === "") return null;
      if (byId.has(id)) return null;
      ids.push(id);
      byId.set(id, record);
    }
  } else {
    if (!isPlainObject(holder)) return null;
    for (const id of Object.keys(holder)) {
      ids.push(id);
      byId.set(id, holder[id]);
    }
  }
  return { ids, byId, wrapper };
}

// JSONL: one record per line, and the line is its own identity — the events
// feedback.ts appends carry no id of their own. Blank lines are not records;
// a repeat of a line already present is the same record, not a second one.
export function lineCollection(text: string): Collection {
  const ids: string[] = [];
  const byId = new Map<string, Json>();
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") continue;
    if (byId.has(line)) continue;
    ids.push(line);
    byId.set(line, line);
  }
  return { ids, byId, wrapper: null };
}

export interface CollectionMerge {
  ids: string[];
  byId: Map<string, Json>;
  dropped: DroppedRecord[];
  contested: boolean;
}

// Per record, against the base. A record only one side touched is taken from
// that side; one both sides touched is settled by content and reported as
// contested; a record the base had and one side deleted goes only if the other
// side left it alone, because an edit always outranks a delete. With no base
// this is a union: nothing can be told apart from an addition, so nothing is
// removed.
export function mergeCollection(
  base: Collection | null,
  local: Collection,
  remote: Collection,
): CollectionMerge {
  const order = orderIds(base ? base.ids : [], local.ids, remote.ids);
  const ids: string[] = [];
  const byId = new Map<string, Json>();
  const dropped: DroppedRecord[] = [];
  let contested = false;

  for (const id of order) {
    const b = base ? base.byId.get(id) : undefined;
    const l = local.byId.get(id);
    const r = remote.byId.get(id);
    const inBase = base !== null && base.byId.has(id);

    if (l !== undefined && r !== undefined) {
      if (sameValue(l, r)) {
        byId.set(id, pickByContent(l, r));
      } else if (inBase && sameValue(l, b)) {
        byId.set(id, r);
      } else if (inBase && sameValue(r, b)) {
        byId.set(id, l);
      } else {
        // Both edited it. One version goes in the file, the other is journalled
        // so the edit that lost is still recoverable.
        const { winner, loser } = chooseByContent(l, r);
        byId.set(id, winner);
        dropped.push({ id, record: loser });
        contested = true;
      }
      ids.push(id);
      continue;
    }

    const kept = l !== undefined ? l : r;
    if (!inBase) {
      // An addition, or — with no base — a record this pass cannot prove was
      // ever deleted.
      if (kept !== undefined) {
        byId.set(id, kept);
        ids.push(id);
      }
      continue;
    }
    if (kept === undefined || sameValue(kept, b)) {
      // Gone from one side and untouched on the other, or gone from both: the
      // delete stands, and the record it removed is journalled.
      dropped.push({ id, record: b });
      continue;
    }
    byId.set(id, kept);
    ids.push(id);
  }

  return { ids, byId, dropped, contested };
}

// Rebuild the file around the merged records, keeping the wrapper's own keys —
// merged as fields — and the base's key order.
export function writeCollection(
  merged: CollectionMerge,
  shape: RecordShape,
  base: Collection | null,
  local: Collection,
  remote: Collection,
): { value: Json; dropped: DroppedRecord[]; contested: boolean } {
  const body: Json =
    shape.kind === "array"
      ? merged.ids.map((id) => merged.byId.get(id) as Json)
      : Object.fromEntries(merged.ids.map((id) => [id, merged.byId.get(id) as Json]));

  if (shape.container === null) {
    return { value: body, dropped: merged.dropped, contested: merged.contested };
  }

  const container = shape.container;
  const keysOf = (c: Collection | null): string[] =>
    c && c.wrapper ? Object.keys(c.wrapper) : [container];
  const order = orderIds(base ? keysOf(base) : [], keysOf(local), keysOf(remote));
  const out: { [key: string]: Json } = {};
  const dropped = [...merged.dropped];
  let contested = merged.contested;

  for (const key of order) {
    if (key === container) {
      out[container] = body;
      continue;
    }
    const field = mergeField(
      base?.wrapper?.[key],
      local.wrapper?.[key],
      remote.wrapper?.[key],
      key,
    );
    dropped.push(...field.dropped);
    contested = contested || field.contested;
    if (field.value !== undefined) out[key] = field.value;
  }
  if (!(container in out)) out[container] = body;
  return { value: out, dropped, contested };
}
