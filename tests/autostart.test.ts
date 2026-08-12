// Starting with the machine (src/platform/app/autostart.ts): the one decision in
// it that is not a plugin call. device.json holds what the user asked for, the
// OS holds what is registered, and startup makes the second agree with the
// first. Run: bun test.

import { expect, test } from "bun:test";
import { autostartAction } from "../src/platform/app/autostart";

test("an OS that already agrees is left alone", () => {
  expect(autostartAction(true, true)).toBeNull();
  expect(autostartAction(false, false)).toBeNull();
});

test("the stored answer is the one that wins", () => {
  // A registration a system upgrade or a cleaner removed is put back.
  expect(autostartAction(true, false)).toBe("enable");
  // And one that survived an uninstall, or came from before the user turned the
  // switch off, is taken away. Default off means a fresh device.json disables.
  expect(autostartAction(false, true)).toBe("disable");
});
