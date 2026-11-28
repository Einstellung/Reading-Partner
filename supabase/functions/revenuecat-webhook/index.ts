// revenuecat-webhook (docs/platform/713): RevenueCat tells us about purchases.
//
// Deployed with --no-verify-jwt: RevenueCat sends its own Authorization
// header, checked here against REVENUECAT_WEBHOOK_AUTH. A purchase of
// LIFETIME_PRODUCT_ID sets accounts.purchased_at and purchase_source; a refund
// or cancellation of it clears them. Replays are harmless: a grant only fills
// an empty purchased_at, a revoke only clears.

import { authorized, mapRevenueCatEvent } from "../_shared/revenuecat.ts";
import { json, serviceClient } from "../_shared/deno.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!authorized(req.headers.get("Authorization"), Deno.env.get("REVENUECAT_WEBHOOK_AUTH"))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad body" }, 400);
  }

  const change = mapRevenueCatEvent(body, Deno.env.get("LIFETIME_PRODUCT_ID"));
  if (change.kind === "ignore") return json({ ignored: change.reason });

  const admin = serviceClient();
  const result =
    change.kind === "grant"
      ? await admin
          .from("accounts")
          .update({ purchased_at: change.purchasedAt, purchase_source: change.source })
          .eq("user_id", change.userId)
          .is("purchased_at", null)
      : await admin
          .from("accounts")
          .update({ purchased_at: null, purchase_source: null })
          .eq("user_id", change.userId);
  // A failure is answered 500 so RevenueCat retries it.
  if (result.error) return json({ error: "update failed" }, 500);
  return json({ applied: change.kind });
});
