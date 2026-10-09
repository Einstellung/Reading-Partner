// The topics strategy: topics.json. The file is records, one per topic, and a
// topic only one side touched is still taken whole. What changes is a topic both
// sides touched. Under records it was one atomic record, so a desktop that wrote
// a lastOpenedAt and a phone that took a book off the same topic kept one side's
// topic, and the other side's books went to sync-trash. Here the topic's own
// keys merge as fields and its `files` merge three-way one book at a time
// (docs/59 §11), the way a thread's messages do (messages.ts).
//
// A book taken off a topic is gone from the merge even when the other side
// edited its row: nothing in a row (an open time, a repaired path, a backfilled
// id) is the reader asking for the book to stay. That covers two devices with a
// base. A merge without one, and a client that still settles a topic whole,
// can still hand the row back; the deletion log is what holds the line there
// (platform/app/topics.ts, pruneDeletedTopics).
//
// Everything below is a function of the three inputs' content, the same as the
// rest of merge/: both devices settle the same topic and have to land on the
// same bytes.

import type { DroppedRecord } from "./contract";
import { mergeObject } from "./fields";
import type { SettleRecord } from "./records";
import { isPlainObject, orderIds, pickByContent, sameValue, type Json } from "./text";

type JsonObject = { [key: string]: Json };

// A row's identity within its topic: the book id, else the path (a row written
// before 2026-09-21 carries no id). Null when it has neither, which no writer
// produces.
export function fileKey(file: Json): string | null {
  if (!isPlainObject(file)) return null;
  const { hash, path } = file;
  if (typeof hash === "string" && hash !== "") return hash;
  if (typeof path === "string" && path !== "") return `path:${path}`;
  return null;
}

// One side's rows by key, in file order. A second row of a book the topic
// already lists is the same book: the first in the file stands for it and the
// rest are handed back to be journalled. Null when the list is missing or not
// one, or a row has no identity; the topic is then settled whole.
function keyed(
  topicId: string,
  files: Json | undefined,
): { rows: Map<string, JsonObject>; extra: DroppedRecord[] } | null {
  if (!Array.isArray(files)) return null;
  const rows = new Map<string, JsonObject>();
  const extra: DroppedRecord[] = [];
  for (const file of files) {
    const key = fileKey(file);
    if (key === null) return null;
    if (rows.has(key)) extra.push({ id: `${topicId}/${key}`, record: file });
    else rows.set(key, file as JsonObject);
  }
  return { rows, extra };
}

function withoutFiles(topic: JsonObject): JsonObject {
  const rest: JsonObject = {};
  for (const [key, value] of Object.entries(topic)) if (key !== "files") rest[key] = value;
  return rest;
}

/**
 * One topic both sides changed. Null when any side's files cannot be keyed —
 * the caller then settles the whole topic as one record and reports it
 * contested, which is what every topic got before this strategy.
 */
export const mergeTopic: SettleRecord = (topicId, base, local, remote) => {
  if (!isPlainObject(local) || !isPlainObject(remote)) return null;
  if (base !== undefined && !isPlainObject(base)) return null;
  const l = keyed(topicId, local.files);
  const r = keyed(topicId, remote.files);
  if (l === null || r === null) return null;
  const b = base === undefined ? null : keyed(topicId, base.files);
  if (base !== undefined && b === null) return null;

  const fields = mergeObject(
    base === undefined ? undefined : withoutFiles(base),
    withoutFiles(local),
    withoutFiles(remote),
    topicId,
  );
  const dropped: DroppedRecord[] = [...fields.dropped, ...l.extra, ...r.extra];
  let contested = fields.contested;

  const files: Json[] = [];
  const order = orderIds(b ? [...b.rows.keys()] : [], [...l.rows.keys()], [...r.rows.keys()]);
  for (const key of order) {
    const bf = b?.rows.get(key);
    const lf = l.rows.get(key);
    const rf = r.rows.get(key);
    const id = `${topicId}/${key}`;
    if (bf !== undefined && (lf === undefined || rf === undefined)) {
      // Taken off on one side or both. The row the other side still has goes
      // too, journalled as it stood there if it had moved.
      const other = lf ?? rf;
      dropped.push({ id, record: other !== undefined && !sameValue(other, bf) ? other : bf });
      continue;
    }
    if (lf !== undefined && rf !== undefined) {
      if (sameValue(lf, rf)) {
        files.push(pickByContent(lf, rf));
        continue;
      }
      // Both have the book and the rows differ: field by field, against the
      // base's row when there was one. Two open times both moved is settled
      // by content and the one that lost is journalled.
      const row = mergeObject(bf, lf, rf, id);
      dropped.push(...row.dropped);
      contested = contested || row.contested;
      const same = [lf, rf].filter((side) => sameValue(side, row.value));
      files.push(same.length === 2 ? pickByContent(lf, rf) : (same[0] ?? row.value));
      continue;
    }
    // On one side only and not in the base: an addition, or — with no base — a
    // row this merge cannot prove was ever taken off.
    const one = lf ?? rf;
    if (one !== undefined) files.push(one);
  }

  // The topic's keys where the three already had them, `files` among them.
  const keys = orderIds(
    base === undefined ? [] : Object.keys(base),
    Object.keys(local),
    Object.keys(remote),
  );
  const out: JsonObject = {};
  for (const key of keys) {
    if (key === "files") out.files = files;
    else if (fields.value[key] !== undefined) out[key] = fields.value[key];
  }

  // A topic that came out saying what one side already said is that side's own
  // object, so its key order is not rewritten.
  const same = [local, remote].filter((side) => sameValue(side, out));
  const value = same.length === 2 ? pickByContent(local, remote) : (same[0] ?? out);
  return { value, dropped, contested };
};
