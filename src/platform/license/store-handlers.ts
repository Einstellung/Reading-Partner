// Buy and Restore on the lock screen (docs/platform/713), through the in-app
// purchase plugin (platform/app/purchases). The store is told who is buying
// first, so the purchase lands on this Supabase user in RevenueCat. Whether it
// counts is the server's call: the gate re-checks the license afterwards.

import {
  buyLifetime,
  configurePurchases,
  restorePurchases,
} from "../app/purchases";
import type { PurchaseHandlers, PurchaseResult } from "./gate";

function fromStore(r: { ok: boolean; cancelled?: boolean; error?: string }): PurchaseResult {
  if (r.ok) return { ok: true };
  return { ok: false, error: r.cancelled ? "cancelled" : (r.error ?? "failed") };
}

export const purchaseHandlers: PurchaseHandlers = {
  buy: async (appUserId) => {
    await configurePurchases(appUserId);
    return fromStore(await buyLifetime());
  },
  restore: async (appUserId) => {
    await configurePurchases(appUserId);
    return fromStore(await restorePurchases());
  },
};
