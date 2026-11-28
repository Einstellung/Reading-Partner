// The license-status function's answer (supabase/functions/license-status):
// a JSON payload, kept as the exact text the server signed, and an ECDSA P-256
// / SHA-256 signature over its UTF-8 bytes in IEEE P1363 form (r || s, 64
// bytes), base64url. WebCrypto produces and checks that form on both ends,
// WKWebView and WebView2 included.

export type LicenseStatus = "open" | "trial" | "purchased" | "expired" | "banned";

const STATUSES: readonly LicenseStatus[] = ["open", "trial", "purchased", "expired", "banned"];

export interface LicensePayload {
  v: 1;
  userId: string;
  status: LicenseStatus;
  // Epoch ms; null when the server did not state one.
  trialEndsAt: number | null;
  // Epoch ms, the server's clock when it answered.
  issuedAt: number;
}

export interface SignedLicense {
  // The payload's JSON text, byte for byte what was signed.
  payload: string;
  signature: string;
}

function isoMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// The payload text as a payload, or null when any field is missing or wrong.
export function parsePayload(text: string): LicensePayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (typeof r.userId !== "string" || !r.userId) return null;
  if (!STATUSES.includes(r.status as LicenseStatus)) return null;
  const issuedAt = isoMs(r.issuedAt);
  if (issuedAt === null) return null;
  if (r.trialEndsAt !== null && r.trialEndsAt !== undefined && isoMs(r.trialEndsAt) === null) return null;
  return {
    v: 1,
    userId: r.userId,
    status: r.status as LicenseStatus,
    trialEndsAt: isoMs(r.trialEndsAt),
    issuedAt,
  };
}

export function parseSignedLicense(raw: unknown): SignedLicense | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.payload !== "string" || typeof r.signature !== "string") return null;
  return { payload: r.payload, signature: r.signature };
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// The payload, when the signature over it checks out under the key. Null for a
// bad signature, a key that will not import, or a payload that does not parse.
// Never throws.
export async function verifySignedLicense(
  signed: SignedLicense,
  publicKey: JsonWebKey,
  subtle: SubtleCrypto,
): Promise<LicensePayload | null> {
  try {
    const signature = base64UrlToBytes(signed.signature);
    if (!signature || signature.length !== 64) return null;
    const key = await subtle.importKey(
      "jwk",
      publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      new TextEncoder().encode(signed.payload),
    );
    return ok ? parsePayload(signed.payload) : null;
  } catch {
    return null;
  }
}
