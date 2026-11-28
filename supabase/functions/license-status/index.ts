// license-status (docs/platform/713): the caller's license, signed.
//
// POST with the app's publishable key as `apikey` and the user's access token
// as `Authorization: Bearer`. Answers { payload, signature }: payload is the
// JSON text of { v, userId, status, trialEndsAt, issuedAt }, signature an
// ECDSA P-256 / SHA-256 signature over it with LICENSE_SIGNING_KEY (a private
// JWK). While app_config.licensing_enforced is not true the status is always
// "open".

import { buildPayload, importSigningKey, isEnforced, signPayload, type AccountRow } from "../_shared/license.ts";
import { callerId, json, serviceClient } from "../_shared/deno.ts";

let signingKey: Promise<CryptoKey> | null = null;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const keyText = Deno.env.get("LICENSE_SIGNING_KEY");
  if (!keyText) return json({ error: "signing key not configured" }, 500);

  const admin = serviceClient();
  const userId = await callerId(req, admin);
  if (!userId) return json({ error: "not signed in" }, 401);

  const config = await admin
    .from("app_config")
    .select("value")
    .eq("key", "licensing_enforced")
    .maybeSingle();
  if (config.error) return json({ error: "config unreadable" }, 500);
  const enforced = isEnforced(config.data?.value);

  // The trigger writes the row on sign-up; a user from before it gets one now.
  await admin.from("accounts").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const account = await admin
    .from("accounts")
    .select("trial_started_at, purchased_at, banned")
    .eq("user_id", userId)
    .maybeSingle();
  if (account.error) return json({ error: "account unreadable" }, 500);

  signingKey ??= importSigningKey(keyText, crypto.subtle);
  const payload = buildPayload(userId, (account.data as AccountRow | null) ?? null, enforced, new Date());
  return json(await signPayload(payload, await signingKey, crypto.subtle));
});
