// info-meals.json across two devices (src/info/meals/plan/merge.ts): a plan
// confirmed on one device is not undone by the other device, still on the old
// plan, ticking a line before it has pulled.
// Run: scripts/t.sh tests/info/meals/plan/merge.test.ts

import { expect, test } from "bun:test";
import "../../../../src/info/meals/plan/merge";
import { joinMealsFiles } from "../../../../src/info/meals/plan/merge";
import { mealsFileBody } from "../../../../src/info/meals/plan/store";
import type { MealsState } from "../../../../src/info/meals/plan/types";
import { mergeFile } from "../../../../src/platform/sync/merge";
import { strategyFor } from "../../../../src/platform/sync/merge/contract";
import { shopping, state, week } from "../fixtures/week";

const enc = new TextEncoder();
const dec = new TextDecoder();
const PATH = "info-meals.json";

const bytes = (s: MealsState) => enc.encode(mealsFileBody(s));

const OLD = state({ plan: { ...week(), createdAt: 100 } });
// The old plan, then a line ticked on a device that has not pulled the new one.
const STALE = { ...OLD, shopping: shopping({ ...OLD.shopping, checked: { "produce\u0000橙子": true } }) };
// The new plan, confirmed later on the other device, with a trip of its own.
const NEW = state({ plan: { ...week(), id: "week-new", createdAt: 200 }, shopping: shopping() });

test("the file merges as a lattice", () => {
  expect(strategyFor(PATH)).toBe("lattice");
});

test("the copy whose plan was confirmed later wins whole, whichever device merges", () => {
  for (const [local, remote] of [
    [STALE, NEW],
    [NEW, STALE],
  ] as const) {
    const out = mergeFile({ path: PATH, base: bytes(OLD), local: bytes(local), remote: bytes(remote) });
    expect(JSON.parse(dec.decode(out.merged))).toEqual(JSON.parse(mealsFileBody(NEW)));
    expect(out.copies).toEqual([]);
    expect(out.contested).toBe(true);
  }
});

test("two copies of one plan are left to the whole-file rule: one kept, the other parked", () => {
  const ticked = { ...OLD, shopping: shopping({ ...OLD.shopping, checked: { a: true } }) };
  expect(joinMealsFiles(JSON.parse(mealsFileBody(STALE)), JSON.parse(mealsFileBody(ticked)))).toBeNull();
  const out = mergeFile({ path: PATH, base: bytes(OLD), local: bytes(STALE), remote: bytes(ticked) });
  expect(out.copies).toHaveLength(1);
});

test("a file with a plan beats one with none; a file that is not the meals shape is not decided", () => {
  const none = JSON.parse(mealsFileBody({ ...OLD, plan: null }));
  const some = JSON.parse(mealsFileBody(OLD));
  expect(joinMealsFiles(none, some)?.merged).toEqual(some);
  expect(joinMealsFiles(some, none)?.merged).toEqual(some);
  expect(joinMealsFiles([], some)).toBeNull();
});
