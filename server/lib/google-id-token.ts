// Verifies a Google OIDC id_token: RS256 signature against Google's published
// keys, issuer, expiry, and an audience that is one of our OAuth clients. Plain
// WebCrypto, so it needs no dependency and runs the same under bun and Node.

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  name: string | null;
}

export interface Jwk extends JsonWebKey {
  kid?: string;
}

function decodeSegment(segment: string): Uint8Array<ArrayBuffer> {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(decodeSegment(segment)));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function audienceMatches(aud: unknown, audiences: readonly string[]): boolean {
  if (typeof aud === "string") return audiences.includes(aud);
  if (Array.isArray(aud)) return aud.some((a) => typeof a === "string" && audiences.includes(a));
  return false;
}

// The identity in the token, or null when any check fails.
export async function verifyGoogleIdToken(
  token: string,
  opts: { audiences: readonly string[]; keys: () => Promise<Jwk[]>; now: number },
): Promise<GoogleIdentity | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const jwk = (await opts.keys()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  let valid: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeSegment(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return null;
  if (!audienceMatches(claims.aud, opts.audiences)) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= opts.now) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;

  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    name: typeof claims.name === "string" ? claims.name : null,
  };
}

export async function fetchGoogleKeys(): Promise<Jwk[]> {
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`Google JWKS request failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
}
