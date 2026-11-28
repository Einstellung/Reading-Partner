// The purchases wrapper (src/platform/app/purchases.ts): which calls reach the
// plugin and what comes back when they do not. The host is injected, so these
// run with no Tauri underneath.
//
// Run: scripts/t.sh tests/platform/app/purchases.test.ts

import { expect, test } from "bun:test";

import {
  LIFETIME_ENTITLEMENT_ID,
  LIFETIME_PRODUCT_ID,
  REVENUECAT_ANDROID_API_KEY,
  REVENUECAT_IOS_API_KEY,
  buyLifetime,
  configurePurchases,
  createPurchases,
  purchasesAvailable,
  restorePurchases,
} from "../../../src/platform/app/purchases";

type Call = { command: string; args?: Record<string, unknown> };

function host(opts: {
  apiKey?: string;
  androidApiKey?: string;
  platform?: string | null;
  answer?: () => unknown;
}) {
  const calls: Call[] = [];
  const purchases = createPurchases({
    apiKey: opts.apiKey ?? "appl_test",
    androidApiKey: opts.androidApiKey,
    platform: () => {
      if (opts.platform === null) throw new Error("not under Tauri");
      return opts.platform ?? "ios";
    },
    invoke: (async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return opts.answer ? opts.answer() : { ok: true };
    }) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
  });
  return { calls, purchases };
}

test("the shipped build has no key, so purchases are off and nothing is invoked", async () => {
  expect(REVENUECAT_IOS_API_KEY).toBe("");
  expect(REVENUECAT_ANDROID_API_KEY).toBe("");
  expect(purchasesAvailable()).toBe(false);
  expect(await configurePurchases("user-1")).toBeUndefined();
  expect(await buyLifetime()).toEqual({ ok: false, error: "not configured" });
  expect(await restorePurchases()).toEqual({ ok: false, active: false, error: "not configured" });
});

test("a mobile store with an empty or blank key never invokes the plugin", async () => {
  for (const opts of [
    { platform: "ios", apiKey: "" },
    { platform: "ios", apiKey: "  ", androidApiKey: "goog_test" },
    { platform: "android" },
    { platform: "android", androidApiKey: "  " },
  ]) {
    const { calls, purchases } = host(opts);
    expect(purchases.purchasesAvailable()).toBe(false);
    await purchases.configurePurchases("user-1");
    expect(await purchases.buyLifetime()).toEqual({ ok: false, error: "not configured" });
    expect(await purchases.restorePurchases()).toEqual({
      ok: false,
      active: false,
      error: "not configured",
    });
    expect(calls).toEqual([]);
  }
});

test("on desktop or outside Tauri purchases are unavailable even with store keys", async () => {
  for (const platform of ["macos", "windows", "linux", null]) {
    const { calls, purchases } = host({ platform, androidApiKey: "goog_test" });
    expect(purchases.purchasesAvailable()).toBe(false);
    await purchases.configurePurchases("user-1");
    expect(await purchases.buyLifetime()).toEqual({ ok: false, error: "unavailable" });
    expect(await purchases.restorePurchases()).toEqual({
      ok: false,
      active: false,
      error: "unavailable",
    });
    expect(calls).toEqual([]);
  }
});

test("iOS and Android use their own keys and the same product and entitlement", async () => {
  expect(LIFETIME_PRODUCT_ID).toBe("lumen.lifetime");
  expect(LIFETIME_ENTITLEMENT_ID).toBe("lifetime");
  for (const [platform, apiKey, expected] of [
    ["ios", "  appl_test  ", "appl_test"],
    ["android", "  appl_test  ", "goog_test"],
    ["android", "", "goog_test"],
  ]) {
    const { calls, purchases } = host({ platform, apiKey, androidApiKey: "  goog_test  " });
    expect(purchases.purchasesAvailable()).toBe(true);
    await purchases.configurePurchases("user-1");
    await purchases.buyLifetime();
    await purchases.restorePurchases();
    expect(calls).toEqual([
      { command: "plugin:purchases|configure", args: { apiKey: expected, appUserId: "user-1" } },
      { command: "plugin:purchases|buy_lifetime", args: { productId: LIFETIME_PRODUCT_ID } },
      { command: "plugin:purchases|restore", args: { entitlementId: LIFETIME_ENTITLEMENT_ID } },
    ]);
  }
});

test("a cancelled purchase comes back as cancelled, not as an error", async () => {
  const { purchases } = host({ answer: () => ({ ok: false, cancelled: true }) });
  expect(await purchases.buyLifetime()).toEqual({ ok: false, cancelled: true });
});

test("the plugin's answers are kept to the declared shape", async () => {
  const buy = host({ answer: () => ({ ok: "yes", error: "store down", extra: 1 }) });
  expect(await buy.purchases.buyLifetime()).toEqual({ ok: false, error: "store down" });

  const restored = host({ answer: () => ({ ok: true, active: true }) });
  expect(await restored.purchases.restorePurchases()).toEqual({ ok: true, active: true });

  const nothing = host({ answer: () => undefined });
  expect(await nothing.purchases.buyLifetime()).toEqual({ ok: false });
  expect(await nothing.purchases.restorePurchases()).toEqual({ ok: false, active: false });
});

test("a rejected invoke resolves with the rejection as the error", async () => {
  const { purchases } = host({
    answer: () => {
      throw new Error("command not found");
    },
  });
  await expect(purchases.configurePurchases("user-1")).resolves.toBeUndefined();
  expect(await purchases.buyLifetime()).toEqual({ ok: false, error: "command not found" });
  expect(await purchases.restorePurchases()).toEqual({
    ok: false,
    active: false,
    error: "command not found",
  });
});
