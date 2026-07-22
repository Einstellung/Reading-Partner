// Pure-logic tests for the OpenAI (ChatGPT) subscription OAuth module: PKCE,
// authorize-URL construction, manual-input parsing, and the credential guard
// that ignores legacy API-key credentials. No network/Tauri involved.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildAuthUrl, generatePKCE, parseManualInput } from "../../src/ai/openai-oauth";
import { isOAuthCredential } from "../../src/ai/credentials";

test("buildAuthUrl carries the Codex OAuth client, redirect, scope, and flow flags", () => {
	const url = new URL(buildAuthUrl("the-challenge", "the-state"));
	expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
	const p = url.searchParams;
	expect(p.get("response_type")).toBe("code");
	expect(p.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
	expect(p.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
	expect(p.get("scope")).toBe("openid profile email offline_access");
	expect(p.get("code_challenge")).toBe("the-challenge");
	expect(p.get("code_challenge_method")).toBe("S256");
	expect(p.get("state")).toBe("the-state");
	expect(p.get("id_token_add_organizations")).toBe("true");
	expect(p.get("codex_cli_simplified_flow")).toBe("true");
	expect(p.get("originator")).toBe("pi");
});

test("generatePKCE derives the challenge as base64url(SHA-256(verifier))", async () => {
	const { verifier, challenge } = await generatePKCE();
	// verifier is 32 random bytes, base64url-encoded (no padding).
	expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	);
	let s = "";
	for (const b of digest) s += String.fromCharCode(b);
	const expected = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	expect(challenge).toBe(expected);
});

test("parseManualInput accepts a bare code", () => {
	expect(parseManualInput("abc123")).toEqual({ code: "abc123" });
});

test("parseManualInput splits code#state", () => {
	expect(parseManualInput("abc123#xyz")).toEqual({ code: "abc123", state: "xyz" });
});

test("parseManualInput reads a code=…&state=… query fragment", () => {
	expect(parseManualInput("code=abc123&state=xyz")).toEqual({ code: "abc123", state: "xyz" });
});

test("parseManualInput extracts code/state from a full redirect URL", () => {
	expect(parseManualInput("http://localhost:1455/auth/callback?code=abc123&state=xyz")).toEqual({
		code: "abc123",
		state: "xyz",
	});
});

test("isOAuthCredential accepts an OAuth triple", () => {
	expect(isOAuthCredential({ type: "oauth", access: "a", refresh: "r", expires: 1 })).toBe(true);
});

test("isOAuthCredential ignores a legacy API-key credential", () => {
	expect(isOAuthCredential({ type: "apiKey", key: "sk-legacy" })).toBe(false);
});

test("isOAuthCredential rejects undefined/garbage", () => {
	expect(isOAuthCredential(undefined)).toBe(false);
	expect(isOAuthCredential(null)).toBe(false);
	expect(isOAuthCredential({ type: "oauth" })).toBe(false);
});
