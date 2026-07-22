// Google OAuth (Desktop): authorization code + PKCE over a loopback redirect.
// Reuses the Rust one-shot callback listener that Anthropic login already uses
// (oauth_callback.rs, invoked as start_oauth_callback_listener) — same fixed
// loopback port, matched on `state` — so there is no second loopback mechanism
// to maintain. Tokens live in AppData/sync-auth.json, which is deliberately NOT
// in the sync range (local device credential; see syncFs.ts).
//
// access token is short-lived and refreshed from the refresh token when within
// the expiry skew. A refresh that fails with invalid_grant (user revoked access,
// or the 7-day testing-mode refresh expiry) clears the stored tokens and throws
// GoogleAuthError so the engine can drop to a signed-out state and prompt for
// re-login (docs/13).

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { cleanTauriFetch } from "../tauri-fetch";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES,
  isGoogleConfigured,
} from "./googleConfig";

const AUTH_FILE = "sync-auth.json";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// Refresh this long before the real expiry so an in-flight request never races
// the boundary.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export class GoogleAuthError extends Error {}

export interface GoogleAuth {
  access: string;
  refresh: string;
  expires: number; // epoch ms, already skew-adjusted
  email: string | null;
}

// --- storage ---------------------------------------------------------------

export async function loadAuth(): Promise<GoogleAuth | null> {
  try {
    if (!(await exists(AUTH_FILE, { baseDir: BaseDirectory.AppData }))) return null;
    return JSON.parse(await readTextFile(AUTH_FILE, { baseDir: BaseDirectory.AppData })) as GoogleAuth;
  } catch {
    return null;
  }
}

async function saveAuth(auth: GoogleAuth): Promise<void> {
  await writeTextFile(AUTH_FILE, JSON.stringify(auth, null, 2), { baseDir: BaseDirectory.AppData });
}

async function clearAuth(): Promise<void> {
  await saveAuth({ access: "", refresh: "", expires: 0, email: null }).catch(() => {});
}

export async function isSignedIn(): Promise<boolean> {
  const a = await loadAuth();
  return !!a && !!a.refresh;
}

export async function currentEmail(): Promise<string | null> {
  return (await loadAuth())?.email ?? null;
}

// --- PKCE ------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

// Pull the email claim out of an OIDC id_token without verifying the signature —
// it is only used for display, never for authorization. Pure and unit-tested.
export function parseIdTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload + "=".repeat((4 - (payload.length % 4)) % 4));
    const claims = JSON.parse(json) as { email?: string };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

// --- login -----------------------------------------------------------------

function buildAuthUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: "code",
    redirect_uri: GOOGLE_REDIRECT_URI,
    scope: GOOGLE_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    // Force a refresh token every time (Google only returns one with consent).
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await cleanTauriFetch(TOKEN_URL, {
    method: "POST",
    // Origin "" makes the http plugin drop the header (unsafe-headers,
    // pitfall 15); Google's token endpoint has no reason to see a webview origin.
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    // invalid_grant on a refresh means the refresh token is dead (revoked or
    // expired) — the caller turns this into a signed-out state.
    if (text.includes("invalid_grant")) throw new GoogleAuthError("invalid_grant");
    throw new Error(`Google token request failed (HTTP ${res.status}): ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

export async function signIn(): Promise<void> {
  if (!isGoogleConfigured()) throw new Error("Google client not configured");
  const { verifier, challenge } = await generatePKCE();
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

  // Bind the listener before opening the browser (it binds synchronously).
  // Port/path come from the registered redirect URI (127.0.0.1:53692/callback).
  const redirect = new URL(GOOGLE_REDIRECT_URI);
  const listener = invoke<{ code: string; state: string }>("start_oauth_callback_listener", {
    expectedState: state,
    port: Number(redirect.port),
    path: redirect.pathname,
  });
  await openUrl(buildAuthUrl(challenge, state));

  let code: string;
  try {
    ({ code } = await listener);
  } catch (e) {
    throw new Error(`Google sign-in could not capture the redirect: ${e instanceof Error ? e.message : String(e)}`);
  }

  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_REDIRECT_URI,
    code_verifier: verifier,
  });
  if (!token.refresh_token) {
    throw new Error("Google did not return a refresh token; try removing the app under myaccount.google.com and signing in again.");
  }
  await saveAuth({
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000 - EXPIRY_SKEW_MS,
    email: parseIdTokenEmail(token.id_token),
  });
}

export async function signOut(): Promise<void> {
  await clearAuth();
}

// Returns a usable access token, refreshing (and persisting) when the stored one
// is within the expiry skew. Throws GoogleAuthError when not signed in or when
// the refresh token is dead (after clearing the stored credentials).
export async function getAccessToken(): Promise<string> {
  const auth = await loadAuth();
  if (!auth || !auth.refresh) throw new GoogleAuthError("not signed in");
  if (Date.now() < auth.expires && auth.access) return auth.access;

  let token: TokenResponse;
  try {
    token = await tokenRequest({
      grant_type: "refresh_token",
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: auth.refresh,
    });
  } catch (e) {
    if (e instanceof GoogleAuthError) {
      await clearAuth();
      throw e;
    }
    throw e;
  }
  const next: GoogleAuth = {
    access: token.access_token,
    // A refresh response usually omits refresh_token; keep the existing one.
    refresh: token.refresh_token ?? auth.refresh,
    expires: Date.now() + token.expires_in * 1000 - EXPIRY_SKEW_MS,
    email: parseIdTokenEmail(token.id_token) ?? auth.email,
  };
  await saveAuth(next);
  return next.access;
}
