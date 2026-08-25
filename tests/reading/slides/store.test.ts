// Unit tests for the pure state helpers behind the slides store
// (src/reading/slides/types.ts): the retell registry, load-time recovery, and
// "is there anything left to run". The fs wrapper (store.ts) is exercised in the
// app. Run: bun test.

import { expect, test } from "bun:test";
import {
  hasUnrunSlides,
  normalizeSlidesOnLoad,
  upsertRetell,
  type SlideRun,
  type SlidesState,
  type RetellEntry,
} from "../../../src/reading/slides/types";

const entry = (title: string, createdAt: number, talkId?: string): RetellEntry => ({
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

test("upsertRetell appends newest last without mutating the input", () => {
  const a = [entry("first", 1, "t1")];
  const b = upsertRetell(a, entry("second", 2, "t2"));
  expect(b.map((t) => t.title)).toEqual(["first", "second"]);
  expect(a).toHaveLength(1); // input untouched
});

test("upsertRetell replaces the row for a retell that is reassembled", () => {
  const retells = upsertRetell([entry("draft", 1, "t1")], entry("final", 1, "t1"));
  expect(retells).toHaveLength(1);
  expect(retells[0].title).toBe("final");
});

test("upsertRetell appends rows that carry no retell id (decks from before per-retell state)", () => {
  const retells = upsertRetell([entry("legacy", 1)], entry("also legacy", 2));
  expect(retells.map((t) => t.title)).toEqual(["legacy", "also legacy"]);
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
