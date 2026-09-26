// The messages strategy: the conversation files (threads-*.json, and the
// door's conversation-<date>.json, which is the same store under another name).
// The file is a map of threads merged like any records file, and a thread only
// one side touched is still taken whole. What changes is a thread both sides
// touched: under records it was one atomic record, so two devices appending to
// the same conversation kept one side's thread and journalled the other's
// messages with it. Here the thread's own keys merge as fields and its messages
// merge three-way one message at a time (docs/59 §5).
//
// Everything below is a function of the three inputs' content, the same as the
// rest of merge/: both devices settle the same thread and have to land on the
// same bytes.

import type { DroppedRecord } from "./contract";
import { mergeObject } from "./fields";
import type { SettleRecord } from "./records";
import { chooseByContent, isPlainObject, orderIds, pickByContent, sameValue, type Json } from "./text";

type JsonObject = { [key: string]: Json };

// A message's identity within its thread: its own id when it has one
// (platform/app/threads.ts mints `t-<16hex>` on append), else the thread, stamp
// and role. The role is part of it because a user turn and the reply to it are
// often appended in the same millisecond (memory/observations/anchors.ts).
// Null when the message has neither, which no writer produces.
export function messageKey(threadId: string, message: Json): string | null {
  if (!isPlainObject(message)) return null;
  const { id, ts, role } = message;
  if (typeof id === "string" && id !== "") return id;
  if (typeof ts !== "number" || typeof role !== "string") return null;
  return `${threadId}:${ts}:${role}`;
}

// The messages of one side by key. Null when the list is not one, when a
// message has no identity, or when two messages share a key (two ai turns in
// one millisecond, both written before ids): the thread is then not merged
// message by message at all, rather than having two messages guessed apart.
function keyed(threadId: string, messages: Json | undefined): Map<string, JsonObject> | null {
  if (!Array.isArray(messages)) return null;
  const out = new Map<string, JsonObject>();
  for (const message of messages) {
    const key = messageKey(threadId, message);
    if (key === null || out.has(key)) return null;
    out.set(key, message as JsonObject);
  }
  return out;
}

// Whether `long` is `short` with more written onto its end: the shape a reply
// takes while it is still being written (patchThreadMessage rewrites the same
// message's text and parts in place). Every other key has to agree. The text
// grows as a string prefix. The parts grow as a list prefix, where the last
// part the shorter side has may itself have grown: a text part by its text, a
// trace by more settled tools. A card has no growing half — a card that
// changed is an edit, not more of the same message.
function extendsMessage(long: JsonObject, short: JsonObject): boolean {
  for (const key of new Set([...Object.keys(long), ...Object.keys(short)])) {
    if (key === "text" || key === "parts") continue;
    if (!sameValue(long[key], short[key])) return false;
  }
  return extendsText(long.text, short.text) && extendsParts(long.parts, short.parts);
}

function extendsText(long: Json | undefined, short: Json | undefined): boolean {
  if (typeof long === "string" && typeof short === "string") return long.startsWith(short);
  return sameValue(long, short);
}

// An absent list is an empty one: a reply is appended before it has parts.
function extendsParts(long: Json | undefined, short: Json | undefined): boolean {
  const l = long === undefined ? [] : long;
  const s = short === undefined ? [] : short;
  if (!Array.isArray(l) || !Array.isArray(s)) return sameValue(long, short);
  if (s.length > l.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (sameValue(l[i], s[i])) continue;
    if (i !== s.length - 1 || !extendsPart(l[i], s[i])) return false;
  }
  return true;
}

function extendsPart(long: Json, short: Json): boolean {
  if (!isPlainObject(long) || !isPlainObject(short) || long.type !== short.type) return false;
  const grows = long.type === "text" ? "text" : long.type === "trace" ? "tools" : null;
  if (grows === null) return false;
  for (const key of new Set([...Object.keys(long), ...Object.keys(short)])) {
    if (key !== grows && !sameValue(long[key], short[key])) return false;
  }
  if (grows === "text") return extendsText(long.text, short.text);
  const l = long.tools;
  const s = short.tools;
  if (!Array.isArray(l) || !Array.isArray(s) || s.length > l.length) return false;
  return s.every((tool, i) => sameValue(tool, l[i]));
}

// Two versions of one message that both moved off the base (or both appeared
// without one). The longer of a message and its own continuation is the
// message, and the shorter one is not an edit that lost — everything in it is
// still in the file. Anything else is two edits, settled by content, and the
// one that lost is journalled.
function settleMessage(a: JsonObject, b: JsonObject): { winner: Json; loser: Json | null } {
  const aLonger = extendsMessage(a, b);
  const bLonger = extendsMessage(b, a);
  if (aLonger && !bLonger) return { winner: a, loser: null };
  if (bLonger && !aLonger) return { winner: b, loser: null };
  return chooseByContent(a, b);
}

// A user turn is appended before the reply to it, so at one stamp the user goes
// first. Any other role (none today) after both.
function roleRank(role: Json | undefined): number {
  return role === "user" ? 0 : role === "ai" ? 1 : 2;
}

// Stamp, then role, then key. Not array position: the two devices inserted in
// different orders, and only a pure function of the messages puts them in one.
function compareMessages(a: [string, JsonObject], b: [string, JsonObject]): number {
  const [ka, ma] = a;
  const [kb, mb] = b;
  const ta = typeof ma.ts === "number" ? ma.ts : Number.POSITIVE_INFINITY;
  const tb = typeof mb.ts === "number" ? mb.ts : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ra = roleRank(ma.role);
  const rb = roleRank(mb.role);
  if (ra !== rb) return ra - rb;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function withoutMessages(thread: JsonObject): JsonObject {
  const rest: JsonObject = {};
  for (const [key, value] of Object.entries(thread)) if (key !== "messages") rest[key] = value;
  return rest;
}

/**
 * One thread both sides changed. Null when any side's messages cannot be keyed
 * one to one — the caller then settles the whole thread as one record and
 * reports it contested, which is what every thread got before this strategy.
 */
export const mergeThread: SettleRecord = (threadId, base, local, remote) => {
  if (!isPlainObject(local) || !isPlainObject(remote)) return null;
  if (base !== undefined && !isPlainObject(base)) return null;
  const lm = keyed(threadId, local.messages);
  const rm = keyed(threadId, remote.messages);
  if (lm === null || rm === null) return null;
  const bm = base === undefined ? null : keyed(threadId, base.messages);
  if (base !== undefined && bm === null) return null;

  const fields = mergeObject(
    base === undefined ? undefined : withoutMessages(base),
    withoutMessages(local),
    withoutMessages(remote),
    threadId,
  );
  const dropped: DroppedRecord[] = [...fields.dropped];
  let contested = fields.contested;

  // The table in docs/59 §5, one message at a time. An edit outranks a delete;
  // with no base nothing can be told from an addition, so nothing is removed.
  const kept: [string, JsonObject][] = [];
  const keys = [...new Set([...(bm?.keys() ?? []), ...lm.keys(), ...rm.keys()])].sort();
  for (const key of keys) {
    const b = bm?.get(key);
    const l = lm.get(key);
    const r = rm.get(key);
    const id = `${threadId}/${key}`;
    if (l !== undefined && r !== undefined) {
      if (sameValue(l, r)) kept.push([key, pickByContent(l, r) as JsonObject]);
      else if (b !== undefined && sameValue(l, b)) kept.push([key, r]);
      else if (b !== undefined && sameValue(r, b)) kept.push([key, l]);
      else {
        const { winner, loser } = settleMessage(l, r);
        kept.push([key, winner as JsonObject]);
        if (loser !== null) {
          dropped.push({ id, record: loser });
          contested = true;
        }
      }
      continue;
    }
    const one = l ?? r;
    if (b === undefined) {
      if (one !== undefined) kept.push([key, one]);
      continue;
    }
    if (one === undefined || sameValue(one, b)) {
      dropped.push({ id, record: b });
      continue;
    }
    kept.push([key, one]);
  }
  kept.sort(compareMessages);

  // The thread's keys where the three already had them, `messages` among them.
  const order = orderIds(
    base === undefined ? [] : Object.keys(base),
    Object.keys(local),
    Object.keys(remote),
  );
  const out: JsonObject = {};
  for (const key of order) {
    if (key === "messages") out.messages = kept.map(([, message]) => message);
    else if (fields.value[key] !== undefined) out[key] = fields.value[key];
  }

  // A thread that came out saying what one side already said is that side's
  // own object, so its key order is not rewritten.
  const same = [local, remote].filter((side) => sameValue(side, out));
  const value = same.length === 2 ? pickByContent(local, remote) : (same[0] ?? out);
  return { value, dropped, contested };
};
