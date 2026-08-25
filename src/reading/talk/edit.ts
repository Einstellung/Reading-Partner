// Every change an outline can undergo, as a pure function of the outline and
// the change. The store (store.ts) is nothing but read, apply one of these,
// write — so what an edit does is testable without a filesystem, and the AI tool
// that will write segments (docs/44) and the pane that will show them are
// applying the same functions rather than each spelling out their own.
//
// Every one of them answers the outline itself when the change is not a change.
// The store writes only what came back different, which is what keeps a
// no-op out of the sync revision it would otherwise cost.

import {
  DEFAULT_SEGMENT_STATUS,
  normalizeSegment,
  normalizeSpine,
  type TalkOutline,
  type TalkSegment,
  type TalkSpine,
} from "./types";

/**
 * An id for a segment nothing else will ever use. Random, not the position and
 * not the clock: two devices adding a segment while apart must not mint the same
 * id, because the record merge would then take the two of them for edits of one
 * (platform/sync/merge/records.ts).
 */
export function newSegmentId(): string {
  return crypto.randomUUID();
}

// What a writer hands in. Everything is optional: an edit that names a title and
// nothing else leaves the cues where they were, which is what lets the AI fix one
// line of a segment without restating the rest of it.
export interface SegmentEdit {
  // The segment to change. Absent, or naming one that is not there, adds a new
  // one.
  id?: string;
  act?: string | null;
  title?: string;
  cues?: readonly string[];
  material?: readonly TalkSegment["material"][number][];
  callback?: string | null;
  status?: TalkSegment["status"];
  // Where a new segment goes, 0-based. Absent, or past the end, appends. Ignored
  // for a segment that is already there — moving one is moveSegment's job, so an
  // edit of the words cannot silently reorder the talk.
  at?: number;
}

function applyEdit(base: TalkSegment, edit: SegmentEdit, now: number): TalkSegment {
  const next: TalkSegment = { ...base, updatedAt: now };
  if (edit.title !== undefined) next.title = edit.title;
  if (edit.cues !== undefined) next.cues = [...edit.cues];
  if (edit.material !== undefined) next.material = [...edit.material];
  if (edit.status !== undefined) next.status = edit.status;
  if (edit.act !== undefined) {
    if (edit.act === null || !edit.act.trim()) delete next.act;
    else next.act = edit.act;
  }
  if (edit.callback !== undefined) {
    if (edit.callback === null || !edit.callback) delete next.callback;
    else next.callback = edit.callback;
  }
  // Through the same repair a load goes through, so a segment written by the AI
  // cannot reach disk in a shape a reload would drop.
  return normalizeSegment(next) ?? base;
}

/**
 * Write one segment: the one `edit.id` names, or a new one at `edit.at`.
 * `mintId` is a seam for tests; nothing else passes it.
 */
export function putSegment(
  outline: TalkOutline,
  edit: SegmentEdit,
  now: number,
  mintId: () => string = newSegmentId,
): TalkOutline {
  const index = edit.id ? outline.segments.findIndex((s) => s.id === edit.id) : -1;
  if (index >= 0) {
    const next = applyEdit(outline.segments[index], edit, now);
    if (sameSegment(next, outline.segments[index])) return outline;
    const segments = [...outline.segments];
    segments[index] = next;
    return { ...outline, segments, updatedAt: now };
  }
  const blank: TalkSegment = {
    id: edit.id && !outline.segments.some((s) => s.id === edit.id) ? edit.id : mintId(),
    title: "",
    cues: [],
    material: [],
    status: DEFAULT_SEGMENT_STATUS,
    updatedAt: now,
  };
  const segments = [...outline.segments];
  const at = edit.at === undefined ? segments.length : clamp(edit.at, segments.length);
  segments.splice(at, 0, applyEdit(blank, edit, now));
  return { ...outline, segments, updatedAt: now };
}

/** Drop a segment. The outline itself when there is no such segment. */
export function removeSegment(outline: TalkOutline, id: string, now: number): TalkOutline {
  const segments = outline.segments.filter((s) => s.id !== id);
  if (segments.length === outline.segments.length) return outline;
  return { ...outline, segments, updatedAt: now };
}

/**
 * Move a segment to a position, 0-based, in the list as it will read afterwards.
 * Past the end is the end. The outline itself when it does not move.
 */
export function moveSegment(
  outline: TalkOutline,
  id: string,
  to: number,
  now: number,
): TalkOutline {
  const from = outline.segments.findIndex((s) => s.id === id);
  if (from < 0) return outline;
  const target = clamp(to, outline.segments.length - 1);
  if (target === from) return outline;
  const segments = [...outline.segments];
  const [moved] = segments.splice(from, 1);
  segments.splice(target, 0, moved);
  return { ...outline, segments, updatedAt: now };
}

/**
 * Change part of the spine. A key left out is left alone; an array handed in
 * replaces the one that was there, because the ribs are an order and not a set.
 */
export function setSpine(
  outline: TalkOutline,
  patch: Partial<TalkSpine>,
  now: number,
): TalkOutline {
  const spine = normalizeSpine({ ...outline.spine, ...patch });
  if (sameSpine(spine, outline.spine)) return outline;
  return { ...outline, spine, updatedAt: now };
}

/** Rename the talk. The outline itself when the name is blank or unchanged. */
export function renameTalkOutline(outline: TalkOutline, name: string, now: number): TalkOutline {
  const trimmed = name.trim();
  if (!trimmed || trimmed === outline.name) return outline;
  return { ...outline, name: trimmed, updatedAt: now };
}

function clamp(n: number, max: number): number {
  if (!Number.isFinite(n)) return max;
  return Math.max(0, Math.min(Math.trunc(n), max));
}

// Everything but the timestamp: an edit that changes nothing must not bump
// updatedAt, or a device would re-upload the file for having looked at it.
function sameSegment(a: TalkSegment, b: TalkSegment): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}

function sameSpine(a: TalkSpine, b: TalkSpine): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
