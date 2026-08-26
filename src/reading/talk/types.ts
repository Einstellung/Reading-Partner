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
// Not a deck, and not a form either. What this holds is the note the reader
// talks from, and the end state of a talk may be no slides at all — just the
// note. So a segment is a block of markdown rather than a record of a title,
// hooks and typed material: what belongs in a block, and in what proportion, is
// settled by giving the talk and rewriting what did not come out, and a schema
// can only stand in the way of that.

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

// One block of the note. Markdown, because a formula and a figure have to sit in
// among the words rather than beside them — in a technical talk the formula is
// the thing being pointed at — and because a block that has been talked through
// twice stops looking like whatever shape it started in.
export interface TalkSegment {
  // Minted per segment and never reused. Random rather than positional: two
  // devices adding a segment in the same place must not mint the same id, or the
  // record merge would fuse two different segments into one
  // (platform/sync/merge/records.ts).
  id: string;
  // The block, as markdown. Never empty — a block with nothing in it is not a
  // block, and normalizeSegment drops one.
  body: string;
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

/**
 * One formula as markdown the app's renderer will set as display maths.
 *
 * The fences go on their own lines because that is the only shape remark reads
 * as a block (docs/pitfall — see ui/components/markdown/mathFences.ts): a `$$`
 * with anything after it on the same line opens a block that loses its first
 * line and never closes. A formula that already carries its own fences is
 * unwrapped first rather than fenced twice, since the same formula is written by
 * hand and by the AI and both write it both ways.
 */
export function displayMath(tex: string): string {
  let body = tex.trim();
  while (body.startsWith("$$")) body = body.slice(2).trim();
  while (body.endsWith("$$")) body = body.slice(0, -2).trim();
  return `$$\n${body}\n$$`;
}

// What a segment used to be: a title, hooks, and material as a typed list. Read
// on the way in and never written again — see foldLegacy.
interface LegacySegment {
  title?: unknown;
  cues?: unknown;
  material?: unknown;
}

// The old shape as one block of markdown, in the order the panel used to draw
// the fields in: the title as a heading, each hook as its own paragraph, then
// the material whole. `act`, `status` and `callback` go — an act is a heading
// the reader writes if they want one, a status is what giving the talk tells
// them, and a callback was an id nobody could read.
function foldLegacy(s: LegacySegment): string {
  const blocks: string[] = [];
  const title = typeof s.title === "string" ? s.title.trim() : "";
  if (title) blocks.push(`## ${title}`);
  for (const cue of strings(s.cues)) blocks.push(cue.trim());
  for (const raw of Array.isArray(s.material) ? s.material : []) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { kind?: unknown; tex?: unknown; figId?: unknown; description?: unknown };
    if (m.kind === "tex") {
      if (typeof m.tex === "string" && m.tex.trim()) blocks.push(displayMath(m.tex));
      continue;
    }
    if (m.kind !== "figure") continue;
    const figId = typeof m.figId === "string" ? m.figId.trim() : "";
    const description = typeof m.description === "string" ? m.description.trim() : "";
    // The citation the markdown renderer already draws a figure card for
    // (ui/components/markdown/FigureCard.tsx), so a figure the retell had
    // identified keeps its picture. One that was only ever words stays words.
    if (figId) blocks.push([`[fig:${figId}]`, description].filter(Boolean).join(" "));
    else if (description) blocks.push(description);
  }
  return blocks.join("\n\n");
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
//
// It is also where a talk arranged under the old shape becomes a note. The fold
// runs on every read and is never written back, so it has to land on the same
// bytes every time — which is what lets the file stay at version 1 and stay
// readable to a device that has not been updated.
export function normalizeSegment(raw: unknown, seen?: Set<string>): TalkSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<TalkSegment> & LegacySegment;
  if (typeof s.id !== "string" || !s.id) return null;
  if (seen?.has(s.id)) return null;
  const body = (typeof s.body === "string" ? s.body.trim() : "") || foldLegacy(s);
  if (!body) return null;
  seen?.add(s.id);
  return {
    id: s.id,
    body,
    updatedAt: Number.isFinite(s.updatedAt) ? (s.updatedAt as number) : 0,
  };
}

// How wide a run of text is, in columns. An ideograph, a kana and a hangul
// syllable are drawn about twice as wide as a Latin letter at the same size, so
// counting characters would cut a Chinese label at half the width it reads as.
// Same character ranges the word count uses (reading/rehearsal/summary.ts),
// written as code points rather than pasted as glyphs (docs/pitfall/170).
const WIDE_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7a3]/gu;

function columns(text: string): number {
  const wide = text.match(WIDE_CHAR)?.length ?? 0;
  return [...text].length + wide;
}

// What a first line carries as markdown and does not carry as a name.
const LEADING_MARKERS = /^[\s#>-]+/;

// About as much as a row in a list holds before it has to be cut.
const LABEL_COLUMNS = 60;

function truncate(text: string, max: number): string {
  if (columns(text) <= max) return text;
  let out = "";
  let width = 0;
  for (const ch of text) {
    const next = width + columns(ch);
    if (next > max) break;
    out += ch;
    width = next;
  }
  return `${out.trimEnd()}…`;
}

/**
 * The block's one-line name: what a list, a receipt and the pass handoff call
 * it. Read off the block rather than stored beside it — a note has no title
 * field, and the line the reader wrote first is the line they will recognise.
 *
 * Here rather than beside the panel that draws the list, because
 * reading/rehearsal/handoff.ts needs it too and a domain file cannot import ui.
 */
export function segmentLabel(segment: TalkSegment): string {
  for (const line of segment.body.split("\n")) {
    const text = line.replace(LEADING_MARKERS, "").trim();
    if (text) return truncate(text, LABEL_COLUMNS);
  }
  return "Untitled segment";
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
