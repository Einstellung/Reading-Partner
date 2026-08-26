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

function outlineWith(...bodies: string[]): TalkOutline {
  let outline = newTalkOutline({ id: "1", topicId: "t", now: 1 });
  for (const body of bodies) {
    outline = putSegment(outline, { body }, 1, () => `s-${body}`);
  }
  return outline;
}

test("a new segment lands where it was asked for, and appends by default", () => {
  const outline = outlineWith("one", "two");
  expect(outline.segments.map((s) => s.body)).toEqual(["one", "two"]);
  const withOpening = putSegment(outline, { body: "opening", at: 0 }, 2, () => "s-opening");
  expect(withOpening.segments.map((s) => s.body)).toEqual(["opening", "one", "two"]);
  // Past the end is the end, not a hole.
  const withClose = putSegment(withOpening, { body: "close", at: 99 }, 3, () => "s-close");
  expect(withClose.segments.map((s) => s.body)).toEqual(["opening", "one", "two", "close"]);
});

// A block is one piece of prose, so a rewrite replaces it whole. There is no
// field in it to name and nothing under it to leave alone.
test("a rewrite replaces the block and moves the clock", () => {
  const outline = outlineWith("one");
  const edited = putSegment(outline, { id: "s-one", body: "one, sharpened" }, 3);
  expect(edited.segments[0].body).toBe("one, sharpened");
  expect(edited.segments[0].updatedAt).toBe(3);
  // `at` is ignored for a segment that is already there: an edit of the words
  // must not silently reorder the talk.
  const two = putSegment(edited, { id: "s-one", body: "again", at: 0 }, 4);
  expect(two.segments.map((s) => s.id)).toEqual(["s-one"]);
});

// The repair a load goes through is the same one an edit goes through, so a
// segment cannot reach disk in a shape the next read would drop.
test("an add carrying no block is not an add", () => {
  const outline = outlineWith("one");
  expect(putSegment(outline, { at: 0 }, 2, () => "minted")).toBe(outline);
  expect(putSegment(outline, { body: "   " }, 2, () => "minted")).toBe(outline);
  // Emptying an existing block is not how a block is removed either.
  expect(putSegment(outline, { id: "s-one", body: "" }, 2)).toBe(outline);
});

// The store writes only what came back different, so a no-op must come back
// identical rather than merely equal: an identical rewrite is a sync revision
// and a merge for nothing (pitfall 53).
test("a change that is not a change is the same object", () => {
  const outline = outlineWith("one");
  expect(putSegment(outline, { id: "s-one", body: "one" }, 9)).toBe(outline);
  // The stored block is trimmed, so a rewrite that only adds whitespace is not
  // a change either.
  expect(putSegment(outline, { id: "s-one", body: "  one\n" }, 9)).toBe(outline);
  expect(removeSegment(outline, "nobody", 9)).toBe(outline);
  expect(moveSegment(outline, "s-one", 0, 9)).toBe(outline);
  expect(moveSegment(outline, "nobody", 1, 9)).toBe(outline);
  expect(setSpine(outline, { thesis: "" }, 9)).toBe(outline);
  expect(renameTalkOutline(outline, outline.name, 9)).toBe(outline);
  expect(renameTalkOutline(outline, "   ", 9)).toBe(outline);
});

test("moving reads as the position in the list that comes out", () => {
  const outline = outlineWith("one", "two", "three");
  expect(moveSegment(outline, "s-three", 0, 2).segments.map((s) => s.body)).toEqual([
    "three",
    "one",
    "two",
  ]);
  expect(moveSegment(outline, "s-one", 99, 2).segments.map((s) => s.body)).toEqual([
    "two",
    "three",
    "one",
  ]);
});

test("removing takes one segment and leaves the order of the others", () => {
  const outline = removeSegment(outlineWith("one", "two", "three"), "s-two", 5);
  expect(outline.segments.map((s) => s.body)).toEqual(["one", "three"]);
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
  const second = putSegment(outline, { id: "s-one", at: 0, body: "two" }, 2, () => "minted");
  // The id was taken, so it edited that segment rather than making a twin.
  expect(second.segments.map((s) => s.id)).toEqual(["s-one"]);
  expect(second.segments[0].body).toBe("two");
});
