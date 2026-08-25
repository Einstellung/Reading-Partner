// The shape of a talk's outline on the way in (src/reading/talk/types.ts). What
// matters here is what a load refuses and what it merely drops: an outline this
// build cannot use reads as null and the store quarantines it, while one odd
// segment inside a usable outline costs that segment and nothing else.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  DEFAULT_SEGMENT_STATUS,
  newTalkOutline,
  normalizeSegment,
  normalizeTalkOutline,
  type TalkOutline,
} from "../../../src/reading/talk/types";

function anOutline(over: Partial<TalkOutline> = {}): unknown {
  return { ...newTalkOutline({ id: "1", topicId: "t", now: 1 }), ...over };
}

test("a new outline starts empty and belongs to nobody in particular", () => {
  const outline = newTalkOutline({ id: "1", topicId: "t", now: 5 });
  expect(outline.segments).toEqual([]);
  expect(outline.retellId).toBeNull();
  expect(outline.spine.thesis).toBe("");
  expect(outline.name).toBe("Untitled talk");
  expect(outline.createdAt).toBe(5);
});

test("an outline of another version is not one this build opens", () => {
  expect(normalizeTalkOutline(anOutline({ version: 2 as unknown as 1 }))).toBeNull();
  expect(normalizeTalkOutline({ ...(anOutline() as object), topicId: "" })).toBeNull();
  expect(normalizeTalkOutline(null)).toBeNull();
});

// A segment with no id, or with one another segment already has, is not a shape
// the record merge can key on — and a file it cannot key on falls through to
// opaque, where one device's segments replace the other's.
test("segments without a usable identity are dropped, and the rest come through", () => {
  const outline = normalizeTalkOutline(
    anOutline({
      segments: [
        { id: "a", title: "Opening", cues: ["start cold"], material: [], status: "ready", updatedAt: 2 },
        { id: "", title: "No id" },
        { id: "a", title: "The same id twice" },
        { id: "b", title: "The loop", cues: [], material: [], status: "shallow", updatedAt: 3 },
      ] as TalkOutline["segments"],
    }),
  );
  expect(outline?.segments.map((s) => s.id)).toEqual(["a", "b"]);
  expect(outline?.segments[0].title).toBe("Opening");
});

test("a segment keeps its material and loses only what it cannot read", () => {
  const segment = normalizeSegment({
    id: "a",
    title: "The loss",
    cues: ["point at the sum", ""],
    material: [
      { kind: "tex", tex: "\\mathcal{L} = -\\sum_i \\log p(x_i)" },
      { kind: "figure", figId: "fig:3", description: "the training curve" },
      { kind: "figure" },
      { kind: "photo" },
    ],
    status: "no-material",
    updatedAt: 7,
  });
  expect(segment?.material).toEqual([
    { kind: "tex", tex: "\\mathcal{L} = -\\sum_i \\log p(x_i)" },
    { kind: "figure", figId: "fig:3", description: "the training curve" },
  ]);
  expect(segment?.cues).toEqual(["point at the sum"]);
  expect(segment?.status).toBe("no-material");
});

test("a status this build does not know reads as the honest one", () => {
  expect(normalizeSegment({ id: "a", status: "brilliant" })?.status).toBe(DEFAULT_SEGMENT_STATUS);
  expect(DEFAULT_SEGMENT_STATUS).toBe("shallow");
});

test("the spine survives a file that half of it is missing from", () => {
  const outline = normalizeTalkOutline(
    anOutline({
      spine: { thesis: "Intelligence is a body problem", backbone: ["x", ""] } as never,
    }),
  );
  expect(outline?.spine.thesis).toBe("Intelligence is a body problem");
  expect(outline?.spine.backbone).toEqual(["x"]);
  expect(outline?.spine.audience).toBe("");
  expect(outline?.spine.excluded).toEqual([]);
});
