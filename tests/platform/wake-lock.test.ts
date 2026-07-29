// The screen wake lock (src/platform/app/wake-lock.ts) against a fake
// navigator/document: it must survive the page being hidden and shown, which is
// the whole reason it needs any logic at all — the platform drops the lock on
// the way out and never gives it back. Run: bun test.

import { expect, test } from "bun:test";
import {
  createScreenWakeLock,
  type WakeLockSentinelLike,
  type WakeLockTarget,
} from "../../src/platform/app/wake-lock";

class FakeTarget {
  hidden = false;
  requests = 0;
  released = 0;
  live = 0;
  // Set to reject the request, as Safari does without a user gesture.
  refuse = false;
  private listeners: (() => void)[] = [];

  target: WakeLockTarget;

  constructor() {
    const self = this;
    this.target = {
      navigator: {
        wakeLock: {
          async request(): Promise<WakeLockSentinelLike> {
            self.requests++;
            if (self.refuse) throw new Error("refused");
            self.live++;
            return {
              async release() {
                self.released++;
                self.live--;
              },
            };
          },
        },
      },
      document: {
        get hidden() {
          return self.hidden;
        },
        addEventListener: (_type, fn) => void self.listeners.push(fn),
        removeEventListener: (_type, fn) => {
          self.listeners = self.listeners.filter((l) => l !== fn);
        },
      },
    };
  }

  async setHidden(hidden: boolean): Promise<void> {
    this.hidden = hidden;
    for (const l of [...this.listeners]) l();
    await Promise.resolve();
  }
}

test("the lock is taken while wanted and released when it is not", async () => {
  const fake = new FakeTarget();
  const lock = createScreenWakeLock(fake.target);
  lock.set(true);
  await Promise.resolve();
  expect(fake.requests).toBe(1);
  expect(fake.live).toBe(1);

  lock.set(true); // idempotent
  await Promise.resolve();
  expect(fake.requests).toBe(1);

  lock.set(false);
  await Promise.resolve();
  expect(fake.live).toBe(0);
});

test("hiding the page drops the lock, coming back takes it again", async () => {
  const fake = new FakeTarget();
  const lock = createScreenWakeLock(fake.target);
  lock.set(true);
  await Promise.resolve();

  // The platform releases on hide without telling us; nothing is requested
  // while hidden.
  await fake.setHidden(true);
  expect(fake.requests).toBe(1);

  await fake.setHidden(false);
  expect(fake.requests).toBe(2);

  // Once the run is over, a later visibility change asks for nothing.
  lock.set(false);
  await fake.setHidden(true);
  await fake.setHidden(false);
  expect(fake.requests).toBe(2);
});

test("a lock granted after the run finished is released, not leaked", async () => {
  const fake = new FakeTarget();
  const lock = createScreenWakeLock(fake.target);
  lock.set(true);
  lock.set(false); // the run ends before the request is answered
  await Promise.resolve();
  await Promise.resolve();
  expect(fake.requests).toBe(1);
  expect(fake.live).toBe(0);
});

test("a refused request is swallowed, and asking again is still possible", async () => {
  const fake = new FakeTarget();
  fake.refuse = true;
  const lock = createScreenWakeLock(fake.target);
  lock.set(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(fake.live).toBe(0);

  fake.refuse = false;
  await fake.setHidden(true);
  await fake.setHidden(false);
  expect(fake.live).toBe(1);
});

test("a webview without the API is a no-op, not a crash", () => {
  const lock = createScreenWakeLock({
    navigator: {},
    document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
  });
  lock.set(true);
  lock.set(false);
  expect(createScreenWakeLock(null).set(true)).toBeUndefined();
});
