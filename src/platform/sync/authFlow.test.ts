// Pure OAuth flow-fork logic: platform selection, reverse-client-id derivation,
// authorization URL, token bodies (secret only on desktop), and deep-link
// callback parsing. The impure glue (auth.ts) is not exercised here.

import { expect, test } from "bun:test";
import {
  authCodeBody,
  buildAuthUrl,
  iosRedirectUri,
  matchesRedirect,
  parseCallbackParams,
  refreshBody,
  reversedClientId,
  selectAuthFlow,
  type AuthEnv,
} from "./authFlow";

const IOS_ID = "1234567890-abcdef.apps.googleusercontent.com";
const REVERSED = "com.googleusercontent.apps.1234567890-abcdef";
const REDIRECT = `${REVERSED}:/oauth2redirect`;

const env: AuthEnv = {
  desktopClientId: "desk-id",
  desktopClientSecret: "desk-secret",
  desktopRedirectUri: "http://127.0.0.1:53692/callback",
  iosClientId: IOS_ID,
  iosRedirectUri: iosRedirectUri(IOS_ID),
};

// --- reverse client id -----------------------------------------------------

test("reversedClientId strips the googleusercontent suffix and prepends the reverse domain", () => {
  expect(reversedClientId(IOS_ID)).toBe(REVERSED);
});

test("iosRedirectUri appends the oauth2redirect path with a single slash", () => {
  expect(iosRedirectUri(IOS_ID)).toBe(REDIRECT);
});

test("iosRedirectUri is empty when no iOS client is configured", () => {
  expect(iosRedirectUri("")).toBe("");
});

// --- platform fork ---------------------------------------------------------

test("iOS platform selects the scheme flow with no client secret", () => {
  const flow = selectAuthFlow("ios", env);
  expect(flow?.kind).toBe("ios-scheme");
  expect(flow?.clientId).toBe(IOS_ID);
  expect(flow?.clientSecret).toBeUndefined();
  expect(flow?.redirectUri).toBe(REDIRECT);
});

test("macOS/windows/linux and unknown platforms all select the desktop loopback flow", () => {
  for (const p of ["macos", "windows", "linux", "whatever"]) {
    const flow = selectAuthFlow(p, env);
    expect(flow?.kind).toBe("desktop-loopback");
    expect(flow?.clientId).toBe("desk-id");
    expect(flow?.clientSecret).toBe("desk-secret");
    expect(flow?.redirectUri).toBe("http://127.0.0.1:53692/callback");
  }
});

test("iOS flow is null when the iOS client id is unset", () => {
  expect(selectAuthFlow("ios", { ...env, iosClientId: "", iosRedirectUri: "" })).toBeNull();
});

test("desktop flow is null when id or secret is missing", () => {
  expect(selectAuthFlow("linux", { ...env, desktopClientId: "" })).toBeNull();
  expect(selectAuthFlow("linux", { ...env, desktopClientSecret: "" })).toBeNull();
});

// --- authorization URL -----------------------------------------------------

test("buildAuthUrl carries PKCE, offline access, and the flow's client id and redirect", () => {
  const flow = selectAuthFlow("ios", env)!;
  const url = new URL(buildAuthUrl("https://accounts.google.com/o/oauth2/v2/auth", flow, "drive.file openid email", "CH", "ST"));
  const q = url.searchParams;
  expect(q.get("client_id")).toBe(IOS_ID);
  expect(q.get("redirect_uri")).toBe(REDIRECT);
  expect(q.get("response_type")).toBe("code");
  expect(q.get("code_challenge")).toBe("CH");
  expect(q.get("code_challenge_method")).toBe("S256");
  expect(q.get("state")).toBe("ST");
  expect(q.get("access_type")).toBe("offline");
  expect(q.get("prompt")).toBe("consent");
  expect(q.get("scope")).toBe("drive.file openid email");
});

test("buildAuthUrl never leaks a client secret into the URL", () => {
  const flow = selectAuthFlow("linux", env)!;
  const url = buildAuthUrl("https://accounts.google.com/o/oauth2/v2/auth", flow, "s", "CH", "ST");
  expect(url.includes("desk-secret")).toBe(false);
  expect(url.includes("client_secret")).toBe(false);
});

// --- token bodies ----------------------------------------------------------

test("authCodeBody includes the client secret on desktop and omits it on iOS", () => {
  const desktop = authCodeBody(selectAuthFlow("linux", env)!, "code123", "verif");
  expect(desktop.client_secret).toBe("desk-secret");
  expect(desktop.code_verifier).toBe("verif");
  expect(desktop.grant_type).toBe("authorization_code");

  const ios = authCodeBody(selectAuthFlow("ios", env)!, "code123", "verif");
  expect(ios.client_secret).toBeUndefined();
  expect(ios.code_verifier).toBe("verif");
  expect(ios.client_id).toBe(IOS_ID);
  expect(ios.redirect_uri).toBe(REDIRECT);
});

test("refreshBody follows the same secret rule and sends the refresh token", () => {
  const desktop = refreshBody(selectAuthFlow("linux", env)!, "R");
  expect(desktop.grant_type).toBe("refresh_token");
  expect(desktop.refresh_token).toBe("R");
  expect(desktop.client_secret).toBe("desk-secret");

  const ios = refreshBody(selectAuthFlow("ios", env)!, "R");
  expect(ios.client_secret).toBeUndefined();
  expect(ios.refresh_token).toBe("R");
});

// --- deep-link callback parsing --------------------------------------------

test("matchesRedirect accepts the custom scheme and rejects other schemes", () => {
  expect(matchesRedirect(`${REVERSED}:/oauth2redirect?code=a&state=b`, REDIRECT)).toBe(true);
  // Case-insensitive scheme comparison.
  expect(matchesRedirect(`${REVERSED.toUpperCase()}:/oauth2redirect?code=a`, REDIRECT)).toBe(true);
  expect(matchesRedirect("https://accounts.google.com/x?code=a", REDIRECT)).toBe(false);
  expect(matchesRedirect("com.other.app:/cb?code=a", REDIRECT)).toBe(false);
});

test("matchesRedirect works for the desktop loopback redirect too", () => {
  expect(matchesRedirect("http://127.0.0.1:53692/callback?code=a", "http://127.0.0.1:53692/callback")).toBe(true);
});

test("parseCallbackParams pulls code and state from a single-slash scheme URL", () => {
  const p = parseCallbackParams(`${REVERSED}:/oauth2redirect?code=the%2Dcode&state=xyz`);
  expect(p.code).toBe("the-code");
  expect(p.state).toBe("xyz");
  expect(p.error).toBeUndefined();
});

test("parseCallbackParams reports an authorization error", () => {
  const p = parseCallbackParams(`${REVERSED}:/oauth2redirect?error=access_denied&state=xyz`);
  expect(p.error).toBe("access_denied");
  expect(p.code).toBeUndefined();
});

test("parseCallbackParams returns all-undefined when there is no query", () => {
  const p = parseCallbackParams(`${REVERSED}:/oauth2redirect`);
  expect(p.code).toBeUndefined();
  expect(p.state).toBeUndefined();
  expect(p.error).toBeUndefined();
});
