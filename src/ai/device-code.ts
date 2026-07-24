// Pure state model for the OpenAI (ChatGPT) device-code login flow. The network
// and polling live in pi-ai's loginOpenAICodexDeviceCode; this module only maps
// its callbacks/outcomes to the states the UI renders, so the mapping is unit
// testable without a network. The driver that wires these to pi-ai and the
// credential store is openaiLoginDeviceCode in openai-oauth.ts.

import type { OAuthDeviceCodeInfo } from "@earendil-works/pi-ai/oauth";

export type DeviceCodeState =
	// Requesting the user code from auth.openai.com.
	| { status: "starting" }
	// User code issued: show it, plus the verification URL to open, and when it
	// expires. We are now polling for authorization.
	| { status: "awaiting"; userCode: string; verificationUri: string; expiresAt: number | null }
	// Authorized and credentials stored.
	| { status: "success" }
	// User cancelled (or pi-ai reported the flow as cancelled).
	| { status: "cancelled" }
	// Flow failed. `canPaste` marks the "device code not enabled for this account"
	// case, where the UI should offer the paste-the-URL fallback instead.
	| { status: "error"; message: string; canPaste: boolean };

// Map pi-ai's device-code info to the awaiting state. `now` is injectable so the
// computed absolute expiry is deterministic in tests.
export function awaitingState(info: OAuthDeviceCodeInfo, now: number = Date.now()): DeviceCodeState {
	return {
		status: "awaiting",
		userCode: info.userCode,
		verificationUri: info.verificationUri,
		expiresAt:
			typeof info.expiresInSeconds === "number" ? now + info.expiresInSeconds * 1000 : null,
	};
}

// Classify a thrown error (or an abort) into a terminal state. pi-ai throws
// "Login cancelled" on abort and a "device code login is not enabled" message
// when the account/workspace has the flow switched off; that second case is the
// one where the paste fallback still works, so it gets canPaste.
export function classifyDeviceCodeError(err: unknown, aborted: boolean): DeviceCodeState {
	const message = err instanceof Error ? err.message : String(err);
	if (aborted || /cancel/i.test(message)) return { status: "cancelled" };
	const canPaste = /not enabled|device code|device auth/i.test(message);
	return {
		status: "error",
		message: canPaste
			? "Device sign-in is not enabled for this account. Paste the sign-in URL instead."
			: message,
		canPaste,
	};
}
