// Google OAuth client credentials, read from Vite env at build time. Empty by
// default: the Google Cloud OAuth clients are provisioned separately (docs/13).
// When the running platform's client is unset, the Settings page shows "Google
// client not configured" and disables the button.
//
// Desktop (macOS/Windows/Linux): a "Desktop" OAuth client. VITE_GOOGLE_CLIENT_ID
// + VITE_GOOGLE_CLIENT_SECRET. The secret is present because Google's installed-
// app token endpoint still requires it alongside PKCE; for a Desktop client this
// value is not confidential (it ships in every binary), PKCE is the real
// protection.
//
// iOS: an "iOS" OAuth client. VITE_GOOGLE_IOS_CLIENT_ID only — no secret (public
// client, PKCE-only). The redirect is the client's reverse-DNS custom scheme,
// which must ALSO be registered statically in tauri.conf.json > plugins >
// deep-link > mobile (the Info.plist CFBundleURLTypes are generated from there at
// iOS build time; it cannot be injected from this env var). Keep the two in sync.

import { platform } from "@tauri-apps/plugin-os";
import { iosRedirectUri, selectAuthFlow, type AuthEnv, type AuthFlow } from "./authFlow";

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET: string = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? "";
export const GOOGLE_IOS_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID ?? "";

// Loopback redirect captured by the Rust listener (oauth_callback.rs), shared
// with the Anthropic login. Google Desktop clients accept a loopback redirect on
// any port/path.
export const GOOGLE_REDIRECT_URI = "http://127.0.0.1:53692/callback";

// drive.file: only files this app creates/opens are visible to it — the user's
// other Drive content stays private. openid+email: to show which account is
// linked. Not appDataFolder (docs/13: revoking access would delete the books).
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file openid email";

export const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

function authEnv(): AuthEnv {
  return {
    desktopClientId: GOOGLE_CLIENT_ID,
    desktopClientSecret: GOOGLE_CLIENT_SECRET,
    desktopRedirectUri: GOOGLE_REDIRECT_URI,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    iosRedirectUri: iosRedirectUri(GOOGLE_IOS_CLIENT_ID),
  };
}

// plugin-os platform() is synchronous (reads a value injected at webview init).
// Guard against a non-Tauri context (e.g. plain vite dev in a browser) so the
// app still loads with sign-in simply disabled.
function currentPlatform(): string {
  try {
    return platform();
  } catch {
    return "unknown";
  }
}

// The OAuth flow for the running platform, or null when its client is not set.
export function activeAuthFlow(): AuthFlow | null {
  return selectAuthFlow(currentPlatform(), authEnv());
}

export function isGoogleConfigured(): boolean {
  return activeAuthFlow() !== null;
}
