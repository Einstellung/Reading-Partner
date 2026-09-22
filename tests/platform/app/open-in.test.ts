// The Open in… wrapper (src/platform/app/open-in.ts) where there is no native
// half. bun is not a phone and there is no Tauri host under it, which is the
// desktop and browser case too, and the whole contract of the probe is that a
// caller never hears about it: it answers false and the control is not drawn.
//
// Run: scripts/t.sh tests/platform/app/open-in.test.ts

import { expect, test } from "bun:test";

import { openIn, openInAvailable } from "../../../src/platform/app/open-in";

test("no host means no Open in…", async () => {
  expect(await openInAvailable()).toBe(false);
});

test("handing a file over with no host behind it rejects rather than resolving", async () => {
  // A caller that skipped the probe has to find out. Resolving would leave the
  // reader waiting for a sheet that is never coming.
  await expect(openIn("/tmp/whatever.pdf")).rejects.toThrow();
});
