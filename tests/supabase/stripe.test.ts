// The Stripe webhook's signature check and event mapping
// (supabase/functions/_shared/stripe.ts). Run: bun test.

import { createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import {
  mapStripeEvent,
  parseSignatureHeader,
  stripeSignature,
  verifyStripeSignature,
} from "../../supabase/functions/_shared/stripe.ts";

const SECRET = "whsec_test_9f8e7d6c5b4a";
const USER = "0b6f3a52-6a8e-4c43-9a43-8b2d3f3b1c11";
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });

// An independent HMAC, the way Stripe's own libraries compute it.
const sign = (t: number, body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");

const verify = (body: string, header: string | null, ...secret: [string | undefined] | []) =>
  verifyStripeSignature(body, header, secret.length ? secret[0] : SECRET, NOW, crypto.subtle);

test("the digest matches an independent HMAC-SHA256", async () => {
  expect(await stripeSignature(SECRET, NOW, BODY, crypto.subtle)).toBe(sign(NOW, BODY));
});

test("a good signature passes", async () => {
  expect(await verify(BODY, `t=${NOW},v1=${sign(NOW, BODY)}`)).toBe(true);
  // Unknown entries, a v0 and a second (rolled) v1 in any order.
  const header = `t=${NOW},v0=${"0".repeat(64)},v1=${"a".repeat(64)},v1=${sign(NOW, BODY)},secret=whsec_****,payload=ab12`;
  expect(await verify(BODY, header)).toBe(true);
});

test("a tampered body, timestamp or signature fails", async () => {
  const good = sign(NOW, BODY);
  expect(await verify(BODY.replace("evt_1", "evt_2"), `t=${NOW},v1=${good}`)).toBe(false);
  expect(await verify(BODY, `t=${NOW + 1},v1=${good}`)).toBe(false);
  expect(await verify(BODY, `t=${NOW},v1=${good.slice(0, -1)}0`)).toBe(false);
  expect(await verify(BODY, `t=${NOW},v1=${sign(NOW, BODY, "whsec_other")}`)).toBe(false);
  // Only v1 counts.
  expect(await verify(BODY, `t=${NOW},v0=${good}`)).toBe(false);
});

test("a signature older than five minutes fails", async () => {
  const t = NOW - 5 * 60;
  expect(await verify(BODY, `t=${t},v1=${sign(t, BODY)}`)).toBe(true);
  const stale = t - 1;
  expect(await verify(BODY, `t=${stale},v1=${sign(stale, BODY)}`)).toBe(false);
});

test("no header, a broken header or no secret lets nothing in", async () => {
  const header = `t=${NOW},v1=${sign(NOW, BODY)}`;
  expect(await verify(BODY, null)).toBe(false);
  expect(await verify(BODY, "garbage")).toBe(false);
  expect(await verify(BODY, `v1=${sign(NOW, BODY)}`)).toBe(false);
  expect(await verify(BODY, header, undefined)).toBe(false);
  expect(await verify(BODY, header, "")).toBe(false);
  expect(parseSignatureHeader(`t=${NOW}`)).toBeNull();
});

function completed(over: Record<string, unknown> = {}, event: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    created: NOW,
    livemode: true,
    data: {
      object: {
        object: "checkout.session",
        created: NOW - 120,
        mode: "payment",
        payment_status: "paid",
        client_reference_id: USER,
        payment_intent: "pi_123",
        ...over,
      },
    },
    ...event,
  };
}

function refunded(over: Record<string, unknown> = {}) {
  return {
    id: "evt_2",
    type: "charge.refunded",
    created: NOW + 3600,
    livemode: true,
    data: { object: { object: "charge", refunded: true, payment_intent: "pi_123", ...over } },
  };
}

test("a paid checkout grants the user named in client_reference_id", () => {
  expect(mapStripeEvent(completed())).toEqual({
    kind: "grant",
    userId: USER,
    purchasedAt: new Date(NOW * 1000).toISOString(),
    source: "stripe",
    ref: "pi_123",
  });
  // An expanded payment intent gives the same ref.
  expect(mapStripeEvent(completed({ payment_intent: { id: "pi_123" } }))).toMatchObject({ ref: "pi_123" });
});

test("a test-mode checkout says so in the source", () => {
  expect(mapStripeEvent(completed({}, { livemode: false }))).toMatchObject({ source: "stripe (test)" });
});

test("a checkout that is unpaid, anonymous or has no payment is ignored", () => {
  const kind = (b: unknown) => mapStripeEvent(b).kind;
  expect(kind(completed({ payment_status: "unpaid" }))).toBe("ignore");
  expect(kind(completed({ payment_status: "no_payment_required" }))).toBe("ignore");
  expect(kind(completed({ client_reference_id: null }))).toBe("ignore");
  expect(kind(completed({ client_reference_id: "someone" }))).toBe("ignore");
  expect(kind(completed({ payment_intent: null }))).toBe("ignore");
});

test("a full refund revokes by the payment intent; a partial one does not", () => {
  expect(mapStripeEvent(refunded())).toEqual({ kind: "revoke", ref: "pi_123" });
  expect(mapStripeEvent(refunded({ refunded: false, amount_refunded: 300 })).kind).toBe("ignore");
  expect(mapStripeEvent(refunded({ payment_intent: null })).kind).toBe("ignore");
});

test("other events and junk are ignored", () => {
  const kind = (b: unknown) => mapStripeEvent(b).kind;
  expect(kind({ ...completed(), type: "checkout.session.expired" })).toBe("ignore");
  expect(kind({ ...completed(), type: "payment_intent.succeeded" })).toBe("ignore");
  expect(kind({ type: "checkout.session.completed" })).toBe("ignore");
  expect(kind({})).toBe("ignore");
  expect(kind(null)).toBe("ignore");
});

test("the same event mapped twice is the same change", () => {
  expect(mapStripeEvent(completed())).toEqual(mapStripeEvent(completed()));
  expect(mapStripeEvent(refunded())).toEqual(mapStripeEvent(refunded()));
});
