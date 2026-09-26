// The skeleton both subscription OAuth logins are built from: Anthropic
// (Claude Pro/Max) and OpenAI (ChatGPT Plus/Pro, via the Codex backend). Both
// are authorization code + PKCE against the provider's own public client, with
// loopback auto-capture on desktop and a paste fallback when the port is busy or
// the browser is on another machine. pi-ai's login is Node-only (it spawns an
// http callback server) and since 0.82 it exports no OAuth primitives at all, so
// the whole flow lives here per docs/05.
//
// What genuinely differs is a field of OAuthProviderConfig — authorize params,
// token-body encoding, which side checks the state, what the state is derived
// from — or stays in the provider file, like OpenAI's extra device-code route.
//
// platform/sync/authFlow.ts has a third buildAuthUrl. It is not reused here: it
// takes Google's AuthFlow (client secret included) and always sends
// access_type/prompt, which neither of these two clients may receive.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { generatePKCE, parseManualInput } from "../../platform/app/oauth";
import {
	isOAuthCredential,
	loadCredentials,
	setActiveCredential,
	updateCredentials,
	type OAuthCredential,
	type ProviderCredentialId,
} from "./credentials";
import { coalesceRefresh } from "./token-refresh";
import { errMsg } from "../../platform/std/errors";

// Treat the token as expired this long before the real boundary so an in-flight
// request never races it.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

// A token request with no deadline hangs the AI call that triggered it, with no
// way for the user to tell it apart from a slow model. pi used the same 30s.
const TOKEN_TIMEOUT_MS = 30_000;

export interface OAuthProviderConfig {
	/** Key in credentials.json, and the key the refresh coalescer runs under. */
	id: ProviderCredentialId;
	/** The provider's name as an error message spells it. */
	label: string;
	clientId: string;
	authorizeUrl: string;
	tokenUrl: string;
	scopes: string;
	/** Loopback redirect, captured by the Rust listener on this port and path. */
	redirectUri: string;
	callbackPort: number;
	callbackPath: string;
	/**
	 * Redirect for the paste fallback, when it must differ from the loopback one
	 * (Anthropic only shows the code on a registered code-display redirect).
	 */
	manualRedirectUri?: string;
	/**
	 * The authorize query, in wire order, from the PKCE core. `core` arrives as
	 * client_id, response_type, redirect_uri, scope, code_challenge,
	 * code_challenge_method, state; a provider reorders it and adds its own
	 * params. Order is part of the URL we hand a third party, and neither
	 * endpoint is one this repo can test against, so each provider's order is
	 * pinned byte for byte by tests/ai/oauth-authorize-url.test.ts.
	 */
	authorizeParams?: (core: Record<string, string>) => Record<string, string>;
	/** How the token endpoint wants the grant: a JSON object or a form body. */
	tokenBody: "json" | "form";
	/** The token endpoint wants the state echoed back with the code. */
	sendStateToToken: boolean;
	/** Reject a pasted code whose state does not match the pending one. */
	verifyPastedState: boolean;
	/** The state to bake into the authorize URL for this PKCE verifier. */
	stateFor: (verifier: string) => string;
}

export interface OAuthFlow {
	buildAuthUrl(challenge: string, state: string, redirectUri?: string): string;
	exchangeCode(
		code: string,
		verifier: string,
		opts?: { state?: string; redirectUri?: string; signal?: AbortSignal },
	): Promise<OAuthCredential>;
	/** Store the credential single-active and disarm the paste fallback. */
	store(cred: OAuthCredential): Promise<void>;
	login(): Promise<void>;
	manualStart(): Promise<void>;
	loginWithManualCode(input: string): Promise<void>;
	logout(): Promise<void>;
	getValidAuth(): Promise<string | null>;
}

// Every token request gets the deadline; a caller-supplied signal (the
// device-code route's cancellation) is combined with it rather than replacing it.
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
	const deadline = AbortSignal.timeout(TOKEN_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export function createOAuthFlow(config: OAuthProviderConfig): OAuthFlow {
	// Retained across an attempt so the manual-paste fallback can reuse the
	// verifier that was baked into the already-opened authorize URL. The token
	// exchange must repeat the redirect_uri the authorize URL carried, so it is
	// recorded here too.
	let pending: { verifier: string; state: string; redirectUri: string } | null = null;

	function buildAuthUrl(
		challenge: string,
		state: string,
		redirectUri: string = config.redirectUri,
	): string {
		const core: Record<string, string> = {
			client_id: config.clientId,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: config.scopes,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
		};
		const params = new URLSearchParams(config.authorizeParams?.(core) ?? core);
		return `${config.authorizeUrl}?${params.toString()}`;
	}

	// Both grants hit the same endpoint; only the encoding differs by provider.
	async function postToken(
		body: Record<string, string>,
		what: string,
		signal?: AbortSignal,
	): Promise<OAuthCredential> {
		const json = config.tokenBody === "json";
		const res = await fetch(config.tokenUrl, {
			method: "POST",
			headers: json
				? { "Content-Type": "application/json", Accept: "application/json" }
				: { "Content-Type": "application/x-www-form-urlencoded" },
			body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
			signal: withTimeout(signal),
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
		opts: { state?: string; redirectUri?: string; signal?: AbortSignal } = {},
	): Promise<OAuthCredential> {
		const body: Record<string, string> = {
			grant_type: "authorization_code",
			client_id: config.clientId,
			code,
			redirect_uri: opts.redirectUri ?? config.redirectUri,
			code_verifier: verifier,
		};
		if (config.sendStateToToken && opts.state !== undefined) body.state = opts.state;
		return postToken(body, "token exchange", opts.signal);
	}

	// Spend the refresh token for a fresh pair. The refresh token rotates on use,
	// so only one caller may ever run this per stored credential (token-refresh.ts).
	function refreshToken(refresh: string): Promise<OAuthCredential> {
		return postToken(
			{ grant_type: "refresh_token", client_id: config.clientId, refresh_token: refresh },
			"token refresh",
		);
	}

	async function store(cred: OAuthCredential): Promise<void> {
		// Single-active: this also signs out whichever other provider was connected.
		await setActiveCredential(config.id, cred);
		pending = null;
	}

	// The stored credential for this provider, or null when there is none. The
	// store holds a provider credential of either shape, and only the OAuth triple
	// is one this app can refresh.
	async function loadStored(): Promise<OAuthCredential | null> {
		const cred = (await loadCredentials())[config.id];
		return isOAuthCredential(cred) ? cred : null;
	}

	// Generate PKCE, arm the paste fallback, and return the authorize URL to open.
	async function start(
		redirectUri: string,
	): Promise<{ verifier: string; state: string; url: string }> {
		const { verifier, challenge } = await generatePKCE();
		const state = config.stateFor(verifier);
		pending = { verifier, state, redirectUri };
		return { verifier, state, url: buildAuthUrl(challenge, state, redirectUri) };
	}

	async function login(): Promise<void> {
		const { verifier, state, url } = await start(config.redirectUri);

		// Start the listener first (it binds immediately), then open the browser.
		const listener = invoke<{ code: string; state: string }>("start_oauth_callback_listener", {
			expectedState: state,
			port: config.callbackPort,
			path: config.callbackPath,
		});
		await openUrl(url);

		let code: string;
		try {
			({ code } = await listener);
		} catch (e) {
			throw new Error(`AUTO_CALLBACK_FAILED: ${errMsg(e)}`);
		}
		await store(await exchangeCode(code, verifier, { state }));
	}

	async function manualStart(): Promise<void> {
		const { url } = await start(config.manualRedirectUri ?? config.redirectUri);
		await openUrl(url);
	}

	async function loginWithManualCode(input: string): Promise<void> {
		if (!pending) throw new Error(`no pending ${config.label} login; start login first`);
		const { code, state } = parseManualInput(input);
		if (config.verifyPastedState && state && state !== pending.state) {
			throw new Error("OAuth state mismatch");
		}
		await store(
			await exchangeCode(code, pending.verifier, {
				state: state ?? pending.state,
				redirectUri: pending.redirectUri,
			}),
		);
	}

	async function logout(): Promise<void> {
		await updateCredentials((s) => {
			delete s[config.id];
		});
	}

	async function getValidAuth(): Promise<string | null> {
		const cred = await loadStored();
		if (!cred) return null;
		if (Date.now() < cred.expires) return cred.access;

		return coalesceRefresh(config.id, async () => {
			// Re-read inside the coalescer: a refresh that finished between our read
			// and our turn already spent this refresh token, and left the only valid
			// successor on disk.
			const current = await loadStored();
			if (!current) return null;
			if (Date.now() < current.expires) return current.access;

			const next = await refreshToken(current.refresh);
			await updateCredentials((s) => {
				// A sign-in or sign-out that landed while the exchange was in flight
				// owns the file now; putting our token back would undo it.
				const held = s[config.id];
				if (isOAuthCredential(held) && held.refresh === current.refresh) s[config.id] = next;
			});
			return next.access;
		});
	}

	return {
		buildAuthUrl,
		exchangeCode,
		store,
		login,
		manualStart,
		loginWithManualCode,
		logout,
		getValidAuth,
	};
}
