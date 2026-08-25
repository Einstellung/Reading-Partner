// OpenAI subscription OAuth (ChatGPT Plus/Pro, via the Codex backend):
// authorization code + PKCE, mirroring anthropic-oauth.ts. pi-ai's login is
// Node-only (it spawns an http callback server) and since 0.82 it exports no
// OAuth primitives at all, so the whole flow lives here: loopback auto-capture
// (the finalized desktop path), manual paste (when port 1455 is busy or the
// browser is on another machine), and device code (the iOS path).
//
// Constants match pi-ai's dist/auth/oauth/openai-codex.js (the public Codex CLI
// OAuth client). The subscription access token is a JWT carrying the ChatGPT
// account id; pi's openai-codex-responses API decodes it and sets the
// chatgpt-account-id header, so we only ever hand it the access token.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { base64Url, generatePKCE, parseManualInput } from "../platform/app/oauth";
import { isOAuthCredential, loadCredentials, setActiveCredential, updateCredentials, type OpenAICredential } from "./credentials";
import { coalesceRefresh } from "./token-refresh";
import {
	awaitingState,
	classifyDeviceCodeError,
	pollDeviceCode,
	type DeviceCodeInfo,
	type DeviceCodePoll,
	type DeviceCodeState,
} from "./device-code";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";
// Refresh this long before the real expiry so an in-flight request never races
// the boundary.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

// The device-code flow has its own endpoints, its own redirect (the code is
// issued to the browser the user authorized in, not to us), and its own deadline.
const DEVICE_USER_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
const DEVICE_TIMEOUT_SECONDS = 15 * 60;

// Retained across an attempt so the manual-paste fallback can reuse the verifier
// that was baked into the already-opened authorize URL.
let pending: { verifier: string; state: string } | null = null;

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

// Codex's token endpoint takes form-encoded params and, unlike Anthropic, does
// not want the state back. Both grants land here.
async function postToken(
	params: Record<string, string>,
	what: string,
	signal?: AbortSignal,
): Promise<OpenAICredential> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params).toString(),
		signal,
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
	verifier: string,
	redirectUri: string = REDIRECT_URI,
	signal?: AbortSignal,
): Promise<OpenAICredential> {
	return postToken(
		{
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		},
		"token exchange",
		signal,
	);
}

// Spend the refresh token for a fresh pair. The refresh token rotates on use, so
// only one caller may ever run this per stored credential (see token-refresh.ts).
function refreshToken(refresh: string): Promise<OpenAICredential> {
	return postToken(
		{ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refresh },
		"token refresh",
	);
}

async function store(cred: OpenAICredential): Promise<void> {
	// Single-active: this also signs out whichever other provider was connected.
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

// Injectable seam for tests: the real login is deviceCodeLogin below.
export type DeviceCodeLogin = (options: {
	onDeviceCode: (info: DeviceCodeInfo) => void;
	signal?: AbortSignal;
}) => Promise<OpenAICredential>;

interface DeviceAuth {
	deviceAuthId: string;
	userCode: string;
	intervalSeconds: number;
}

// Ask the backend for a user code. A 404 here is how it says the flow is not
// enabled for this account, which is the one failure with a usable fallback.
async function startDeviceAuth(signal?: AbortSignal): Promise<DeviceAuth> {
	const res = await fetch(DEVICE_USER_CODE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: CLIENT_ID }),
		signal,
	});
	if (!res.ok) {
		if (res.status === 404) {
			throw new Error("device code login is not enabled for this account");
		}
		throw new Error(`device code request failed (HTTP ${res.status}): ${await res.text()}`);
	}
	const data = await res.json();
	const interval = typeof data?.interval === "string" ? Number(data.interval.trim()) : data?.interval;
	if (!data?.device_auth_id || !data.user_code || !Number.isFinite(interval) || interval < 0) {
		throw new Error(`invalid device code response: ${JSON.stringify(data)}`);
	}
	return { deviceAuthId: data.device_auth_id, userCode: data.user_code, intervalSeconds: interval };
}

// Read one poll response. Before the user has entered the code the backend
// answers 403/404 or an `authorization_pending` error code; both mean keep going.
async function readDeviceAuthPoll(
	res: Response,
): Promise<DeviceCodePoll<{ code: string; verifier: string }>> {
	if (res.ok) {
		const data = await res.json();
		if (!data?.authorization_code || !data.code_verifier) {
			return { status: "failed", message: `invalid device auth response: ${JSON.stringify(data)}` };
		}
		return {
			status: "complete",
			value: { code: data.authorization_code, verifier: data.code_verifier },
		};
	}
	if (res.status === 403 || res.status === 404) return { status: "pending" };
	const body = await res.text();
	let errorCode: unknown;
	try {
		const error = JSON.parse(body)?.error;
		errorCode = typeof error === "object" ? error?.code : error;
	} catch {
		// Not JSON; fall through to the generic failure below.
	}
	if (errorCode === "deviceauth_authorization_pending") return { status: "pending" };
	if (errorCode === "slow_down") return { status: "slow_down" };
	return { status: "failed", message: `device auth failed (HTTP ${res.status}): ${body}` };
}

// The real device-code login: request a user code, hand it to the UI, poll until
// the user authorizes in a browser, then exchange the code the backend issues.
const deviceCodeLogin: DeviceCodeLogin = async ({ onDeviceCode, signal }) => {
	const device = await startDeviceAuth(signal);
	onDeviceCode({
		userCode: device.userCode,
		verificationUri: DEVICE_VERIFICATION_URI,
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: DEVICE_TIMEOUT_SECONDS,
	});
	const { code, verifier } = await pollDeviceCode({
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: DEVICE_TIMEOUT_SECONDS,
		signal,
		poll: async () =>
			readDeviceAuthPoll(
				await fetch(DEVICE_TOKEN_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						device_auth_id: device.deviceAuthId,
						user_code: device.userCode,
					}),
					signal,
				}),
			),
	});
	return exchangeCode(code, verifier, DEVICE_REDIRECT_URI, signal);
};

/**
 * Device-code login (the iOS-friendly OpenAI path, also usable on desktop as a
 * loopback-free test route). Reports progress through `onState`; never throws —
 * failures and cancellation are delivered as terminal states so a single handler
 * can drive the UI. On success the credentials are stored (single-active) and
 * the state machine ends in `success`.
 *
 * auth.openai.com is on the fetch-bridge allowlist, so the poll requests route
 * through the Tauri http plugin like the rest.
 */
export async function openaiLoginDeviceCode(opts: {
	onState: (state: DeviceCodeState) => void;
	signal?: AbortSignal;
	login?: DeviceCodeLogin;
}): Promise<void> {
	const login = opts.login ?? deviceCodeLogin;
	opts.onState({ status: "starting" });
	try {
		await store(
			await login({
				signal: opts.signal,
				onDeviceCode: (info) => opts.onState(awaitingState(info)),
			}),
		);
		opts.onState({ status: "success" });
	} catch (e) {
		opts.onState(classifyDeviceCodeError(e, opts.signal?.aborted ?? false));
	}
}

export async function openaiLogout(): Promise<void> {
	await updateCredentials((s) => {
		delete s.openai;
	});
}

/**
 * Returns a usable access token, refreshing (and persisting the new token) when
 * the stored one is within the expiry skew. Null when not logged in — including
 * when a legacy API-key credential is found, which is ignored (subscription
 * login is now the only supported OpenAI auth).
 *
 * Concurrent callers share one refresh: the refresh token rotates on use, so a
 * second exchange with the same token fails and logs the user out (see
 * token-refresh.ts).
 */
export async function getValidOpenAIAuth(): Promise<string | null> {
	const cred = (await loadCredentials()).openai;
	if (!isOAuthCredential(cred)) return null;
	if (Date.now() < cred.expires) return cred.access;

	return coalesceRefresh("openai", async () => {
		// Re-read inside the coalescer: a refresh that finished between our read
		// and our turn already spent this refresh token, and left the only valid
		// successor on disk.
		const current = (await loadCredentials()).openai;
		if (!isOAuthCredential(current)) return null;
		if (Date.now() < current.expires) return current.access;

		const next = await refreshToken(current.refresh);
		await updateCredentials((s) => {
			// A sign-in or sign-out that landed while the exchange was in flight
			// owns the file now; putting our token back would undo it.
			if (isOAuthCredential(s.openai) && s.openai.refresh === current.refresh) s.openai = next;
		});
		return next.access;
	});
}
