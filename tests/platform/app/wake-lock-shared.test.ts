// The prep run and the prep's call keep the screen on with one lock
// (platform/app/wake-lock.ts heldScreenWakeLock): neither drops the other's.

import { expect, test } from "bun:test";
import { heldScreenWakeLock, type WakeLockTarget } from "../../../src/platform/app/wake-lock";

function fakeTarget() {
  const lock = { requested: 0, released: 0 };
  const target: WakeLockTarget = {
    navigator: {
      wakeLock: {
        request: async () => {
          lock.requested++;
          return { released: false, release: async () => void lock.released++ };
        },
      },
    },
    document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
  };
  return { lock, target: () => target };
}

test("two holders share one sentinel, released only when both let go", async () => {
  const { lock, target } = fakeTarget();
  const run = heldScreenWakeLock("prep-run", target);
  const call = heldScreenWakeLock("prep-call", target);
  run.set(true);
  call.set(true);
  await Promise.resolve();
  expect(lock.requested).toBe(1);
  run.set(false);
  await Promise.resolve();
  expect(lock.released).toBe(0);
  call.set(false);
  await Promise.resolve();
  expect(lock.released).toBe(1);
  // Letting go of what was never held does nothing.
  call.set(false);
  expect(lock.released).toBe(1);
});
