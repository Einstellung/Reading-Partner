// The shape of a talk's outline on the way in (src/reading/talk/types.ts). What
// matters here is what a load refuses and what it merely drops: an outline this
// build cannot use reads as null and the store quarantines it, while one odd
// segment inside a usable outline costs that segment and nothing else. Plus the
// fold, which is where a talk arranged as a deck of fielded cards becomes the
// note it is now.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  displayMath,
  newTalkOutline,
  normalizeSegment,
  normalizeTalkOutline,
  segmentLabel,
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
        { id: "a", body: "Opening", updatedAt: 2 },
        { id: "", body: "No id" },
        { id: "a", body: "The same id twice" },
        { id: "b", body: "The loop", updatedAt: 3 },
      ] as TalkOutline["segments"],
    }),
  );
  expect(outline?.segments.map((s) => s.id)).toEqual(["a", "b"]);
  expect(outline?.segments[0].body).toBe("Opening");
});

test("a block with nothing in it is not a block", () => {
  expect(normalizeSegment({ id: "a", body: "   " })).toBeNull();
  expect(normalizeSegment({ id: "a" })).toBeNull();
  expect(normalizeSegment({ id: "a", body: " ## Kept\n" })?.body).toBe("## Kept");
});

// --- the fold ----------------------------------------------------------------

const LEGACY = {
  id: "a",
  act: "Act I",
  title: "The loss",
  cues: ["point at the sum", "", "then say why it is a sum"],
  material: [
    { kind: "tex", tex: "\\mathcal{L} = -\\sum_i \\log p(x_i)" },
    { kind: "figure", figId: "3", description: "the training curve" },
    { kind: "figure", description: "a curve the book does not have" },
    { kind: "figure" },
    { kind: "photo" },
  ],
  callback: "s-earlier",
  status: "no-material",
  updatedAt: 7,
};

test("a segment written as fields folds into one block of markdown", () => {
  const segment = normalizeSegment(LEGACY);
  expect(segment?.body).toBe(
    [
      "## The loss",
      "",
      "point at the sum",
      "",
      "then say why it is a sum",
      "",
      // The fences on their own lines, which is the only shape remark reads as
      // a block (mathFences.ts).
      "$$",
      "\\mathcal{L} = -\\sum_i \\log p(x_i)",
      "$$",
      "",
      // The citation the markdown renderer draws a figure card for, so a figure
      // the retell had identified keeps its picture.
      "[fig:3] the training curve",
      "",
      "a curve the book does not have",
    ].join("\n"),
  );
  expect(segment?.updatedAt).toBe(7);
});

// Nothing writes the fold back, so every read does it again. A fold that landed
// on different bytes the second time would make the file a different file each
// time it was opened, and the sync a fight between two devices reading it.
test("the fold lands on the same bytes every time it is read", () => {
  const once = normalizeSegment(LEGACY) as object;
  const twice = normalizeSegment(once);
  expect(twice).toEqual(normalizeSegment(LEGACY));
  expect(normalizeSegment(twice as object)).toEqual(twice);
});

test("a record that folds down to nothing is dropped", () => {
  expect(normalizeSegment({ id: "a", title: "  ", cues: [], material: [] })).toBeNull();
  expect(normalizeSegment({ id: "a", act: "Act I", status: "ready", callback: "b" })).toBeNull();
});

// --- the name ----------------------------------------------------------------

test("a block is named by the first line that says anything", () => {
  expect(segmentLabel({ id: "a", body: "## The loss\n\npoint at the sum", updatedAt: 0 })).toBe(
    "The loss",
  );
  expect(segmentLabel({ id: "a", body: "\n\n> quoted first\nthen this", updatedAt: 0 })).toBe(
    "quoted first",
  );
  expect(segmentLabel({ id: "a", body: "- a hook", updatedAt: 0 })).toBe("a hook");
  // A rule says nothing, so the name is what comes under it.
  expect(segmentLabel({ id: "a", body: "---\nThe turn", updatedAt: 0 })).toBe("The turn");
  expect(segmentLabel({ id: "a", body: "###", updatedAt: 0 })).toBe("Untitled segment");
});

// A block is a stretch of prose, so its first line can run long. The cut counts
// columns rather than characters: an ideograph is drawn twice as wide, and a
// Chinese name cut at 60 characters would be twice the width of a Latin one.
test("a long first line is cut, and Chinese is cut at its real width", () => {
  const latin = segmentLabel({ id: "a", body: "word ".repeat(40), updatedAt: 0 });
  expect(latin.length).toBeLessThanOrEqual(61);
  expect(latin.endsWith("…")).toBe(true);

  const cjk = segmentLabel({ id: "a", body: "注".repeat(60), updatedAt: 0 });
  expect([...cjk].length).toBe(31);
  expect(cjk.endsWith("…")).toBe(true);

  const short = segmentLabel({ id: "a", body: "The loss", updatedAt: 0 });
  expect(short).toBe("The loss");
});

// --- the formula -------------------------------------------------------------

test("a formula is fenced on its own lines", () => {
  expect(displayMath("E=mc^2")).toBe("$$\nE=mc^2\n$$");
});

test("a formula that already carries its fences is not fenced twice", () => {
  expect(displayMath("$$E=mc^2$$")).toBe("$$\nE=mc^2\n$$");
  expect(displayMath("  $$\nE=mc^2\n$$  ")).toBe("$$\nE=mc^2\n$$");
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
