// What a RevenueCat webhook event does to public.accounts (docs/platform/713),
// as plain TypeScript with no Deno or Supabase import, so the app's `bun test`
// runs it as it is (tests/supabase/).
//
// The app logs in to RevenueCat with the Supabase user id, so app_user_id is
// the accounts row's user_id. Only the lifetime product counts: a purchase of
// it grants, a refund or cancellation of it revokes, everything else is
// ignored (and answered 200 so RevenueCat does not retry it).

export type PurchaseChange =
  | { kind: "grant"; userId: string; purchasedAt: string; source: string }
  | { kind: "revoke"; userId: string }
  | { kind: "ignore"; reason: string };

const GRANT_TYPES = new Set(["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE"]);
const REVOKE_TYPES = new Set(["REFUND", "CANCELLATION"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RevenueCat sends the Authorization header exactly as configured in its
// dashboard. Compared without an early exit.
export function authorized(header: string | null, expected: string | undefined): boolean {
  if (!expected || header === null || header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// The store as purchase_source records it: "app_store", "play_store",
// "stripe", ... with " (sandbox)" for a sandbox purchase (TestFlight included).
export function purchaseSource(event: Record<string, unknown>): string {
  const store = typeof event.store === "string" ? event.store.toLowerCase() : "unknown";
  return event.environment === "SANDBOX" ? `${store} (sandbox)` : store;
}

export function mapRevenueCatEvent(body: unknown, lifetimeProductId: string | undefined): PurchaseChange {
  const event = (body as { event?: unknown } | null)?.event;
  if (!event || typeof event !== "object") return { kind: "ignore", reason: "no event" };
  const e = event as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : "";
  if (!GRANT_TYPES.has(type) && !REVOKE_TYPES.has(type)) return { kind: "ignore", reason: `type ${type}` };
  if (!lifetimeProductId || e.product_id !== lifetimeProductId) {
    return { kind: "ignore", reason: `product ${String(e.product_id)}` };
  }
  // An anonymous RevenueCat id ($RCAnonymousID:...) is not one of our users.
  const userId = typeof e.app_user_id === "string" ? e.app_user_id : "";
  if (!UUID.test(userId)) return { kind: "ignore", reason: `app_user_id ${userId}` };

  if (REVOKE_TYPES.has(type)) return { kind: "revoke", userId };
  const ms = typeof e.purchased_at_ms === "number" ? e.purchased_at_ms : typeof e.event_timestamp_ms === "number" ? e.event_timestamp_ms : null;
  if (ms === null || !Number.isFinite(ms)) return { kind: "ignore", reason: "no purchase time" };
  return {
    kind: "grant",
    userId,
    purchasedAt: new Date(ms).toISOString(),
    source: purchaseSource(e),
  };
}
