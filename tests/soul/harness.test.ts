// The soul's harness (src/soul/harness.ts): one per process, on the soul lane,
// and opened at start so a turn the last process was killed in the middle of is
// finished without the reader asking for anything (recover.ts).
// Run: scripts/t.sh tests/soul/harness.test.ts

import { expect, test } from "bun:test";
import { SOUL_LANE, soulHarness, startSoulSession } from "../../src/soul/harness";
import type { Settings } from "../../src/platform/app/settings";

test("the process has one soul harness, on the soul lane of the soul group", () => {
  const first = soulHarness();
  expect(soulHarness()).toBe(first);
  expect(first.lane).toEqual({ name: "soul", sessions: "soul" });
  expect(first.lane).toBe(SOUL_LANE);
});

// Nobody is waiting on the open, and a device with no provider configured has
// nothing to resume with. The first turn then opens the session the way every
// turn did before.
test("a start that cannot open the session is dropped rather than thrown", async () => {
  const settings = async (): Promise<Settings> =>
    ({ defaultProviderId: "not-a-provider", defaultModelId: "not-a-model" }) as Settings;
  await expect(startSoulSession({ settings })).resolves.toBeUndefined();
});

test("a start whose settings will not load is dropped too", async () => {
  const settings = (): Promise<Settings> => Promise.reject(new Error("no settings on this disk"));
  await expect(startSoulSession({ settings })).resolves.toBeUndefined();
});
