// Unit tests for the pure state helpers behind the slides store
// (src/reading/slides/types.ts): the talk registry, load-time recovery, and
// "is there anything left to run". The fs wrapper (store.ts) is exercised in the
// app. Run: bun test.

import { expect, test } from "bun:test";
import {
  hasPendingWork,
  hasUnrunSlides,
  normalizeSlidesOnLoad,
  upsertTalk,
  type SlideRun,
  type SlidesState,
  type TalkEntry,
} from "../../../src/reading/slides/types";

const entry = (title: string, createdAt: number, talkId?: string): TalkEntry => ({
  talkId,
  title,
  file: `slides/${createdAt}-${title}.html`,
  createdAt,
  bookIds: ["b1"],
  instruction: "",
});

const slide = (index: number, over: Partial<SlideRun> = {}): SlideRun => ({
  index,
  title: `S${index}`,
  kind: "content",
  contentStatus: "done",
  ...over,
});

const state = (over: Partial<SlidesState> = {}): SlidesState => ({
  version: 1,
  id: "100",
  title: "T",
  createdAt: 100,
  instruction: "",
  bookIds: ["b1"],
  runStatus: "idle",
  planStatus: "done",
  slides: [slide(1), slide(2)],
  assembleStatus: "done",
  ...over,
});

test("upsertTalk appends newest last without mutating the input", () => {
  const a = [entry("first", 1, "t1")];
  const b = upsertTalk(a, entry("second", 2, "t2"));
  expect(b.map((t) => t.title)).toEqual(["first", "second"]);
  expect(a).toHaveLength(1); // input untouched
});

test("upsertTalk replaces the row for a talk that is reassembled", () => {
  const talks = upsertTalk([entry("draft", 1, "t1")], entry("final", 1, "t1"));
  expect(talks).toHaveLength(1);
  expect(talks[0].title).toBe("final");
});

test("upsertTalk appends rows that carry no talk id (decks from before per-talk state)", () => {
  const talks = upsertTalk([entry("legacy", 1)], entry("also legacy", 2));
  expect(talks.map((t) => t.title)).toEqual(["legacy", "also legacy"]);
});

test("normalizeSlidesOnLoad requeues everything that was in flight", () => {
  const loaded = normalizeSlidesOnLoad(
    state({
      runStatus: "running",
      planStatus: "running",
      assembleStatus: "running",
      slides: [
        slide(1, { contentStatus: "running" }),
        slide(2, { contentStatus: "done", assetStatus: "running" }),
      ],
    }),
  );
  expect(loaded.runStatus).toBe("idle");
  expect(loaded.planStatus).toBe("pending");
  expect(loaded.assembleStatus).toBe("pending");
  expect(loaded.slides[0].contentStatus).toBe("pending");
  expect(loaded.slides[1].assetStatus).toBe("pending");
});

test("normalizeSlidesOnLoad leaves decisions alone", () => {
  const loaded = normalizeSlidesOnLoad(
    state({
      assembleStatus: "stale",
      slides: [
        slide(1, { contentStatus: "failed", error: "model down" }),
        slide(2, { assetStatus: "missing", assetError: "no key" }),
      ],
    }),
  );
  expect(loaded.assembleStatus).toBe("stale");
  expect(loaded.slides[0].contentStatus).toBe("failed");
  expect(loaded.slides[0].error).toBe("model down");
  expect(loaded.slides[1].assetStatus).toBe("missing");
});

test("hasUnrunSlides is about AI work only, so a stale deck does not ask for one", () => {
  expect(hasUnrunSlides(state())).toBe(false);
  expect(hasUnrunSlides(state({ assembleStatus: "stale" }))).toBe(false);
  expect(hasUnrunSlides(state({ planStatus: "pending" }))).toBe(true);
  expect(hasUnrunSlides(state({ slides: [slide(1, { assetStatus: "pending" })] }))).toBe(true);
});

test("hasPendingWork sees an unplanned, unwritten, or unassembled talk", () => {
  expect(hasPendingWork(state())).toBe(false);
  expect(hasPendingWork(state({ planStatus: "pending" }))).toBe(true);
  expect(hasPendingWork(state({ slides: [slide(1, { contentStatus: "pending" })] }))).toBe(true);
  expect(hasPendingWork(state({ slides: [slide(1, { assetStatus: "pending" })] }))).toBe(true);
  expect(hasPendingWork(state({ assembleStatus: "stale" }))).toBe(true);
  // A failed slide is not pending work: it waits for an explicit re-run.
  expect(hasPendingWork(state({ slides: [slide(1, { contentStatus: "failed" })] }))).toBe(false);
});
