// Pure OAuth primitives shared by every authorization-code flow in the app (the
// two AI provider logins and Google Drive sync). Only the parts that are
// genuinely identical live here — the flows themselves differ in authorize
// params, token-endpoint encoding, state semantics and expiry skew, so each
// keeps its own body.

export function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

// Accepts a bare code, `code#state`, `code=…&state=…`, or the full redirect URL.
export function parseManualInput(input: string): { code: string; state?: string } {
  const value = input.trim();
  try {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    if (code) return { code, state: url.searchParams.get("state") ?? undefined };
  } catch {
    // not a URL
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    const code = params.get("code");
    if (code) return { code, state: params.get("state") ?? undefined };
  }
  return { code: value };
}
