// Starting with the machine (src/platform/app/autostart.ts): the decisions in it
// that are not plugin calls. device.json holds what the user asked for, the OS
// holds what is registered, and startup makes the second agree with the first —
// except in a dev build, which never belongs in the login sequence. Run: bun
// test.

import { expect, test } from "bun:test";
import { autostartAction, startupAutostartAction } from "../src/platform/app/autostart";

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

test("a packaged build reconciles at startup like any other caller", () => {
  expect(startupAutostartAction(false, true, false)).toBe("enable");
  expect(startupAutostartAction(false, false, true)).toBe("disable");
  expect(startupAutostartAction(false, true, true)).toBeNull();
});

test("a dev build takes itself out of the login sequence", () => {
  // Whatever is stored and whatever the OS says: a dev binary started at login
  // opens on a connection-refused page, so startup clears the registration one
  // of its own earlier runs wrote. Null would leave that one in place.
  expect(startupAutostartAction(true, true, true)).toBe("disable");
  expect(startupAutostartAction(true, false, false)).toBe("disable");
  expect(startupAutostartAction(true, true, false)).toBe("disable");
});
