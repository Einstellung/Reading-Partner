// Platform fork for the Google OAuth flow, kept as pure functions so the branch
// point is unit-testable and the impure auth.ts stays thin.
//
// Desktop (macOS/Windows/Linux) uses a Google "Desktop" OAuth client: a loopback
// redirect captured by the Rust listener (oauth_callback.rs) and a client_secret
// alongside PKCE (the secret is not confidential for an installed-app client).
//
// iOS and Android use a Google "iOS"/"Android" OAuth client: no client_secret
// (public client, PKCE is the whole protection), and the redirect is the client's
// reverse-DNS custom scheme captured by tauri-plugin-deep-link. Google is
// deprecating the loopback redirect for native iOS/Android clients, and it forbids
// loading the consent screen in an embedded webview, so the scheme + system-browser
// route is the only compliant path on both mobile platforms. The two differ only
// in which client id (and thus which reversed scheme) is used.

export type AuthFlowKind = "desktop-loopback" | "ios-scheme" | "android-scheme";

export interface AuthFlow {
  kind: AuthFlowKind;
  clientId: string;
  // Present only for the desktop loopback flow; the iOS client has no secret.
  clientSecret?: string;
  redirectUri: string;
}

export interface AuthEnv {
  desktopClientId: string;
  desktopClientSecret: string;
  desktopRedirectUri: string;
  iosClientId: string;
  iosRedirectUri: string;
  androidClientId: string;
  androidRedirectUri: string;
}

// Turn a Google iOS client id into its reverse-DNS URL scheme:
//   "12345-abcdef.apps.googleusercontent.com" -> "com.googleusercontent.apps.12345-abcdef"
// This scheme is what the app registers in Info.plist (via tauri.conf.json
// plugins.deep-link.mobile) and what Google redirects to after authorization.
export function reversedClientId(iosClientId: string): string {
  const suffix = iosClientId.replace(/\.apps\.googleusercontent\.com$/, "");
  return `com.googleusercontent.apps.${suffix}`;
}

// Full redirect URI for a mobile client (iOS or Android): the reversed client id
// as a custom scheme, "<reversed-client-id>:/oauth2redirect". Empty string when no
// client is configured (so isGoogleConfigured stays false and sign-in is disabled
// rather than crashing).
export function schemeRedirectUri(clientId: string): string {
  return clientId ? `${reversedClientId(clientId)}:/oauth2redirect` : "";
}

// Pick the flow for the running platform, or null when that platform's client is
// not configured. "ios" and "android" are the scheme-redirect platforms; every
// other platform (macos/windows/linux, and unknowns) takes the desktop loopback.
export function selectAuthFlow(platform: string, env: AuthEnv): AuthFlow | null {
  if (platform === "ios") {
    if (!env.iosClientId) return null;
    return { kind: "ios-scheme", clientId: env.iosClientId, redirectUri: env.iosRedirectUri };
  }
  if (platform === "android") {
    if (!env.androidClientId) return null;
    return { kind: "android-scheme", clientId: env.androidClientId, redirectUri: env.androidRedirectUri };
  }
  if (!env.desktopClientId || !env.desktopClientSecret) return null;
  return {
    kind: "desktop-loopback",
    clientId: env.desktopClientId,
    clientSecret: env.desktopClientSecret,
    redirectUri: env.desktopRedirectUri,
  };
}

// Authorization URL. Identical shape for both flows; only client_id and
// redirect_uri differ. access_type=offline + prompt=consent force a refresh
// token on every sign-in (Google only returns one with explicit consent).
export function buildAuthUrl(
  authorizeUrl: string,
  flow: AuthFlow,
  scopes: string,
  challenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: flow.clientId,
    response_type: "code",
    redirect_uri: flow.redirectUri,
    scope: scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${authorizeUrl}?${params.toString()}`;
}

// Token-endpoint body for the authorization-code exchange. client_secret is sent
// only for the desktop flow; the iOS public client must not send one.
export function authCodeBody(flow: AuthFlow, code: string, verifier: string): Record<string, string> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: flow.clientId,
    redirect_uri: flow.redirectUri,
    code_verifier: verifier,
  };
  if (flow.clientSecret) body.client_secret = flow.clientSecret;
  return body;
}

// Token-endpoint body for a refresh. Same secret rule as authCodeBody.
export function refreshBody(flow: AuthFlow, refreshToken: string): Record<string, string> {
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: flow.clientId,
    refresh_token: refreshToken,
  };
  if (flow.clientSecret) body.client_secret = flow.clientSecret;
  return body;
}

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

// True when a deep-link URL belongs to our redirect (scheme match, case-insensitive).
// iOS custom-scheme URLs arrive as "com.googleusercontent.apps.x:/oauth2redirect?...".
export function matchesRedirect(url: string, redirectUri: string): boolean {
  const scheme = redirectUri.split(":", 1)[0].toLowerCase();
  return scheme.length > 0 && url.toLowerCase().startsWith(`${scheme}:`);
}

// Pull code/state/error out of a redirect URL's query string. Tolerant of both
// "scheme:/path?..." (single slash, no authority) and "scheme://...?..." forms
// because it keys only off the first "?".
export function parseCallbackParams(url: string): CallbackParams {
  const q = url.indexOf("?");
  const params = new URLSearchParams(q >= 0 ? url.slice(q + 1) : "");
  return {
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    error: params.get("error") ?? undefined,
  };
}
