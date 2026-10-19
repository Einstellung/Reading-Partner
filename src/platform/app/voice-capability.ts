// Whether this device can hold a voice call (docs/companion/89, "Memory gate").
//
// iOS always can and desktop never can, so neither asks anything. Android asks
// the voice plugin's `voice_capability` command, because the answer is a
// property of the device (API level, whether the engine library shipped for
// its ABI, how much RAM it has) and only the host can see it. The answer is
// held here for the life of the webview: it is hardware, it does not change.
//
// Until the command answers, and if it never does (it fails, the ACL refuses
// it, an older shell does not have it), the capability is false. There is no
// degraded mode: no capability means no voice entry point at all.
//
// `subscribeVoiceCapability` exists because the answer lands after first
// paint. A component that reads `hasNativeSpeech()` through
// `useSyncExternalStore` shows the entry the moment it is known.

import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";

export const VOICE_CAPABILITY_COMMAND = "plugin:voice|voice_capability";

type Invoke = <T>(command: string) => Promise<T>;

let androidCall = false;
let started = false;
const listeners = new Set<() => void>();

function hostPlatform(): string | null {
	try {
		return platform();
	} catch {
		// Not running under Tauri (unit tests, plain-browser dev).
		return null;
	}
}

// The Android answer as last heard; false until it arrives.
export function androidVoiceCapable(): boolean {
	return androidCall;
}

// Whether this device can hold a voice call. A function of the platform alone
// on iOS (true) and everywhere else but Android (false); on Android, what the
// plugin said.
export function voiceCallCapable(): boolean {
	switch (hostPlatform()) {
		case "ios":
			return true;
		case "android":
			return androidCall;
		default:
			return false;
	}
}

// Ask once, on Android only. Safe to call again: the second call is a no-op.
// Never throws; a failed command leaves the capability false.
export async function loadVoiceCapability(call: Invoke = invoke): Promise<void> {
	if (started || hostPlatform() !== "android") return;
	started = true;
	let answer: unknown;
	try {
		answer = await call<unknown>(VOICE_CAPABILITY_COMMAND);
	} catch {
		return;
	}
	const ok = typeof answer === "object" && answer !== null && (answer as { call?: unknown }).call === true;
	if (ok === androidCall) return;
	androidCall = ok;
	for (const fn of [...listeners]) fn();
}

export function subscribeVoiceCapability(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

// Test seam: forget what was heard and let the next load ask again.
export function resetVoiceCapability(): void {
	androidCall = false;
	started = false;
	listeners.clear();
}
