// The license gate over the app's lifetime (src/platform/license/gate.ts):
// when it checks, and what each lock-screen button does. Run: bun test.

import { expect, test } from "bun:test";
import type { GateView } from "../../../src/platform/license/decide";
import { createLicenseGate, type GateDeps, type PurchaseResult } from "../../../src/platform/license/gate";

const HOUR = 60 * 60 * 1000;
const EXPIRED: GateView = { view: "locked", reason: "expired", userId: "u1" };

function harness(answers: GateView[], over: Partial<GateDeps> = {}) {
  let now = 0;
  const log: string[] = [];
  let foreground: (() => void) | null = null;
  let signInChanged: (() => void) | null = null;
  const queue = [...answers];
  const deps: GateDeps = {
    enabled: true,
    check: async () => {
      log.push("check");
      return queue.shift() ?? { view: "open" };
    },
    now: () => now,
    observeForeground: (cb) => {
      foreground = cb;
      return () => {
        foreground = null;
      };
    },
    observeSignIn: (cb) => {
      signInChanged = cb;
      return () => {
        signInChanged = null;
      };
    },
    signIn: async () => {
      log.push("signIn");
    },
    signOut: async () => {
      log.push("signOut");
    },
    deleteAccount: async () => {
      log.push("deleteAccount");
      return true;
    },
    purchases: {
      buy: async (id) => {
        log.push(`buy:${id}`);
        return { ok: true };
      },
      restore: async (id) => {
        log.push(`restore:${id}`);
        return { ok: true };
      },
    },
    ...over,
  };
  const gate = createLicenseGate(deps);
  return {
    gate,
    log,
    advance: (ms: number) => {
      now += ms;
    },
    foreground: () => foreground?.(),
    signInChanged: () => signInChanged?.(),
    bound: () => foreground !== null && signInChanged !== null,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("starts with one check and shows its answer", async () => {
  const h = harness([EXPIRED]);
  const seen: GateView[] = [];
  h.gate.subscribe(() => seen.push(h.gate.get()));
  expect(h.gate.get()).toEqual({ view: "open" });
  const stop = h.gate.start();
  await settle();
  expect(h.log).toEqual(["check"]);
  expect(seen).toEqual([EXPIRED]);
  stop();
  expect(h.bound()).toBe(false);
});

test("the foreground re-checks an open app only after six hours", async () => {
  const h = harness([]);
  h.gate.start();
  await settle();
  h.advance(5 * HOUR);
  h.foreground();
  await settle();
  expect(h.log).toEqual(["check"]);
  h.advance(HOUR);
  h.foreground();
  await settle();
  expect(h.log).toEqual(["check", "check"]);
});

test("the foreground re-checks a locked app every time", async () => {
  const h = harness([EXPIRED, EXPIRED]);
  h.gate.start();
  await settle();
  h.foreground();
  await settle();
  expect(h.log).toEqual(["check", "check"]);
});

test("a sign-in change re-checks", async () => {
  const h = harness([{ view: "sign-in" }]);
  h.gate.start();
  await settle();
  h.signInChanged();
  await settle();
  expect(h.log).toEqual(["check", "check"]);
  expect(h.gate.get()).toEqual({ view: "open" });
});

test("overlapping re-checks share one request", async () => {
  const h = harness([]);
  await Promise.all([h.gate.recheck(), h.gate.recheck()]);
  expect(h.log).toEqual(["check"]);
});

test("a check that throws leaves the app open", async () => {
  const h = harness([], { check: async () => Promise.reject(new Error("bug")) });
  expect(await h.gate.recheck()).toEqual({ view: "open" });
});

test("buy goes to the store as the locked user and re-checks", async () => {
  const h = harness([EXPIRED, { view: "open" }]);
  await h.gate.recheck();
  expect(await h.gate.buy()).toEqual({ ok: true });
  expect(h.log).toEqual(["check", "buy:u1", "check"]);
  expect(h.gate.get()).toEqual({ view: "open" });
});

test("a purchase the server does not show yet is pending", async () => {
  const h = harness([EXPIRED, EXPIRED]);
  await h.gate.recheck();
  expect(await h.gate.restore()).toEqual({ ok: false, error: "pending" });
  expect(h.log).toEqual(["check", "restore:u1", "check"]);
});

test("store failures are reported and nothing is re-checked", async () => {
  for (const [error, expected] of [
    ["unavailable", "unavailable"],
    ["cancelled", "cancelled"],
    ["network", "failed"],
  ] as const) {
    const result: PurchaseResult = { ok: false, error };
    const h = harness([EXPIRED], {
      purchases: { buy: async () => result, restore: async () => result },
    });
    await h.gate.recheck();
    expect(await h.gate.buy()).toEqual({ ok: false, error: expected });
    expect(h.log).toEqual(["check"]);
  }
});

test("buy with no locked user does nothing", async () => {
  const h = harness([]);
  expect(await h.gate.buy()).toEqual({ ok: false, error: "failed" });
  expect(h.log).toEqual([]);
});

test("delete account deletes, signs out and re-checks", async () => {
  const h = harness([EXPIRED, { view: "sign-in" }]);
  await h.gate.recheck();
  expect(await h.gate.deleteAccount()).toEqual({ ok: true });
  expect(h.log).toEqual(["check", "deleteAccount", "signOut", "check"]);
  expect(h.gate.get()).toEqual({ view: "sign-in" });
});

test("a refused delete does not sign out", async () => {
  const h = harness([EXPIRED], { deleteAccount: async () => false });
  await h.gate.recheck();
  expect(await h.gate.deleteAccount()).toEqual({ ok: false, error: "failed" });
  expect(h.log).toEqual(["check"]);
});

test("sign in and sign out each re-check", async () => {
  const h = harness([{ view: "sign-in" }, { view: "open" }, { view: "sign-in" }]);
  await h.gate.recheck();
  expect(await h.gate.signIn()).toEqual({ ok: true });
  expect(h.gate.get()).toEqual({ view: "open" });
  expect(await h.gate.signOut()).toEqual({ ok: true });
  expect(h.log).toEqual(["check", "signIn", "check", "signOut", "check"]);
});

test("a sign-in that throws is a failure", async () => {
  const h = harness([], { signIn: async () => Promise.reject(new Error("closed")) });
  expect(await h.gate.signIn()).toEqual({ ok: false, error: "failed" });
});

test("retry re-checks", async () => {
  const h = harness([]);
  expect(await h.gate.retry()).toEqual({ ok: true });
  expect(h.log).toEqual(["check"]);
});
