// The two links that already exist in stored observations and that nothing in
// src/ could follow until now:
//
//   1. anchor -> observations. An observation points back at the marks and
//      messages it came from; going the other way — "what did I notice about
//      this mark" — meant scanning every entry file.
//   2. observation -> observation. The distiller writes bare `m-<8hex>`
//      mentions into bodies unprompted, because the index text it is handed
//      prints `id m-xxxxxxxx` on every line. On one real store (2026-08-31) 285
//      such mentions sit in 81 of 143 bodies, 278 distinct source-target pairs,
//      and every one of them resolves. Nothing read them.
//
// Both are pure functions of the observation list the caller already holds:
// reading/turn.ts calls listObservations() on every reading turn, and reading
// all 106 files of the largest topic measures 1.01 ms. Neither adds I/O.

import type { Observation } from "./types";

// --- anchor -> observations ---

// Two maps rather than one, because the two anchor kinds are two namespaces —
// an annotation id is a UUID, a message id is "<threadId>:<ts>" — and every
// caller knows which one it is holding (a mark on the page, or a turn in a
// thread). One merged map would let the wrong kind match by accident and could
// never be told apart again.
export interface AnchorIndex {
  annotations: ReadonlyMap<string, readonly Observation[]>;
  messages: ReadonlyMap<string, readonly Observation[]>;
}

function push(map: Map<string, Observation[]>, key: string, entry: Observation): void {
  const bucket = map.get(key);
  if (!bucket) {
    map.set(key, [entry]);
    return;
  }
  // An entry that lists the same anchor twice is one observation of that
  // anchor. The write path does not de-duplicate (store.normalizeAnchors passes
  // the list through) and no entry on the real store repeats one today, so this
  // guards the shape rather than a case that has happened.
  if (bucket[bucket.length - 1] !== entry) bucket.push(entry);
}

// Buckets keep the order of the list they were built from — this never sorts.
// store.list() hands back newest-updated first, so a caller that passed that
// list reads each bucket newest first without asking for it.
export function buildAnchorIndex(entries: readonly Observation[]): AnchorIndex {
  const annotations = new Map<string, Observation[]>();
  const messages = new Map<string, Observation[]>();
  for (const entry of entries) {
    for (const id of entry.anchors.annotationIds) push(annotations, id, entry);
    for (const id of entry.anchors.messageIds) push(messages, id, entry);
  }
  return { annotations, messages };
}

export function observationsForAnnotation(index: AnchorIndex, annotationId: string): readonly Observation[] {
  return index.annotations.get(annotationId) ?? [];
}

export function observationsForMessage(index: AnchorIndex, messageId: string): readonly Observation[] {
  return index.messages.get(messageId) ?? [];
}

// The other observations built on any of this one's evidence, itself excluded.
// The reason to have it: 50 of 159 annotation ids and 72 of 197 message ids on
// one real store carry more than one observation, so half the store has a
// neighbour that the anchors only implied. 106 of 143 entries have at least one
// sibling, the median is 2 and the widest is 9.
export function anchorSiblings(index: AnchorIndex, entry: Observation): Observation[] {
  const seen = new Set<string>([entry.id]);
  const out: Observation[] = [];
  const take = (candidates: readonly Observation[]): void => {
    for (const other of candidates) {
      if (seen.has(other.id)) continue;
      seen.add(other.id);
      out.push(other);
    }
  };
  for (const id of entry.anchors.annotationIds) take(observationsForAnnotation(index, id));
  for (const id of entry.anchors.messageIds) take(observationsForMessage(index, id));
  return out;
}

// --- observation -> observation ---

// An observation id as it appears mid-prose. The boundaries matter: without the
// trailing one a longer hex run would match its own first eight characters, and
// without the leading one the tail of another token would match. The leading
// boundary is a consumed group rather than a lookbehind because this ships to
// WKWebView on iOS and a lookbehind is not worth the floor it sets.
const MENTION = /(^|[^0-9a-z-])(m-[0-9a-f]{8})(?![0-9a-f])/gi;

// Every observation id mentioned in a piece of text, de-duplicated, in the
// order they first appear. `self` drops the entry's own id, which is prose
// about itself rather than a link (zero of them on the real store, but an
// evolution rewrite that quotes its own id would be one).
export function mentionedIds(text: string, self?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION)) {
    const id = m[2].toLowerCase();
    if (id === self || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface ResolvedReferences {
  // What the mentions point at, in the order they first appear in the body.
  resolved: Observation[];
  // Mentioned ids that nothing in the map holds: an observation the distiller
  // deleted after citing it, or — until recall widens — one stored under
  // another topic. Zero of either on the real store today.
  dangling: string[];
}

export function observationsById(entries: readonly Observation[]): Map<string, Observation> {
  return new Map(entries.map((e) => [e.id, e]));
}

// Resolve one observation's mentions against a set of known ids. The known set
// is a parameter and not this topic's store on purpose: mentions never cross a
// topic directory today, but that is a consequence of the per-topic scoping,
// not a property of the text. A caller that merges several topics' maps here
// resolves the same bodies wider with no change to this file.
export function resolveReferences(
  entry: Observation,
  known: ReadonlyMap<string, Observation>,
): ResolvedReferences {
  const resolved: Observation[] = [];
  const dangling: string[] = [];
  for (const id of mentionedIds(entry.body, entry.id)) {
    const hit = known.get(id);
    if (hit) resolved.push(hit);
    else dangling.push(id);
  }
  return { resolved, dangling };
}
