// How an AI writes to a talk outline (docs/44): five tools over edit.ts, and
// the readback the prompt inlines.
//
// They sit here because there are two conversations that write a talk and
// neither owns the other. The retell arranges one at its last stretch, turning
// the chapter decisions into segments; the coach edits the same outline after a
// pass has been given against it (reading/rehearsal/coach.ts), because what
// comes out of a rehearsal is a change to the talk rather than a review of it.
// Each of those two owns its own stretch of prompt — ARRANGE_INSTRUCTIONS in
// reading/retell/prompt.ts, COACH_INSTRUCTIONS in reading/rehearsal/coach.ts —
// and shares the writing.
//
// Same posture as record_chapter_decision (reading/retell/tools.ts): the write
// does not ask, because a confirm gate on every segment would make the
// arrangement a form; but each write is bounded to one segment or one spine, and
// the card says exactly what landed. What must be discussed first is the change
// itself, and that is the prompt's job, not a gate here.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import { moveSegment, putSegment, removeSegment, setSpine, type SegmentEdit } from "./edit";
import type { TalkArrangementCardData } from "./cards";
import { segmentLabel, type TalkOutline, type TalkSegment, type TalkSpine } from "./types";

function strings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

// The place in the talk, as the model and the card both count it: 1-based, the
// way the reader would say "segment three". edit.ts counts from 0.
function toIndex(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.round(n) - 1);
}

/** The card a segment write raises: the block as it now stands, and its place. */
export function segmentCard(outline: TalkOutline, id: string): TalkArrangementCardData | null {
  const at = outline.segments.findIndex((s) => s.id === id);
  if (at < 0) return null;
  return {
    kind: "talk-arrangement",
    change: "segment",
    body: outline.segments[at].body,
    position: at + 1,
    total: outline.segments.length,
  };
}

/**
 * The whole note read back: what read_talk_outline answers and what the prompt
 * inlines during the arrangement. Every block whole, headed by its place and its
 * id — the place is how the reader and the model talk about a block, the id is
 * the only handle for rewriting, moving or dropping one.
 */
export function formatTalkOutline(outline: TalkOutline | null): string {
  if (!outline || (!outline.spine.thesis && outline.segments.length === 0)) {
    return "The talk: nothing arranged yet. It starts with the spine — the through-line in one sentence and who is listening — and then the note.";
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
    lines.push("", "No blocks yet.");
    return lines.join("\n");
  }
  lines.push("", `The note — ${outline.segments.length} block(s), in the order they are given:`);
  for (const [i, seg] of outline.segments.entries()) {
    lines.push("", `--- ${i + 1} (id: ${seg.id}) ---`, seg.body);
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
        "Write one block of the note — one stretch of the talk, as the reader will see " +
        "it while saying it. Omit `id` to add a block, give it to rewrite one; a " +
        "rewrite replaces the block whole, so send all of it. A block is not a " +
        "chapter: an opening and a closing belong to none, one chapter can break into " +
        "several, several can fuse into one. Call it after the reader has agreed to " +
        "that block, one call per block.",
      parameters: Type.Object({
        id: Type.Optional(
          Type.String({
            description:
              "The block to rewrite, as read_talk_outline prints it. Omit to add a new one.",
          }),
        ),
        body: Type.String({
          description:
            "The block, as markdown. Fragments and hooks the speaker glances at, not " +
            "sentences for an audience to read. A heading names it if it wants naming. " +
            "Formulas go in whole, as $$...$$; a figure the retell identified goes in " +
            "as [fig:3] followed by what it shows.",
        }),
        position: Type.Optional(
          Type.Number({
            description:
              "Where a new block goes, counting from 1. Omit to put it at the end. " +
              "Ignored for a block that already exists — move_talk_segment does that.",
          }),
        ),
      }),
      execute: async (args) => {
        const edit: SegmentEdit = {};
        if (typeof args.id === "string" && args.id.trim()) edit.id = args.id.trim();
        if (typeof args.body === "string") edit.body = args.body.trim();
        const at = toIndex(args.position);
        if (at !== undefined) edit.at = at;

        if (!edit.body) {
          return "No block was given, so nothing was written. `body` is the block itself.";
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
        return `${known ? "Rewrote" : "Added"} block ${place} of ${next.segments.length} (id: ${seg.id}). The reader can see the entry.`;
      },
    },
    {
      name: "move_talk_segment",
      description:
        "Move a block to another place in the note. The order of the blocks is the " +
        "order the talk is given in; nothing else says it.",
      parameters: Type.Object({
        id: Type.String({ description: "The block to move." }),
        position: Type.Number({
          description: "Where it should sit afterwards, counting from 1.",
        }),
      }),
      execute: async (args) => {
        const id = String(args.id ?? "").trim();
        const to = toIndex(args.position);
        if (!id || to === undefined) return "A block id and a position are both needed.";
        let title = "";
        const next = await deps.editOutline((o) => {
          const seg = o.segments.find((s) => s.id === id);
          title = seg ? segmentLabel(seg) : "";
          return moveSegment(o, id, to, now());
        });
        if (!next) return NO_OUTLINE;
        const place = next.segments.findIndex((s) => s.id === id) + 1;
        if (place === 0) return `There is no block ${id} in the talk. Read it back first.`;
        deps.onCard?.({
          kind: "talk-arrangement",
          change: "moved",
          title,
          position: place,
          total: next.segments.length,
        });
        return `"${title}" is now block ${place} of ${next.segments.length}. The reader can see the entry.`;
      },
    },
    {
      name: "remove_talk_segment",
      description:
        "Drop a block from the note. For a block the reader has decided against — " +
        "rewriting one is write_talk_segment with its id.",
      parameters: Type.Object({
        id: Type.String({ description: "The block to drop." }),
      }),
      execute: async (args) => {
        const id = String(args.id ?? "").trim();
        if (!id) return "A block id is needed.";
        let dropped: TalkSegment | undefined;
        const next = await deps.editOutline((o) => {
          dropped = o.segments.find((s) => s.id === id);
          return removeSegment(o, id, now());
        });
        if (!next) return NO_OUTLINE;
        if (!dropped) return `There is no block ${id} in the talk. Read it back first.`;
        const title = segmentLabel(dropped);
        deps.onCard?.({
          kind: "talk-arrangement",
          change: "removed",
          title,
          total: next.segments.length,
        });
        return `Dropped "${title}". The note now has ${next.segments.length} block(s). The reader can see the entry.`;
      },
    },
    {
      name: "read_talk_outline",
      description:
        "Read the talk back as it now stands: the spine, and every block of the note " +
        "in order, whole, with its id. Read-only. Use it before moving or rewriting a " +
        "block, and when the reader asks what the talk looks like now.",
      parameters: Type.Object({}),
      execute: async () => formatTalkOutline(await deps.readOutline()),
    },
  ];
}
