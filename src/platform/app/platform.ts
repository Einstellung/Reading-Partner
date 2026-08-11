// Platform detection for the webview. Used to pick the login layout: desktop
// keeps the loopback OAuth flow as the primary path; iOS (iPhone/iPad) has no
// working loopback listener, so the code-based flows are promoted to primary.
//
// The authoritative answer comes from the OS plugin (the Rust side knows the
// real platform). UA sniffing is only a fallback for non-Tauri contexts (tests,
// plain-browser dev): iPadOS webviews masquerade as "Macintosh" and were
// observed with a touch-point count that defeats the classic heuristic, so the
// plugin call is the one that matters on device.

import { platform } from "@tauri-apps/plugin-os";

// Whether the host can capture the microphone. Voice input records through the
// Rust side (src-tauri/src/voice.rs), which is compiled `#[cfg(desktop)]` — on a
// phone the commands are not registered at all, so a mic button there can only
// produce "command not found". Voice input is a desktop feature and stays one
// (docs/22): a phone keyboard already dictates, and better. This gates the
// button on the capability rather than on the form factor, so the rule holds
// wherever the app runs.
const NATIVE_RECORDER_PLATFORMS = new Set(["linux", "macos", "windows"]);

export function hasNativeRecorder(): boolean {
	try {
		return NATIVE_RECORDER_PLATFORMS.has(platform());
	} catch {
		// Not running under Tauri (unit tests, plain-browser dev): no commands at
		// all, so no recorder either.
		return false;
	}
}

// Whether the host can render an article in a hidden webview
// (src-tauri/src/webview_fetch, docs/17). Same shape as hasNativeRecorder: the
// command is compiled `#[cfg(desktop)]`, and the DOM bridge behind it is
// WebKitGTK's, so only Linux answers today. macOS and Windows are registered but
// return `unsupported`; iOS has no command at all.
const WEBVIEW_FETCH_PLATFORMS = new Set(["linux"]);

export function hasWebviewFetch(): boolean {
	try {
		return WEBVIEW_FETCH_PLATFORMS.has(platform());
	} catch {
		// Not running under Tauri (unit tests, plain-browser dev).
		return false;
	}
}

export function isIOS(): boolean {
	try {
		return platform() === "ios";
	} catch {
		// Not running under Tauri (unit tests, browser dev server).
	}
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	if (/iPad|iPhone|iPod/.test(ua)) return true;
	return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}
