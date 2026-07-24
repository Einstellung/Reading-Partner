// Anthropic subscription OAuth (Claude Pro/Max): authorization code + PKCE.
// pi-ai's loginAnthropic is Node-only (it spawns an http callback server) and it
// doesn't export the code-exchange primitive, so the front half is reimplemented
// here per docs/05. Loopback auto-capture is the finalized path; manual paste is
// the fallback when port 53692 is busy or the browser is on another machine.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { refreshAnthropicToken } from "@earendil-works/pi-ai/oauth";
import { loadCredentials, saveCredentials, setActiveCredential, type AnthropicCredential } from "./credentials";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES =
	"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

// Retained across an attempt so the manual-paste fallback can reuse the verifier
// that was baked into the already-opened authorize URL.
let pending: { verifier: string; state: string } | null = null;

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

function buildAuthUrl(challenge: string, state: string): string {
	const params = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

// Accepts a bare code, `code#state`, `code=…&state=…`, or the full redirect URL.
function parseManualInput(input: string): { code: string; state?: string } {
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

async function exchangeCode(code: string, state: string, verifier: string): Promise<AnthropicCredential> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			state,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	});
	if (!res.ok) {
		throw new Error(`token exchange failed (HTTP ${res.status}): ${await res.text()}`);
	}
	const data = await res.json();
	return {
		type: "oauth",
		access: data.access_token,
		refresh: data.refresh_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
	};
}

async function store(cred: AnthropicCredential): Promise<void> {
	// Single-active: this also signs out OpenAI and DeepSeek.
	await setActiveCredential("anthropic", cred);
	pending = null;
}

/**
 * Full loopback login: open the system browser, capture the redirect on
 * localhost:53692 via the Rust listener, exchange the code, and store the token.
 *
 * Throws `AUTO_CALLBACK_FAILED` if the loopback couldn't run (port busy/timeout);
 * the browser is already showing the code, so the UI should prompt for a paste
 * and call {@link anthropicLoginWithManualCode}.
 */
export async function anthropicLogin(): Promise<void> {
	const { verifier, challenge } = await generatePKCE();
	const state = verifier; // pi uses the PKCE verifier as the state value
	pending = { verifier, state };

	// Start the listener first (it binds immediately), then open the browser.
	const listener = invoke<{ code: string; state: string }>("start_oauth_callback_listener", {
		expectedState: state,
		port: CALLBACK_PORT,
		path: CALLBACK_PATH,
	});
	await openUrl(buildAuthUrl(challenge, state));

	let code: string;
	try {
		({ code } = await listener);
	} catch (e) {
		throw new Error(`AUTO_CALLBACK_FAILED: ${e instanceof Error ? e.message : String(e)}`);
	}
	await store(await exchangeCode(code, state, verifier));
}

/**
 * Start a paste-based login without the loopback listener: generate PKCE, open
 * the authorize page (code=true so it prints the code), and arm
 * {@link anthropicLoginWithManualCode}. This is the iOS entry (no loopback);
 * the user copies the code the page shows and pastes it back.
 */
export async function anthropicLoginManualStart(): Promise<void> {
	const { verifier, challenge } = await generatePKCE();
	const state = verifier; // pi uses the PKCE verifier as the state value
	pending = { verifier, state };
	await openUrl(buildAuthUrl(challenge, state));
}

/** Fallback: exchange a code the user pasted from the authorize page. */
export async function anthropicLoginWithManualCode(input: string): Promise<void> {
	if (!pending) throw new Error("no pending Anthropic login; start login first");
	const { code, state } = parseManualInput(input);
	await store(await exchangeCode(code, state ?? pending.state, pending.verifier));
}

export async function anthropicLogout(): Promise<void> {
	const s = await loadCredentials();
	delete s.anthropic;
	await saveCredentials(s);
}

/**
 * Returns a usable access token, refreshing (and persisting the new token) when
 * the stored one is within the 5-minute expiry skew. Null when not logged in.
 */
export async function getValidAnthropicAuth(): Promise<string | null> {
	const s = await loadCredentials();
	const cred = s.anthropic;
	if (!cred) return null;
	if (Date.now() < cred.expires) return cred.access;

	const refreshed = await refreshAnthropicToken(cred.refresh);
	const next: AnthropicCredential = {
		type: "oauth",
		access: refreshed.access,
		refresh: refreshed.refresh,
		expires: refreshed.expires,
	};
	s.anthropic = next;
	await saveCredentials(s);
	return next.access;
}
