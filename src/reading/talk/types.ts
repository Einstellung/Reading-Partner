// The outline of a talk (docs/44): what the reader is going to say, in the order
// they are going to say it. Produced by a retell — the last exchange of one turns
// the chapter decisions into an arrangement — and given by a rehearsal, which is
// why it is neither of their files but a level of its own. Nothing here imports
// reading/retell or reading/rehearsal, and neither of them may be imported from
// here: the outline is the thing they share, so it has to sit under both.
//
// Two layers, and the split is the point. The spine is one per talk and holds
// for the whole of it. The segments are ordered and decoupled from the chapters
// the retell settled: an opening belongs to no chapter, one chapter can break
// into six segments, two chapters can fuse into one. So a segment carries no
// chapter number — the retell's decisions are the material, not the structure.
//
// Not a deck. The slides are made outside the app (docs/44) and the app never
// sees that file; what it holds is the thing the reader rehearses against.

export const TALK_OUTLINE_VERSION = 1 as const;

// The whole talk, in one place: the line it argues, the ribs under that line,
// who it is for, what holds everywhere in it, and what it deliberately leaves
// out. `audience` is not decoration — it is the measure the coaching AI holds a
// pass against (docs/44), the thing that answers "would this person have kept
// up".
export interface TalkSpine {
  // The through-line, one sentence.
  thesis: string;
  // The ribs the talk hangs on, in order.
  backbone: string[];
  // Who is listening.
  audience: string;
  // What holds for every segment, e.g. "no English acronyms".
  conventions: string[];
  // What the talk deliberately does not go into.
  excluded: string[];
}

export function emptySpine(): TalkSpine {
  return { thesis: "", backbone: [], audience: "", conventions: [], excluded: [] };
}

// Where a segment stands, per segment and not per pass (docs/44). Taken from the
// page list the reader already keeps by hand.
//   ready        can be given now
//   shallow      the words are right and are not yet the reader's own, so the
//                delivery will stall
//   no-material  the figure or the number does not exist yet, and what is
//                written is the expectation rather than the result
export type SegmentStatus = "ready" | "shallow" | "no-material";

const STATUSES: readonly string[] = ["ready", "shallow", "no-material"];

// A freshly written segment is shallow, not ready: something has been drafted
// and nobody has yet said it out loud.
export const DEFAULT_SEGMENT_STATUS: SegmentStatus = "shallow";

// What the reader points at while talking. Kept whole and never abridged — in a
// technical talk the formula on the screen is the thing being explained
// (docs/44). A figure is either one the retell already identified ([fig:N],
// carried in `figId`) or one described in words.
export type TalkMaterial =
  | { kind: "figure"; figId?: string; description: string }
  | { kind: "tex"; tex: string };

// One segment: one screenful, which is also the limit (docs/44 — a segment that
// does not fit is a segment that wants splitting). Fewer words than a slide
// would carry: the audience reads whole sentences, the speaker needs only enough
// to pull the sentence out.
export interface TalkSegment {
  // Minted per segment and never reused. Random rather than positional: two
  // devices adding a segment in the same place must not mint the same id, or the
  // record merge would fuse two different segments into one
  // (platform/sync/merge/records.ts).
  id: string;
  // The act this belongs to, when the talk has acts. Free text, not an index —
  // acts get renamed and merged while the segments under them stay put.
  act?: string;
  title: string;
  // The hooks. How many, and how long, is deliberately not fixed: it is the kind
  // of thing only giving the talk settles (docs/44).
  cues: string[];
  // Figures and formulas, verbatim.
  material: TalkMaterial[];
  // The id of an earlier segment this one pays back.
  callback?: string;
  status: SegmentStatus;
  updatedAt: number;
}

export interface TalkOutline {
  version: typeof TALK_OUTLINE_VERSION;
  id: string;
  topicId: string;
  // The retell this came out of, or null for an outline started on its own. Not
  // the other way round: a retell does not point at its outline, because
  // reading/retell must not have to know this directory exists.
  retellId: string | null;
  // What the topic's list calls it. On the outline rather than on the rehearsal
  // that gives it: the talk is the thing being named, and a second rehearsal of
  // the same talk must not be a second name for it.
  name: string;
  spine: TalkSpine;
  // The order of this array is the order of the talk. Nothing else says it.
  segments: TalkSegment[];
  createdAt: number;
  updatedAt: number;
}

// The creation moment, the shape a retell id and a rehearsal id already have, so
// nothing here has to be taught a second kind of id.
export function newTalkOutlineId(now: number): string {
  return `${now}`;
}

export interface NewTalkOutlineFields {
  id: string;
  topicId: string;
  retellId?: string | null;
  name?: string;
  spine?: TalkSpine;
  now: number;
}

export function newTalkOutline(fields: NewTalkOutlineFields): TalkOutline {
  return {
    version: TALK_OUTLINE_VERSION,
    id: fields.id,
    topicId: fields.topicId,
    retellId: fields.retellId ?? null,
    name: (fields.name ?? "").trim() || "Untitled talk",
    spine: fields.spine ? normalizeSpine(fields.spine) : emptySpine(),
    segments: [],
    createdAt: fields.now,
    updatedAt: fields.now,
  };
}

function strings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const s of raw) if (typeof s === "string" && s.trim()) out.push(s);
  return out;
}

export function normalizeSpine(raw: unknown): TalkSpine {
  const s = (raw ?? {}) as Partial<TalkSpine>;
  return {
    thesis: typeof s.thesis === "string" ? s.thesis : "",
    backbone: strings(s.backbone),
    audience: typeof s.audience === "string" ? s.audience : "",
    conventions: strings(s.conventions),
    excluded: strings(s.excluded),
  };
}

function normalizeMaterial(raw: unknown): TalkMaterial | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { kind?: unknown; tex?: unknown; figId?: unknown; description?: unknown };
  if (m.kind === "tex") {
    return typeof m.tex === "string" && m.tex ? { kind: "tex", tex: m.tex } : null;
  }
  if (m.kind === "figure") {
    const figId = typeof m.figId === "string" && m.figId ? m.figId : undefined;
    const description = typeof m.description === "string" ? m.description : "";
    if (!figId && !description) return null;
    return figId ? { kind: "figure", figId, description } : { kind: "figure", description };
  }
  return null;
}

// A segment odd enough to be unusable is dropped rather than read as null for
// the whole outline: the posture normalizeRetell holds, and for the same reason
// — one lost segment is written again in a sentence, an unopenable outline is
// the whole talk.
//
// A missing or repeated id is what makes a segment unusable, and not because a
// path is built from it (none is). It is the identity the record merge keys on:
// a file the merge cannot read that way falls through to opaque, where one
// device's segments silently replace the other's (platform/sync/merge/index.ts).
export function normalizeSegment(raw: unknown, seen?: Set<string>): TalkSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<TalkSegment>;
  if (typeof s.id !== "string" || !s.id) return null;
  if (seen?.has(s.id)) return null;
  seen?.add(s.id);
  const material: TalkMaterial[] = [];
  for (const m of Array.isArray(s.material) ? s.material : []) {
    const one = normalizeMaterial(m);
    if (one) material.push(one);
  }
  const segment: TalkSegment = {
    id: s.id,
    title: typeof s.title === "string" ? s.title : "",
    cues: strings(s.cues),
    material,
    status:
      typeof s.status === "string" && STATUSES.includes(s.status)
        ? (s.status as SegmentStatus)
        : DEFAULT_SEGMENT_STATUS,
    updatedAt: Number.isFinite(s.updatedAt) ? (s.updatedAt as number) : 0,
  };
  if (typeof s.act === "string" && s.act.trim()) segment.act = s.act;
  if (typeof s.callback === "string" && s.callback) segment.callback = s.callback;
  return segment;
}

// A load-time repair. A file this build cannot use at all reads as null and the
// store quarantines it; anything merely odd inside a usable file is dropped.
export function normalizeTalkOutline(raw: unknown): TalkOutline | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as TalkOutline;
  if (o.version !== TALK_OUTLINE_VERSION) return null;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.topicId !== "string" || !o.topicId) return null;
  if (!Number.isFinite(o.createdAt)) return null;
  const segments: TalkSegment[] = [];
  const seen = new Set<string>();
  for (const one of Array.isArray(o.segments) ? o.segments : []) {
    const segment = normalizeSegment(one, seen);
    if (segment) segments.push(segment);
  }
  return {
    version: TALK_OUTLINE_VERSION,
    id: o.id,
    topicId: o.topicId,
    retellId: typeof o.retellId === "string" && o.retellId ? o.retellId : null,
    name: typeof o.name === "string" && o.name.trim() ? o.name : "Untitled talk",
    spine: normalizeSpine(o.spine),
    segments,
    createdAt: o.createdAt,
    updatedAt: Number.isFinite(o.updatedAt) ? o.updatedAt : o.createdAt,
  };
}
