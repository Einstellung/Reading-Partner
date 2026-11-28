// The RevenueCat webhook's event mapping (supabase/functions/_shared/revenuecat.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  authorized,
  mapRevenueCatEvent,
  purchaseSource,
} from "../../supabase/functions/_shared/revenuecat.ts";

const PRODUCT = "lumen_lifetime";
const USER = "0b6f3a52-6a8e-4c43-9a43-8b2d3f3b1c11";
const AT = Date.UTC(2027, 1, 1, 12);

function body(over: Record<string, unknown> = {}) {
  return {
    api_version: "1.0",
    event: {
      type: "NON_RENEWING_PURCHASE",
      app_user_id: USER,
      product_id: PRODUCT,
      purchased_at_ms: AT,
      store: "APP_STORE",
      environment: "PRODUCTION",
      ...over,
    },
  };
}

test("a purchase of the lifetime product grants", () => {
  for (const type of ["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE"]) {
    expect(mapRevenueCatEvent(body({ type }), PRODUCT)).toEqual({
      kind: "grant",
      userId: USER,
      purchasedAt: new Date(AT).toISOString(),
      source: "app_store",
    });
  }
});

test("a sandbox purchase says so in the source", () => {
  expect(purchaseSource({ store: "PLAY_STORE", environment: "SANDBOX" })).toBe("play_store (sandbox)");
});

test("a refund or cancellation of it revokes", () => {
  for (const type of ["REFUND", "CANCELLATION"]) {
    expect(mapRevenueCatEvent(body({ type }), PRODUCT)).toEqual({ kind: "revoke", userId: USER });
  }
});

test("everything else is ignored", () => {
  const ignored = (b: unknown, product: string | undefined = PRODUCT) =>
    mapRevenueCatEvent(b, product).kind;
  expect(ignored(body({ type: "RENEWAL" }))).toBe("ignore");
  expect(ignored(body({ type: "TEST" }))).toBe("ignore");
  expect(ignored(body({ product_id: "lumen_trial" }))).toBe("ignore");
  expect(mapRevenueCatEvent(body(), undefined).kind).toBe("ignore");
  expect(ignored(body({ app_user_id: "$RCAnonymousID:abc" }))).toBe("ignore");
  expect(ignored(body({ purchased_at_ms: undefined }))).toBe("ignore");
  expect(ignored({})).toBe("ignore");
  expect(ignored(null)).toBe("ignore");
});

test("the same event mapped twice is the same change", () => {
  expect(mapRevenueCatEvent(body(), PRODUCT)).toEqual(mapRevenueCatEvent(body(), PRODUCT));
});

test("the Authorization header must match the secret exactly", () => {
  expect(authorized("Bearer s3cret", "Bearer s3cret")).toBe(true);
  expect(authorized("Bearer s3creT", "Bearer s3cret")).toBe(false);
  expect(authorized("Bearer s3cret ", "Bearer s3cret")).toBe(false);
  expect(authorized(null, "Bearer s3cret")).toBe(false);
  // An unset secret lets nothing in.
  expect(authorized("", undefined)).toBe(false);
  expect(authorized("", "")).toBe(false);
});
