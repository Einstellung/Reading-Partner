// The soul's harness (src/soul/harness.ts): one per process, on the soul lane.
// Run: scripts/t.sh tests/soul/harness.test.ts

import { expect, test } from "bun:test";
import { SOUL_LANE, soulHarness } from "../../src/soul/harness";

test("the process has one soul harness, on the soul lane of the soul group", () => {
  const first = soulHarness();
  expect(soulHarness()).toBe(first);
  expect(first.lane).toEqual({ name: "soul", sessions: "soul" });
  expect(first.lane).toBe(SOUL_LANE);
});
