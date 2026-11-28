// Stripe web checkout (docs/platform/713): the webhook's signature check and
// what an event does to public.accounts, as plain TypeScript with no Deno or
// Supabase import, so the app's `bun test` runs it as it is (tests/supabase/).
//
// The app opens a Payment Link with client_reference_id = the Supabase user
// id. A paid checkout.session.completed grants the lifetime unlock and keeps
// the payment intent as purchase_ref; a fully refunded charge.refunded finds
// the account by that ref and revokes it. Everything else is ignored (and
// answered 200 so Stripe does not retry it).

// Stripe's libraries default to the same tolerance.
export const SIGNATURE_TOLERANCE_S = 5 * 60;

// The Stripe-Signature header: `t=<unix seconds>,v1=<hex>,...`. Entries other
// than t and v1 (v0, debug metadata) are ignored; several v1 entries appear
// while a rolled secret is still active.
export function parseSignatureHeader(header: string | null): { t: number; v1: string[] } | null {
  if (!header) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) t = Number(value);
    else if (key === "v1" && value) v1.push(value);
  }
  return t === null || v1.length === 0 ? null : { t, v1 };
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// Compared without an early exit on the first differing character.
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The HMAC-SHA256 hex digest Stripe signs with: the endpoint secret (the whole
// `whsec_...` string) as the key, `${t}.${rawBody}` as the message.
export async function stripeSignature(
  secret: string,
  t: number,
  rawBody: string,
  subtle: SubtleCrypto,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return hex(new Uint8Array(await subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`))));
}

// True when one v1 signature matches the raw body and the signing time is no
// older than the tolerance. An unset secret lets nothing in.
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
  nowSeconds: number,
  subtle: SubtleCrypto,
  toleranceSeconds: number = SIGNATURE_TOLERANCE_S,
): Promise<boolean> {
  if (!secret) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const expected = await stripeSignature(secret, parsed.t, rawBody, subtle);
  const matched = parsed.v1.reduce((any, sig) => sameString(sig, expected) || any, false);
  if (!matched) return false;
  return nowSeconds - parsed.t <= toleranceSeconds;
}

export type StripeChange =
  | { kind: "grant"; userId: string; purchasedAt: string; source: string; ref: string }
  | { kind: "revoke"; ref: string }
  | { kind: "ignore"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The payment intent's id, whether the event carries it as a string or, with
// an expanded API version, as the object.
function intentId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  const id = (value as { id?: unknown } | null)?.id;
  return typeof id === "string" && id ? id : null;
}

// purchase_source: "stripe", or "stripe (test)" for a test-mode event, as a
// RevenueCat sandbox purchase says "(sandbox)".
export function stripeSource(event: Record<string, unknown>): string {
  return event.livemode === false ? "stripe (test)" : "stripe";
}

export function mapStripeEvent(body: unknown): StripeChange {
  if (!body || typeof body !== "object") return { kind: "ignore", reason: "no event" };
  const e = body as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : "";
  const object = (e.data as { object?: unknown } | null | undefined)?.object;
  if (!object || typeof object !== "object") return { kind: "ignore", reason: `no object in ${type}` };
  const o = object as Record<string, unknown>;

  if (type === "checkout.session.completed") {
    if (o.payment_status !== "paid") return { kind: "ignore", reason: `payment_status ${String(o.payment_status)}` };
    const userId = typeof o.client_reference_id === "string" ? o.client_reference_id : "";
    if (!UUID.test(userId)) return { kind: "ignore", reason: `client_reference_id ${userId}` };
    const ref = intentId(o.payment_intent);
    if (!ref) return { kind: "ignore", reason: "no payment_intent" };
    // The event's time is when the checkout completed; the session's own
    // `created` is when it was opened.
    const seconds = typeof e.created === "number" ? e.created : typeof o.created === "number" ? o.created : null;
    if (seconds === null || !Number.isFinite(seconds)) return { kind: "ignore", reason: "no purchase time" };
    return {
      kind: "grant",
      userId,
      purchasedAt: new Date(seconds * 1000).toISOString(),
      source: stripeSource(e),
      ref,
    };
  }

  if (type === "charge.refunded") {
    // `refunded` is true only once the whole amount is back; a partial refund
    // leaves the purchase standing.
    if (o.refunded !== true) return { kind: "ignore", reason: "partial refund" };
    const ref = intentId(o.payment_intent);
    if (!ref) return { kind: "ignore", reason: "no payment_intent" };
    return { kind: "revoke", ref };
  }

  return { kind: "ignore", reason: `type ${type}` };
}
