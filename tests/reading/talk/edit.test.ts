// Editing a talk's outline (src/reading/talk/edit.ts). Pure, so every one of
// these runs without a filesystem; the store is read, apply one of these, write.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  moveSegment,
  putSegment,
  removeSegment,
  renameTalkOutline,
  setSpine,
} from "../../../src/reading/talk/edit";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";

function outlineWith(...titles: string[]): TalkOutline {
  let outline = newTalkOutline({ id: "1", topicId: "t", now: 1 });
  for (const title of titles) {
    outline = putSegment(outline, { title }, 1, () => `s-${title}`);
  }
  return outline;
}

test("a new segment lands where it was asked for, and appends by default", () => {
  const outline = outlineWith("one", "two");
  expect(outline.segments.map((s) => s.title)).toEqual(["one", "two"]);
  const withOpening = putSegment(outline, { title: "opening", at: 0 }, 2, () => "s-opening");
  expect(withOpening.segments.map((s) => s.title)).toEqual(["opening", "one", "two"]);
  // Past the end is the end, not a hole.
  const withClose = putSegment(withOpening, { title: "close", at: 99 }, 3, () => "s-close");
  expect(withClose.segments.map((s) => s.title)).toEqual(["opening", "one", "two", "close"]);
});

// The AI writes one line of a segment at a time (docs/44), so an edit that names
// a title must not blank the cues that were already under it.
test("an edit touches the keys it names and leaves the rest alone", () => {
  const outline = putSegment(outlineWith("one"), { id: "s-one", cues: ["a", "b"] }, 2);
  const edited = putSegment(outline, { id: "s-one", title: "one, sharpened" }, 3);
  expect(edited.segments[0].cues).toEqual(["a", "b"]);
  expect(edited.segments[0].title).toBe("one, sharpened");
  expect(edited.segments[0].updatedAt).toBe(3);
});

test("an act and a callback can be taken back off", () => {
  const outline = putSegment(outlineWith("one"), { id: "s-one", act: "Act I", callback: "s-x" }, 2);
  expect(outline.segments[0].act).toBe("Act I");
  const bare = putSegment(outline, { id: "s-one", act: null, callback: null }, 3);
  expect("act" in bare.segments[0]).toBe(false);
  expect("callback" in bare.segments[0]).toBe(false);
});

// The store writes only what came back different, so a no-op must come back
// identical rather than merely equal: an identical rewrite is a sync revision
// and a merge for nothing (pitfall 53).
test("a change that is not a change is the same object", () => {
  const outline = putSegment(outlineWith("one"), { id: "s-one", cues: ["a"] }, 2);
  expect(putSegment(outline, { id: "s-one", cues: ["a"] }, 9)).toBe(outline);
  expect(putSegment(outline, { id: "s-one", title: "one" }, 9)).toBe(outline);
  expect(removeSegment(outline, "nobody", 9)).toBe(outline);
  expect(moveSegment(outline, "s-one", 0, 9)).toBe(outline);
  expect(moveSegment(outline, "nobody", 1, 9)).toBe(outline);
  expect(setSpine(outline, { thesis: "" }, 9)).toBe(outline);
  expect(renameTalkOutline(outline, outline.name, 9)).toBe(outline);
  expect(renameTalkOutline(outline, "   ", 9)).toBe(outline);
});

test("moving reads as the position in the list that comes out", () => {
  const outline = outlineWith("one", "two", "three");
  expect(moveSegment(outline, "s-three", 0, 2).segments.map((s) => s.title)).toEqual([
    "three",
    "one",
    "two",
  ]);
  expect(moveSegment(outline, "s-one", 99, 2).segments.map((s) => s.title)).toEqual([
    "two",
    "three",
    "one",
  ]);
});

test("removing takes one segment and leaves the order of the others", () => {
  const outline = removeSegment(outlineWith("one", "two", "three"), "s-two", 5);
  expect(outline.segments.map((s) => s.title)).toEqual(["one", "three"]);
  expect(outline.updatedAt).toBe(5);
});

test("the spine is patched key by key", () => {
  const outline = setSpine(outlineWith(), { thesis: "the body is the point" }, 2);
  const both = setSpine(outline, { audience: "nobody here trains models" }, 3);
  expect(both.spine.thesis).toBe("the body is the point");
  expect(both.spine.audience).toBe("nobody here trains models");
  // An array handed in replaces the one that was there: the ribs are an order.
  const ribs = setSpine(both, { backbone: ["one", "two"] }, 4);
  expect(setSpine(ribs, { backbone: ["two"] }, 5).spine.backbone).toEqual(["two"]);
});

// An id is what the record merge keys on, so two segments must never share one.
test("a new segment cannot take an id another segment already has", () => {
  const outline = outlineWith("one");
  const second = putSegment(outline, { id: "s-one", at: 0, title: "two" }, 2, () => "minted");
  // The id was taken, so it edited that segment rather than making a twin.
  expect(second.segments.map((s) => s.id)).toEqual(["s-one"]);
  expect(second.segments[0].title).toBe("two");
});
