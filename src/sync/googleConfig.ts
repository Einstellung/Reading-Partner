// Google OAuth client credentials, read from Vite env at build time. Empty by
// default: the user's Google Cloud OAuth client is provisioned separately, and
// filling VITE_GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_SECRET is all it takes to
// enable sign-in — no code change (docs/13). When unset, the Settings page shows
// "Google client not configured" and disables the button.
//
// The secret is present because Google's installed-app (Desktop) token endpoint
// still requires client_secret alongside PKCE. For a Desktop OAuth client this
// value is not confidential (it ships in every desktop binary); PKCE is what
// actually protects the exchange.

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET: string = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? "";

// Loopback redirect captured by the Rust listener (oauth_callback.rs), shared
// with the Anthropic login. Google Desktop clients accept a loopback redirect on
// any port/path; a Web client must whitelist this exact URI.
export const GOOGLE_REDIRECT_URI = "http://127.0.0.1:53692/callback";

// drive.file: only files this app creates/opens are visible to it — the user's
// other Drive content stays private. openid+email: to show which account is
// linked. Not appDataFolder (docs/13: revoking access would delete the books).
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file openid email";

export function isGoogleConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0 && GOOGLE_CLIENT_SECRET.length > 0;
}
