// stripe-webhook (docs/platform/713): Stripe tells us about web checkout
// purchases from the desktop and the Android APK.
//
// Deployed with --no-verify-jwt: Stripe signs the raw body instead, checked
// here against STRIPE_WEBHOOK_SECRET (the endpoint's whsec_ secret). A paid
// checkout.session.completed whose client_reference_id is a user id sets
// accounts.purchased_at, purchase_source and purchase_ref (the payment
// intent); a full refund (charge.refunded) clears the account holding that
// ref. Replays are harmless: a grant only fills an empty purchased_at, a
// revoke only clears.

import { mapStripeEvent, verifyStripeSignature } from "../_shared/stripe.ts";
import { json, serviceClient } from "../_shared/deno.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // The signature is over the exact bytes sent, so read the text before
  // parsing it.
  const raw = await req.text();
  const ok = await verifyStripeSignature(
    raw,
    req.headers.get("Stripe-Signature"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET"),
    Math.floor(Date.now() / 1000),
    crypto.subtle,
  );
  if (!ok) return json({ error: "bad signature" }, 400);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad body" }, 400);
  }

  const change = mapStripeEvent(body);
  if (change.kind === "ignore") return json({ ignored: change.reason });

  const admin = serviceClient();
  const result =
    change.kind === "grant"
      ? await admin
          .from("accounts")
          .update({
            purchased_at: change.purchasedAt,
            purchase_source: change.source,
            purchase_ref: change.ref,
          })
          .eq("user_id", change.userId)
          .is("purchased_at", null)
      : await admin
          .from("accounts")
          .update({ purchased_at: null, purchase_source: null, purchase_ref: null })
          .eq("purchase_ref", change.ref);
  // A failure is answered 500 so Stripe retries it.
  if (result.error) return json({ error: "update failed" }, 500);
  return json({ applied: change.kind });
});
