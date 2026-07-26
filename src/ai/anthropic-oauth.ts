// Anthropic subscription OAuth (Claude Pro/Max): authorization code + PKCE.
// pi-ai's login is Node-only (it spawns an http callback server) and since 0.82
// it exports no OAuth primitives at all, so the whole flow lives here per
// docs/05. Loopback auto-capture is the finalized path; manual paste is the
// fallback when port 53692 is busy or the browser is on another machine.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { generatePKCE, parseManualInput } from "../platform/app/oauth";
import { loadCredentials, setActiveCredential, updateCredentials, type AnthropicCredential } from "./credentials";
import { coalesceRefresh } from "./token-refresh";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
// The code-display variant: with this registered redirect, the authorize page
// lands on a console.anthropic.com page that shows the code (code#state) for
// copy-paste. The localhost redirect never displays a code — `code=true` alone
// does not change that — so the manual flow must use this one (real-iPad
// finding; Claude Code's own paste-code login uses the same).
const MANUAL_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES =
	"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
// Treat the token as expired this long before the real boundary so an in-flight
// request never races it.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

// Retained across an attempt so the manual-paste fallback can reuse the verifier
// that was baked into the already-opened authorize URL. The token exchange must
// repeat the redirect_uri the authorize URL carried, so it is recorded here.
let pending: { verifier: string; state: string; redirectUri: string } | null = null;

function buildAuthUrl(challenge: string, state: string, redirectUri: string = REDIRECT_URI): string {
	const params = new URLSearchParams({
		code: "true",
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: redirectUri,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

// Both grants hit the same endpoint with the same JSON-in/JSON-out shape.
async function postToken(
	body: Record<string, string>,
	what: string,
): Promise<AnthropicCredential> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(body),
		// A refresh with no deadline hangs the AI call that triggered it, with no
		// way for the user to tell it apart from a slow model. pi used the same 30s.
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		throw new Error(`${what} failed (HTTP ${res.status}): ${await res.text()}`);
	}
	const data = await res.json();
	return {
		type: "oauth",
		access: data.access_token,
		refresh: data.refresh_token,
		expires: Date.now() + data.expires_in * 1000 - EXPIRY_SKEW_MS,
	};
}

function exchangeCode(
	code: string,
	state: string,
	verifier: string,
	redirectUri: string = REDIRECT_URI,
): Promise<AnthropicCredential> {
	return postToken(
		{
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			state,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		},
		"token exchange",
	);
}

// Spend the refresh token for a fresh pair. The refresh token rotates on use, so
// only one caller may ever run this per stored credential (see token-refresh.ts).
function refreshToken(refresh: string): Promise<AnthropicCredential> {
	return postToken(
		{ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refresh },
		"token refresh",
	);
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
	pending = { verifier, state, redirectUri: REDIRECT_URI };

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
 * the authorize page with the code-display redirect (the page then shows the
 * code as code#state), and arm {@link anthropicLoginWithManualCode}. This is
 * the iOS entry (no loopback); the user copies the shown code and pastes it back.
 */
export async function anthropicLoginManualStart(): Promise<void> {
	const { verifier, challenge } = await generatePKCE();
	const state = verifier; // pi uses the PKCE verifier as the state value
	pending = { verifier, state, redirectUri: MANUAL_REDIRECT_URI };
	await openUrl(buildAuthUrl(challenge, state, MANUAL_REDIRECT_URI));
}

/** Fallback: exchange a code the user pasted from the authorize page. */
export async function anthropicLoginWithManualCode(input: string): Promise<void> {
	if (!pending) throw new Error("no pending Anthropic login; start login first");
	const { code, state } = parseManualInput(input);
	await store(await exchangeCode(code, state ?? pending.state, pending.verifier, pending.redirectUri));
}

export async function anthropicLogout(): Promise<void> {
	await updateCredentials((s) => {
		delete s.anthropic;
	});
}

/**
 * Returns a usable access token, refreshing (and persisting the new token) when
 * the stored one is within the 5-minute expiry skew. Null when not logged in.
 *
 * Concurrent callers share one refresh: the refresh token rotates on use, so a
 * second exchange with the same token fails and logs the user out (see
 * token-refresh.ts).
 */
export async function getValidAnthropicAuth(): Promise<string | null> {
	const cred = (await loadCredentials()).anthropic;
	if (!cred) return null;
	if (Date.now() < cred.expires) return cred.access;

	return coalesceRefresh("anthropic", async () => {
		// Re-read inside the coalescer: a refresh that finished between our read
		// and our turn already spent this refresh token, and left the only valid
		// successor on disk.
		const current = (await loadCredentials()).anthropic;
		if (!current) return null;
		if (Date.now() < current.expires) return current.access;

		const next = await refreshToken(current.refresh);
		await updateCredentials((s) => {
			// A sign-in or sign-out that landed while the exchange was in flight
			// owns the file now; putting our token back would undo it.
			if (s.anthropic?.refresh === current.refresh) s.anthropic = next;
		});
		return next.access;
	});
}
