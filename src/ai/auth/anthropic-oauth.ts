// Anthropic subscription OAuth (Claude Pro/Max): authorization code + PKCE.
// The shared skeleton — authorize URL, token exchange, refresh, storage — is in
// oauth-flow.ts; this file is the Anthropic client and the differences.
// Loopback auto-capture is the finalized path; manual paste is the fallback when
// port 53692 is busy or the browser is on another machine.

import { createOAuthFlow } from "./oauth-flow";

const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";

// The code-display variant: with this registered redirect, the authorize page
// lands on a console.anthropic.com page that shows the code (code#state) for
// copy-paste. The localhost redirect never displays a code — `code=true` alone
// does not change that — so the manual flow must use this one (real-iPad
// finding; Claude Code's own paste-code login uses the same).
export const MANUAL_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";

const flow = createOAuthFlow({
	id: "anthropic",
	label: "Anthropic",
	clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
	authorizeUrl: "https://claude.ai/oauth/authorize",
	tokenUrl: "https://platform.claude.com/v1/oauth/token",
	scopes:
		"org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
	redirectUri: `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`,
	callbackPort: CALLBACK_PORT,
	callbackPath: CALLBACK_PATH,
	manualRedirectUri: MANUAL_REDIRECT_URI,
	// `code=true` leads, then the PKCE core unchanged.
	authorizeParams: (core) => ({ code: "true", ...core }),
	tokenBody: "json",
	// The token endpoint takes JSON and wants the state back with the code, so it
	// is the server that checks it.
	sendStateToToken: true,
	verifyPastedState: false,
	stateFor: (verifier) => verifier, // pi uses the PKCE verifier as the state value
});

export const buildAuthUrl = flow.buildAuthUrl;

/**
 * Full loopback login: open the system browser, capture the redirect on
 * localhost:53692 via the Rust listener, exchange the code, and store the token.
 *
 * Throws `AUTO_CALLBACK_FAILED` if the loopback couldn't run (port busy/timeout);
 * the browser is already showing the code, so the UI should prompt for a paste
 * and call {@link anthropicLoginWithManualCode}.
 */
export const anthropicLogin = flow.login;

/**
 * Start a paste-based login without the loopback listener: generate PKCE, open
 * the authorize page with the code-display redirect (the page then shows the
 * code as code#state), and arm {@link anthropicLoginWithManualCode}. This is
 * the iOS entry (no loopback); the user copies the shown code and pastes it back.
 */
export const anthropicLoginManualStart = flow.manualStart;

/** Fallback: exchange a code the user pasted from the authorize page. */
export const anthropicLoginWithManualCode = flow.loginWithManualCode;

export const anthropicLogout = flow.logout;

/**
 * Returns a usable access token, refreshing (and persisting the new token) when
 * the stored one is within the 5-minute expiry skew. Null when not logged in.
 *
 * Concurrent callers share one refresh: the refresh token rotates on use, so a
 * second exchange with the same token fails and logs the user out (see
 * token-refresh.ts).
 */
export const getValidAnthropicAuth = flow.getValidAuth;
