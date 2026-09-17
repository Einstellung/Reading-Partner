// OpenAI subscription OAuth (ChatGPT Plus/Pro, via the Codex backend):
// authorization code + PKCE on the shared skeleton in oauth-flow.ts, plus the
// device-code route, which is OpenAI's alone. The three entries are loopback
// auto-capture (the finalized desktop path), manual paste (when port 1455 is
// busy or the browser is on another machine), and device code (the iOS path).
//
// Constants match pi-ai's dist/auth/oauth/openai-codex.js (the public Codex CLI
// OAuth client). The subscription access token is a JWT carrying the ChatGPT
// account id; pi's openai-codex-responses API decodes it and sets the
// chatgpt-account-id header, so we only ever hand it the access token.

import { base64Url } from "../platform/app/oauth";
import type { OpenAICredential } from "./credentials";
import { createOAuthFlow } from "./oauth-flow";
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
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";

// The device-code flow has its own endpoints, its own redirect (the code is
// issued to the browser the user authorized in, not to us), and its own deadline.
const DEVICE_USER_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
const DEVICE_TIMEOUT_SECONDS = 15 * 60;

// Random opaque state. Unlike Anthropic (which reuses the PKCE verifier as the
// state), the Codex flow uses an independent value and never sends state to the
// token endpoint, so the mismatch check on a pasted code is ours to make.
function generateState(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

const flow = createOAuthFlow({
	id: "openai",
	label: "OpenAI",
	clientId: CLIENT_ID,
	authorizeUrl: `${AUTH_BASE}/oauth/authorize`,
	tokenUrl: `${AUTH_BASE}/oauth/token`,
	scopes: "openid profile email offline_access",
	redirectUri: `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`,
	callbackPort: CALLBACK_PORT,
	callbackPath: CALLBACK_PATH,
	authorizeParams: {
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "pi",
	},
	// Codex's token endpoint takes form-encoded params and does not want the
	// state back.
	tokenBody: "form",
	sendStateToToken: false,
	verifyPastedState: true,
	stateFor: generateState,
});

export const buildAuthUrl = flow.buildAuthUrl;

/**
 * Full loopback login: open the system browser, capture the redirect on
 * localhost:1455/auth/callback via the Rust listener, exchange the code, and
 * store the token.
 *
 * Throws `AUTO_CALLBACK_FAILED` if the loopback couldn't run (port busy/timeout);
 * the browser is already showing the redirect, so the UI should prompt for a
 * paste and call {@link openaiLoginWithManualCode}.
 */
export const openaiLogin = flow.login;

/** Fallback: exchange a code the user pasted from the redirect. */
export const openaiLoginWithManualCode = flow.loginWithManualCode;

/**
 * Start a paste-based login without the loopback listener: generate PKCE, open
 * the authorize page in the browser, and arm {@link openaiLoginWithManualCode}.
 * The redirect after login lands on http://localhost:1455/auth/callback?code=…
 * which fails to load, but the address bar is copyable — paste that URL back.
 * This is the iOS entry (no loopback) and the desktop fallback when device-code
 * login is not enabled for the account.
 */
export const openaiLoginManualStart = flow.manualStart;

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
	return flow.exchangeCode(code, verifier, { redirectUri: DEVICE_REDIRECT_URI, signal });
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
		await flow.store(
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

export const openaiLogout = flow.logout;

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
export const getValidOpenAIAuth = flow.getValidAuth;
