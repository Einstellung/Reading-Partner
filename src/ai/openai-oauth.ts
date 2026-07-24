// OpenAI subscription OAuth (ChatGPT Plus/Pro, via the Codex backend):
// authorization code + PKCE, mirroring anthropic-oauth.ts. pi-ai's
// loginOpenAICodex is Node-only (it spawns an http callback server) and doesn't
// export the code-exchange primitive, so the front half is reimplemented here.
// Loopback auto-capture is the finalized path; manual paste is the fallback when
// port 1455 is busy or the browser is on another machine.
//
// Constants match pi-ai's dist/utils/oauth/openai-codex.js (the public Codex CLI
// OAuth client). The subscription access token is a JWT carrying the ChatGPT
// account id; pi's openai-codex-responses API decodes it and sets the
// chatgpt-account-id header, so we only ever hand it the access token.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	loginOpenAICodexDeviceCode,
	refreshOpenAICodexToken,
	type OAuthCredentials,
	type OAuthDeviceCodeInfo,
} from "@earendil-works/pi-ai/oauth";
import { isOAuthCredential, loadCredentials, saveCredentials, setActiveCredential, type OpenAICredential } from "./credentials";
import { awaitingState, classifyDeviceCodeError, type DeviceCodeState } from "./device-code";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";
// Refresh this long before the real expiry so an in-flight request never races
// the boundary (pi's refresh does not apply a skew, so we bake it in ourselves).
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

// Retained across an attempt so the manual-paste fallback can reuse the verifier
// that was baked into the already-opened authorize URL.
let pending: { verifier: string; state: string } | null = null;

function base64Url(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

// Random opaque state. Unlike Anthropic (which reuses the PKCE verifier as the
// state), the Codex flow uses an independent value and never sends state to the
// token endpoint.
function generateState(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export function buildAuthUrl(challenge: string, state: string): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		scope: SCOPE,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "pi",
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
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

async function exchangeCode(code: string, verifier: string): Promise<OpenAICredential> {
	// Codex's token endpoint takes form-encoded params and, unlike Anthropic,
	// does not want the state back.
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
		}).toString(),
	});
	if (!res.ok) {
		throw new Error(`token exchange failed (HTTP ${res.status}): ${await res.text()}`);
	}
	const data = await res.json();
	return {
		type: "oauth",
		access: data.access_token,
		refresh: data.refresh_token,
		expires: Date.now() + data.expires_in * 1000 - EXPIRY_SKEW_MS,
	};
}

async function store(cred: OpenAICredential): Promise<void> {
	// Single-active: this also signs out Anthropic and DeepSeek.
	await setActiveCredential("openai", cred);
	pending = null;
}

/**
 * Full loopback login: open the system browser, capture the redirect on
 * localhost:1455/auth/callback via the Rust listener, exchange the code, and
 * store the token.
 *
 * Throws `AUTO_CALLBACK_FAILED` if the loopback couldn't run (port busy/timeout);
 * the browser is already showing the redirect, so the UI should prompt for a
 * paste and call {@link openaiLoginWithManualCode}.
 */
export async function openaiLogin(): Promise<void> {
	const { verifier, challenge } = await generatePKCE();
	const state = generateState();
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
	await store(await exchangeCode(code, verifier));
}

/** Fallback: exchange a code the user pasted from the redirect. */
export async function openaiLoginWithManualCode(input: string): Promise<void> {
	if (!pending) throw new Error("no pending OpenAI login; start login first");
	const { code, state } = parseManualInput(input);
	if (state && state !== pending.state) throw new Error("OAuth state mismatch");
	await store(await exchangeCode(code, pending.verifier));
}

/**
 * Start a paste-based login without the loopback listener: generate PKCE, open
 * the authorize page in the browser, and arm {@link openaiLoginWithManualCode}.
 * The redirect after login lands on http://localhost:1455/auth/callback?code=…
 * which fails to load, but the address bar is copyable — paste that URL back.
 * This is the iOS entry (no loopback) and the desktop fallback when device-code
 * login is not enabled for the account.
 */
export async function openaiLoginManualStart(): Promise<void> {
	const { verifier, challenge } = await generatePKCE();
	const state = generateState();
	pending = { verifier, state };
	await openUrl(buildAuthUrl(challenge, state));
}

// Injectable seam for tests: the real login is pi-ai's device-code flow.
export type DeviceCodeLogin = (options: {
	onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
	signal?: AbortSignal;
}) => Promise<OAuthCredentials>;

/**
 * Device-code login (the iOS-friendly OpenAI path, also usable on desktop as a
 * loopback-free test route). Reports progress through `onState`; never throws —
 * failures and cancellation are delivered as terminal states so a single handler
 * can drive the UI. On success the credentials are stored (single-active) and
 * the state machine ends in `success`.
 *
 * pi-ai owns the RFC 8628 poll loop; auth.openai.com is on the fetch-bridge
 * allowlist so its requests route through the Tauri http plugin like the rest.
 */
export async function openaiLoginDeviceCode(opts: {
	onState: (state: DeviceCodeState) => void;
	signal?: AbortSignal;
	login?: DeviceCodeLogin;
}): Promise<void> {
	const login = opts.login ?? loginOpenAICodexDeviceCode;
	opts.onState({ status: "starting" });
	try {
		const cred = await login({
			signal: opts.signal,
			onDeviceCode: (info) => opts.onState(awaitingState(info)),
		});
		// pi-ai returns expires as an absolute ms timestamp with no skew; bake in
		// the same refresh skew the loopback path uses.
		await store({
			type: "oauth",
			access: cred.access,
			refresh: cred.refresh,
			expires: cred.expires - EXPIRY_SKEW_MS,
		});
		opts.onState({ status: "success" });
	} catch (e) {
		opts.onState(classifyDeviceCodeError(e, opts.signal?.aborted ?? false));
	}
}

export async function openaiLogout(): Promise<void> {
	const s = await loadCredentials();
	delete s.openai;
	await saveCredentials(s);
}

/**
 * Returns a usable access token, refreshing (and persisting the new token) when
 * the stored one is within the expiry skew. Null when not logged in — including
 * when a legacy API-key credential is found, which is ignored (subscription
 * login is now the only supported OpenAI auth).
 */
export async function getValidOpenAIAuth(): Promise<string | null> {
	const s = await loadCredentials();
	const cred = s.openai;
	if (!isOAuthCredential(cred)) return null;
	if (Date.now() < cred.expires) return cred.access;

	const refreshed = await refreshOpenAICodexToken(cred.refresh);
	const next: OpenAICredential = {
		type: "oauth",
		access: refreshed.access,
		refresh: refreshed.refresh,
		expires: refreshed.expires - EXPIRY_SKEW_MS,
	};
	s.openai = next;
	await saveCredentials(s);
	return next.access;
}
