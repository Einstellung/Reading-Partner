// Google OAuth: authorization code + PKCE, forked by platform in signIn().
//
// Desktop (macOS/Windows/Linux): loopback redirect captured by the Rust one-shot
// listener that Anthropic login already uses (oauth_callback.rs, invoked as
// start_oauth_callback_listener) — same fixed port, matched on `state`. Sends a
// client_secret alongside PKCE (Desktop client requirement; the secret is not
// confidential, PKCE protects the exchange).
//
// iOS: reverse-DNS custom-scheme redirect captured by tauri-plugin-deep-link. No
// client_secret (public iOS client, PKCE-only). The consent screen is opened in
// the system browser via openUrl — never an embedded webview, which Google blocks
// (disallowed_useragent). The redirect scheme is registered in tauri.conf.json
// (deep-link plugin generates the Info.plist CFBundleURLTypes at iOS build time).
//
// Tokens live in AppData/sync-auth.json, deliberately NOT in the sync range
// (local device credential; see syncFs.ts). The access token is short-lived and
// refreshed from the refresh token within the expiry skew; a refresh that fails
// with invalid_grant clears the stored tokens and throws GoogleAuthError so the
// engine drops to signed-out and prompts for re-login (docs/13).

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { cleanTauriFetch } from "../app/tauri-fetch";
import { activeAuthFlow, AUTHORIZE_URL, GOOGLE_SCOPES, TOKEN_URL } from "./googleConfig";
import {
  authCodeBody,
  buildAuthUrl,
  matchesRedirect,
  parseCallbackParams,
  refreshBody,
  type AuthFlow,
} from "./authFlow";

const AUTH_FILE = "sync-auth.json";
// Refresh this long before the real expiry so an in-flight request never races
// the boundary.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
// How long to wait for the iOS deep-link redirect before giving up.
const DEEP_LINK_TIMEOUT_MS = 5 * 60 * 1000;

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

// --- token endpoint --------------------------------------------------------

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

function requireFlow(): AuthFlow {
  const flow = activeAuthFlow();
  if (!flow) throw new Error("Google client not configured");
  return flow;
}

// --- login: desktop loopback -----------------------------------------------

async function captureLoopbackCode(flow: AuthFlow, challenge: string, state: string): Promise<string> {
  // Bind the listener before opening the browser (it binds synchronously).
  // Port/path come from the registered redirect URI (127.0.0.1:53692/callback).
  const redirect = new URL(flow.redirectUri);
  const listener = invoke<{ code: string; state: string }>("start_oauth_callback_listener", {
    expectedState: state,
    port: Number(redirect.port),
    path: redirect.pathname,
  });
  await openUrl(buildAuthUrl(AUTHORIZE_URL, flow, GOOGLE_SCOPES, challenge, state));
  try {
    return (await listener).code;
  } catch (e) {
    throw new Error(`Google sign-in could not capture the redirect: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// --- login: iOS custom scheme ----------------------------------------------

// Resolve the authorization code from a deep-link redirect URL, validating that
// it is our scheme and that the returned state matches. Pure branch is in
// authFlow (matchesRedirect / parseCallbackParams); this only threads the
// pending state.
function codeFromRedirect(url: string, flow: AuthFlow, expectedState: string): string | null {
  if (!matchesRedirect(url, flow.redirectUri)) return null;
  const { code, state, error } = parseCallbackParams(url);
  if (error) throw new Error(`Google authorization error: ${error}`);
  if (!code || state !== expectedState) return null;
  return code;
}

async function captureSchemeCode(flow: AuthFlow, challenge: string, state: string): Promise<string> {
  let resolve!: (code: string) => void;
  let reject!: (err: unknown) => void;
  const pending = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const tryUrl = (url: string): boolean => {
    try {
      const code = codeFromRedirect(url, flow, state);
      if (code) {
        resolve(code);
        return true;
      }
    } catch (e) {
      reject(e);
      return true;
    }
    return false;
  };

  // Register the running-app listener before opening the browser so no redirect
  // is missed. Also drain getCurrent() in case a cold-start URL is already queued.
  const unlisten = await onOpenUrl((urls) => {
    for (const url of urls) if (tryUrl(url)) break;
  });
  try {
    const start = await getCurrent().catch(() => null);
    if (start) for (const url of start) if (tryUrl(url)) break;

    await openUrl(buildAuthUrl(AUTHORIZE_URL, flow, GOOGLE_SCOPES, challenge, state));

    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("Google sign-in timed out waiting for the redirect")), DEEP_LINK_TIMEOUT_MS),
    );
    return await Promise.race([pending, timeout]);
  } finally {
    unlisten();
  }
}

// --- login -----------------------------------------------------------------

export async function signIn(): Promise<void> {
  const flow = requireFlow();
  const { verifier, challenge } = await generatePKCE();
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

  const code =
    flow.kind === "ios-scheme"
      ? await captureSchemeCode(flow, challenge, state)
      : await captureLoopbackCode(flow, challenge, state);

  const token = await tokenRequest(authCodeBody(flow, code, verifier));
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

  const flow = requireFlow();
  let token: TokenResponse;
  try {
    token = await tokenRequest(refreshBody(flow, auth.refresh));
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
