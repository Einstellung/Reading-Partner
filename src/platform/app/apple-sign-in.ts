// Sign in with Apple (docs/platform/713): run the native sheet and get back an
// Apple identity token plus the raw nonce, which the caller trades for a
// Supabase session with exchangeIdToken(..., { provider: "apple", nonce }).
//
// Native half: plugins/apple-sign-in (ASAuthorizationController on iOS, a
// fallback answering "unavailable" everywhere else). Dormant: while
// APPLE_SIGN_IN_ENABLED is false nothing here invokes the plugin. The steps to
// turn it on are in docs/platform/713.

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./host";

export const APPLE_SIGN_IN_ENABLED = false;

export interface AppleSignInResult {
  ok: boolean;
  // The Apple identity token (a JWT), when ok.
  idToken?: string;
  // The raw nonce whose SHA-256 went into the request, when ok. Supabase needs
  // it for the exchange.
  nonce?: string;
  // The user closed the sheet.
  cancelled?: boolean;
  // "unavailable" when this host has no native Apple sign-in or it is turned
  // off; otherwise a sentence.
  error?: string;
}

export interface AppleSignInDeps {
  enabled: boolean;
  isTauri: () => boolean;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  randomBytes: (n: number) => Uint8Array;
}

const DEFAULT_DEPS: AppleSignInDeps = {
  enabled: APPLE_SIGN_IN_ENABLED,
  isTauri,
  invoke: (cmd, args) => invoke(cmd, args),
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
};

const UNAVAILABLE: AppleSignInResult = { ok: false, error: "unavailable" };

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}

/**
 * Whether to offer Sign in with Apple. False while turned off, off iOS, in the
 * browser dev server, and when the probe fails.
 */
export async function appleSignInAvailable(deps: AppleSignInDeps = DEFAULT_DEPS): Promise<boolean> {
  if (!deps.enabled || !deps.isTauri()) return false;
  try {
    return (await deps.invoke("plugin:apple-sign-in|is_available")) === true;
  } catch {
    return false;
  }
}

/**
 * Show the Apple sign-in sheet. Never throws: a cancel is `cancelled: true`, a
 * failure is `error`. On success carries the identity token and the raw nonce.
 */
export async function signInWithApple(deps: AppleSignInDeps = DEFAULT_DEPS): Promise<AppleSignInResult> {
  if (!deps.enabled || !deps.isTauri()) return { ...UNAVAILABLE };
  const nonce = hex(deps.randomBytes(32));
  let raw: unknown;
  try {
    raw = await deps.invoke("plugin:apple-sign-in|sign_in", { nonce: await sha256Hex(nonce) });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.ok === true && typeof r.idToken === "string" && r.idToken) {
    return { ok: true, idToken: r.idToken, nonce };
  }
  if (r.cancelled === true) return { ok: false, cancelled: true };
  return { ok: false, error: typeof r.error === "string" && r.error ? r.error : "Apple sign-in failed." };
}
