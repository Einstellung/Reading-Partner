// The license-status answer (docs/platform/713), as plain TypeScript with no
// Deno or Supabase import, so the app's `bun test` runs it as it is
// (tests/supabase/). The client's reading of it is src/platform/license.

export type LicenseStatus = "open" | "trial" | "purchased" | "expired" | "banned";

export interface AccountRow {
  trial_started_at: string;
  purchased_at: string | null;
  banned: boolean;
}

export interface LicensePayload {
  v: 1;
  userId: string;
  status: LicenseStatus;
  // ISO 8601. The client also accepts null, which nothing here sends.
  trialEndsAt: string | null;
  issuedAt: string;
}

export const TRIAL_MONTHS = 3;

// start + months, the way Postgres adds `interval '3 months'`: the same day of
// the month, clamped to the last day of a shorter month (Nov 30 + 3 months is
// Feb 28 or 29), time of day kept. In UTC, as timestamptz arithmetic is.
export function addMonths(start: Date, months: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(start.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}

export function trialEndsAt(account: AccountRow): Date {
  return addMonths(new Date(account.trial_started_at), TRIAL_MONTHS);
}

// The server switch, public.app_config's licensing_enforced. Only a JSON true
// turns it on.
export function isEnforced(value: unknown): boolean {
  return value === true;
}

// What the caller's account amounts to now. Not enforced: always open, so no
// client locks anyone while the server switch is off. Enforced: banned wins,
// then a purchase, then the trial clock. No row yet (the trigger writes one on
// sign-up, so this is a gap rather than a state) is a trial starting now.
export function decideStatus(account: AccountRow | null, enforced: boolean, now: Date): LicenseStatus {
  if (!enforced) return "open";
  if (!account) return "trial";
  if (account.banned) return "banned";
  if (account.purchased_at) return "purchased";
  return now.getTime() < trialEndsAt(account).getTime() ? "trial" : "expired";
}

export function buildPayload(
  userId: string,
  account: AccountRow | null,
  enforced: boolean,
  now: Date,
): LicensePayload {
  return {
    v: 1,
    userId,
    status: decideStatus(account, enforced, now),
    trialEndsAt: (account ? trialEndsAt(account) : addMonths(now, TRIAL_MONTHS)).toISOString(),
    issuedAt: now.toISOString(),
  };
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The private key from LICENSE_SIGNING_KEY (a JWK, as scripts/license-keygen.ts
// prints it).
export function importSigningKey(jwkText: string, subtle: SubtleCrypto): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkText) as JsonWebKey;
  return subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export interface SignedLicense {
  payload: string;
  signature: string;
}

// The payload as JSON text and an ECDSA P-256 / SHA-256 signature over its
// UTF-8 bytes (IEEE P1363, base64url). The client verifies the text it is
// given, so no canonical form is needed.
export async function signPayload(
  payload: LicensePayload,
  key: CryptoKey,
  subtle: SubtleCrypto,
): Promise<SignedLicense> {
  const text = JSON.stringify(payload);
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(text),
  );
  return { payload: text, signature: bytesToBase64Url(new Uint8Array(signature)) };
}
