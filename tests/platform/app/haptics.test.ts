// The haptics wrapper (src/platform/app/haptics.ts) where there is no motor.
// bun is not a phone and there is no Tauri host under it, so the plugin's
// invoke throws — which is exactly the desktop case, and the whole contract of
// this module is that a caller never hears about it.
//
// Run: bun test.

import { expect, test } from "bun:test";

import { voiceStartFeedback, voiceStopFeedback } from "../../../src/platform/app/haptics";

test("a start with no host behind it resolves and says nothing", async () => {
  expect(await voiceStartFeedback()).toBeUndefined();
});

test("a stop with no host behind it resolves without waiting out the pair", async () => {
  const began = Date.now();
  expect(await voiceStopFeedback()).toBeUndefined();
  // The second tap is skipped when the first did nothing, so this returns well
  // inside the gap between them.
  expect(Date.now() - began).toBeLessThan(100);
});
