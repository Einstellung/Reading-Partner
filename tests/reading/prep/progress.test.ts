// How far a run has got (src/reading/prep/progress.ts). Run: bun test.

import { expect, test } from "bun:test";
import { prepProgress } from "../../../src/reading/prep/progress";

const CHAPTER_SETTLED = (c: { status: string }) => c.status === "done" || c.status === "failed";
const PAPER_SETTLED = (p: { status: string }) =>
  !["queued", "fetching", "digesting", "cooldown"].includes(p.status);

function items(...statuses: string[]) {
  return statuses.map((status) => ({ status }));
}

test("counts what is behind the run against everything it has", () => {
  expect(prepProgress(items("done", "done", "running", "pending"), CHAPTER_SETTLED)).toEqual({
    done: 2,
    total: 4,
  });
});

// A failure is behind us: the run is not coming back to it on its own, and a
// counter that waits for it stops moving while the run is still working.
test("a chapter given up on counts as behind, not as still ahead", () => {
  expect(prepProgress(items("done", "failed", "pending"), CHAPTER_SETTLED)).toEqual({
    done: 2,
    total: 3,
  });
});

test("the paper half counts its four working statuses as ahead and the rest as behind", () => {
  expect(
    prepProgress(
      items("done", "abstract-only", "skipped", "failed", "queued", "fetching", "digesting", "cooldown"),
      PAPER_SETTLED,
    ),
  ).toEqual({ done: 4, total: 8 });
});

// A run in its planning phase has no list yet; the line says "Preparing…" rather
// than a number, so this has to answer honestly rather than pretend to be done.
test("an empty list is nothing done out of nothing, not everything done", () => {
  expect(prepProgress([], CHAPTER_SETTLED)).toEqual({ done: 0, total: 0 });
});
