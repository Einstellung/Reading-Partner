// The last stretch of a retell: turning the chapter decisions into a talk
// (docs/44). The retell settled what each chapter contributes; a talk is given
// in segments, and segments are not chapters — an opening belongs to none, one
// chapter can break into six, two can fuse into one. The arrangement is the
// conversation that crosses that gap, and these are the tools it writes with.
//
// They sit here rather than in reading/talk because arranging is something the
// retell does. reading/talk owns the object and the edits; this file owns the
// stage of the conversation that applies them, which is why the edit functions
// come from there and only the tool wrapping is new.
//
// Same posture as record_chapter_decision (tools.ts): the write does not ask,
// because a confirm gate on every segment would make the arrangement a form; but
// each write is bounded to one segment or one spine, and the card says exactly
// what landed. What must be discussed first is the arrangement itself, and that
// is the prompt's job (ARRANGE_INSTRUCTIONS in prompt.ts), not a gate here.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import {
  moveSegment,
  putSegment,
  removeSegment,
  setSpine,
  type SegmentEdit,
  type SegmentStatus,
  type TalkMaterial,
  type TalkOutline,
  type TalkSegment,
  type TalkSpine,
} from "../talk";
import type { TalkArrangementCardData } from "./cards";
import { nextChapter } from "./plan";
import type { RetellChapter, RetellPlan } from "./types";

// The signal that the retell is over and the arrangement begins: every chapter
// has a decision (docs/44 — the arrangement is the last exchange of the retell,
// not a fourth feature). A skeleton with no chapters is not "all settled", it is
// a retell that has not started.
export function isArranging(
  chapters: readonly RetellChapter[],
  plan: RetellPlan | null,
): boolean {
  return chapters.length > 0 && nextChapter(chapters, plan) === null;
}

const STATUS_LABEL: Record<SegmentStatus, string> = {
  ready: "Ready",
  shallow: "Needs depth",
  "no-material": "No material",
};

/** How a segment's status reads to the reader. */
export function segmentStatusLabel(status: SegmentStatus): string {
  return STATUS_LABEL[status] ?? status;
}

/** One piece of material as one line: the figure it points at, or the formula. */
export function materialLabel(material: TalkMaterial): string {
  if (material.kind === "tex") return material.tex;
  const id = material.figId ? `[fig:${material.figId}]` : "";
  return [id, material.description].filter(Boolean).join(" ") || "(a figure)";
}

// A figure reference the way the retell already writes one: `[fig:3]`, words, or
// the tag followed by words. Same spelling as record_chapter_decision's `figure`
// and as the catalog in the prompt, so the model has one form to remember.
const FIG_TAG = /^\s*\[fig:([^\]\s]+)\]\s*(.*)$/i;

export function toTalkMaterial(kind: unknown, ref: unknown): TalkMaterial | null {
  const text = typeof ref === "string" ? ref.trim() : "";
  if (!text) return null;
  if (String(kind).toLowerCase() === "tex") return { kind: "tex", tex: text };
  const tagged = FIG_TAG.exec(text);
  if (!tagged) return { kind: "figure", description: text };
  return { kind: "figure", figId: tagged[1].toLowerCase(), description: tagged[2].trim() };
}

function materialList(raw: unknown): TalkMaterial[] {
  if (!Array.isArray(raw)) return [];
  const out: TalkMaterial[] = [];
  for (const one of raw) {
    if (!one || typeof one !== "object") continue;
    const m = one as { kind?: unknown; ref?: unknown };
    const material = toTalkMaterial(m.kind, m.ref);
    if (material) out.push(material);
  }
  return out;
}

function strings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

function toStatus(raw: unknown): SegmentStatus | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "ready" || s === "shallow" || s === "no-material") return s;
  return undefined;
}

// The place in the talk, as the model and the card both count it: 1-based, the
// way the reader would say "segment three". edit.ts counts from 0.
function toIndex(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.round(n) - 1);
}

/** The card a segment write raises: the segment as it now stands, and its place. */
export function segmentCard(outline: TalkOutline, id: string): TalkArrangementCardData | null {
  const at = outline.segments.findIndex((s) => s.id === id);
  if (at < 0) return null;
  const { updatedAt, ...segment } = outline.segments[at];
  void updatedAt;
  // The callback is an id, and an id on a card is nothing the reader can read.
  // Resolved here, where the rest of the talk is still in hand.
  const callback = segment.callback
    ? outline.segments.find((s) => s.id === segment.callback)?.title
    : undefined;
  return {
    kind: "talk-arrangement",
    change: "segment",
    segment,
    ...(callback ? { callbackTitle: callback } : {}),
    position: at + 1,
    total: outline.segments.length,
  };
}

/**
 * The whole outline read back: what read_talk_outline answers and what the
 * prompt inlines during the arrangement. Segment ids are printed because they
 * are the only handle the model has for rewriting, moving or dropping one.
 */
export function formatTalkOutline(outline: TalkOutline | null): string {
  if (!outline || (!outline.spine.thesis && outline.segments.length === 0)) {
    return "The talk: nothing arranged yet. It starts with the spine — the through-line in one sentence and who is listening — and then the segments.";
  }
  const lines = ["The talk as it stands."];
  const s = outline.spine;
  lines.push("", `Through-line: ${s.thesis || "(not settled)"}`);
  lines.push(`Audience: ${s.audience || "(not settled)"}`);
  if (s.backbone.length) {
    lines.push("Backbone:");
    for (const rib of s.backbone) lines.push(`  - ${rib}`);
  }
  if (s.conventions.length) lines.push(`Holds throughout: ${s.conventions.join("; ")}`);
  if (s.excluded.length) lines.push(`Not going into: ${s.excluded.join("; ")}`);

  if (outline.segments.length === 0) {
    lines.push("", "No segments yet.");
    return lines.join("\n");
  }
  const titleOf = new Map(outline.segments.map((seg) => [seg.id, seg.title]));
  lines.push("", `Segments — ${outline.segments.length}, in the order they are given:`);
  for (const [i, seg] of outline.segments.entries()) {
    const act = seg.act ? `[${seg.act}] ` : "";
    lines.push("", `${i + 1}. ${act}${seg.title || "(untitled)"} — ${segmentStatusLabel(seg.status)} (id: ${seg.id})`);
    for (const cue of seg.cues) lines.push(`  - ${cue}`);
    for (const m of seg.material) lines.push(`  ${m.kind === "tex" ? "formula" : "figure"}: ${materialLabel(m)}`);
    if (seg.callback) {
      lines.push(`  pays back: ${titleOf.get(seg.callback) ?? "a segment that is no longer there"}`);
    }
  }
  return lines.join("\n");
}

export interface ArrangeToolDeps {
  // The outline as it stands, or null when nothing has been arranged yet.
  readOutline(): Promise<TalkOutline | null>;
  // Apply one change and answer the outline as it now stands. Makes the outline
  // if this is the first write — an empty file created for every retell that
  // reaches the arrangement would be a talk nobody agreed to. Null when there is
  // no outline to write to.
  editOutline(change: (outline: TalkOutline) => TalkOutline): Promise<TalkOutline | null>;
  // Raise the card in the conversation. Absent in headless tests.
  onCard?(card: TalkArrangementCardData): void;
  now?(): number;
}

const NO_OUTLINE = "The talk outline could not be opened, so nothing was written. Tell the reader.";

export function buildArrangeTools(deps: ArrangeToolDeps): AgentTool[] {
  const now = deps.now ?? (() => Date.now());

  return [
    {
      name: "set_talk_spine",
      description:
        "Write the layer of the talk that holds for all of it: the through-line, the " +
        "ribs under it, who is listening, what holds in every segment, what the talk " +
        "leaves out. Only the fields you send are changed; an array you send replaces " +
        "the one that was there. Call it after the reader has agreed to the line, not " +
        "to think out loud.",
      parameters: Type.Object({
        thesis: Type.Optional(
          Type.String({ description: "The through-line, one sentence, in the reader's framing." }),
        ),
        backbone: Type.Optional(
          Type.Array(Type.String(), {
            description: "The ribs the talk hangs on, in order. One short line each.",
          }),
        ),
        audience: Type.Optional(
          Type.String({
            description:
              "Who is listening. Not decoration — it is the measure every segment is " +
              "held against.",
          }),
        ),
        conventions: Type.Optional(
          Type.Array(Type.String(), {
            description: 'What holds for every segment, e.g. "no English acronyms".',
          }),
        ),
        excluded: Type.Optional(
          Type.Array(Type.String(), {
            description: "What the talk deliberately does not go into.",
          }),
        ),
      }),
      execute: async (args) => {
        const patch: Partial<TalkSpine> = {};
        if (typeof args.thesis === "string") patch.thesis = args.thesis.trim();
        if (typeof args.audience === "string") patch.audience = args.audience.trim();
        if (Array.isArray(args.backbone)) patch.backbone = strings(args.backbone);
        if (Array.isArray(args.conventions)) patch.conventions = strings(args.conventions);
        if (Array.isArray(args.excluded)) patch.excluded = strings(args.excluded);
        if (Object.keys(patch).length === 0) {
          return "No field was given, so nothing was written. Send the ones you want to change.";
        }
        const next = await deps.editOutline((o) => setSpine(o, patch, now()));
        if (!next) return NO_OUTLINE;
        deps.onCard?.({ kind: "talk-arrangement", change: "spine", spine: next.spine });
        return `Written: ${Object.keys(patch).join(", ")}. The reader can see the entry.`;
      },
    },
    {
      name: "write_talk_segment",
      description:
        "Write one segment of the talk — one screenful, one thing said. Omit `id` to " +
        "add a segment, give it to rewrite one (only the fields you send change). " +
        "A segment is not a chapter: an opening and a closing belong to none, one " +
        "chapter can break into several, several can fuse into one. Call it after the " +
        "reader has agreed to that segment, one call per segment.",
      parameters: Type.Object({
        id: Type.Optional(
          Type.String({
            description:
              "The segment to rewrite, as read_talk_outline prints it. Omit to add a new one.",
          }),
        ),
        title: Type.Optional(Type.String({ description: "What this segment is, a few words." })),
        act: Type.Optional(
          Type.String({
            description:
              "The act this belongs to, when the talk has acts. Free text, and the same " +
              "text for every segment of one act.",
          }),
        ),
        cues: Type.Optional(
          Type.Array(Type.String(), {
            description:
              "The hooks the speaker pulls the sentence out of — fewer words than a " +
              "slide would carry, not the sentences themselves. A handful is enough.",
          }),
        ),
        material: Type.Optional(
          Type.Array(
            Type.Object({
              kind: Type.String({ description: 'Either "figure" or "tex".' }),
              ref: Type.String({
                description:
                  'For a figure: "[fig:3]", or a description in words when the book has ' +
                  "no such figure. For tex: the formula, verbatim and unabridged — it is " +
                  "the thing the speaker points at.",
              }),
            }),
            { description: "The figures and formulas on this segment, in the order shown." },
          ),
        ),
        callback: Type.Optional(
          Type.String({ description: "The id of an earlier segment this one pays back." }),
        ),
        status: Type.Optional(
          Type.String({
            description:
              '"ready" (the reader can give it now), "shallow" (the words are right and ' +
              'not yet theirs) or "no-material" (the figure or the number does not exist ' +
              'yet). A segment you have just drafted is "shallow"; leave it out and that ' +
              "is what it gets.",
          }),
        ),
        position: Type.Optional(
          Type.Number({
            description:
              "Where a new segment goes, counting from 1. Omit to put it at the end. " +
              "Ignored for a segment that already exists — move_talk_segment does that.",
          }),
        ),
      }),
      execute: async (args) => {
        const edit: SegmentEdit = {};
        if (typeof args.id === "string" && args.id.trim()) edit.id = args.id.trim();
        if (typeof args.title === "string") edit.title = args.title.trim();
        if (typeof args.act === "string") edit.act = args.act.trim() || null;
        if (Array.isArray(args.cues)) edit.cues = strings(args.cues);
        if (Array.isArray(args.material)) edit.material = materialList(args.material);
        if (typeof args.callback === "string") edit.callback = args.callback.trim() || null;
        const status = toStatus(args.status);
        if (status) edit.status = status;
        const at = toIndex(args.position);
        if (at !== undefined) edit.at = at;

        if (Object.keys(edit).length === 0) {
          return "No field was given, so no segment was written. A segment needs at least a title.";
        }

        // What was written is read out of the outline that came back rather than
        // guessed: a new segment's id was minted inside putSegment, and it is the
        // handle the model needs for the next call.
        let known = false;
        let written: TalkSegment | undefined;
        const next = await deps.editOutline((o) => {
          const before = new Set(o.segments.map((s) => s.id));
          known = !!edit.id && before.has(edit.id);
          const after = putSegment(o, edit, now());
          written =
            after.segments.find((s) => !before.has(s.id)) ??
            after.segments.find((s) => s.id === edit.id);
          return after;
        });
        if (!next || !written) return NO_OUTLINE;
        const seg = written;
        const card = segmentCard(next, seg.id);
        if (card) deps.onCard?.(card);
        const place = next.segments.findIndex((s) => s.id === seg.id) + 1;
        return `${known ? "Rewrote" : "Added"} segment ${place} of ${next.segments.length} (id: ${seg.id}), status ${seg.status}. The reader can see the entry.`;
      },
    },
    {
      name: "move_talk_segment",
      description:
        "Move a segment to another place in the talk. The order of the segments is the " +
        "order the talk is given in; nothing else says it.",
      parameters: Type.Object({
        id: Type.String({ description: "The segment to move." }),
        position: Type.Number({
          description: "Where it should sit afterwards, counting from 1.",
        }),
      }),
      execute: async (args) => {
        const id = String(args.id ?? "").trim();
        const to = toIndex(args.position);
        if (!id || to === undefined) return "A segment id and a position are both needed.";
        let title = "";
        const next = await deps.editOutline((o) => {
          title = o.segments.find((s) => s.id === id)?.title ?? "";
          return moveSegment(o, id, to, now());
        });
        if (!next) return NO_OUTLINE;
        const place = next.segments.findIndex((s) => s.id === id) + 1;
        if (place === 0) return `There is no segment ${id} in the talk. Read it back first.`;
        deps.onCard?.({
          kind: "talk-arrangement",
          change: "moved",
          title,
          position: place,
          total: next.segments.length,
        });
        return `"${title}" is now segment ${place} of ${next.segments.length}. The reader can see the entry.`;
      },
    },
    {
      name: "remove_talk_segment",
      description:
        "Drop a segment from the talk. For a segment the reader has decided against — " +
        "rewriting one is write_talk_segment with its id.",
      parameters: Type.Object({
        id: Type.String({ description: "The segment to drop." }),
      }),
      execute: async (args) => {
        const id = String(args.id ?? "").trim();
        if (!id) return "A segment id is needed.";
        let dropped: TalkSegment | undefined;
        const next = await deps.editOutline((o) => {
          dropped = o.segments.find((s) => s.id === id);
          return removeSegment(o, id, now());
        });
        if (!next) return NO_OUTLINE;
        if (!dropped) return `There is no segment ${id} in the talk. Read it back first.`;
        deps.onCard?.({
          kind: "talk-arrangement",
          change: "removed",
          title: dropped.title,
          total: next.segments.length,
        });
        return `Dropped "${dropped.title}". The talk now has ${next.segments.length} segment(s). The reader can see the entry.`;
      },
    },
    {
      name: "read_talk_outline",
      description:
        "Read the talk back as it now stands: the spine, and every segment in order " +
        "with its id, its cues, its material and its status. Read-only. Use it before " +
        "moving or rewriting a segment, and when the reader asks what the talk looks " +
        "like now.",
      parameters: Type.Object({}),
      execute: async () => formatTalkOutline(await deps.readOutline()),
    },
  ];
}
