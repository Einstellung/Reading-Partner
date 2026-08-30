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

// Whether the host transcribes speech on the device, streaming partials as it
// goes (docs/15). Only iOS does: the commands behind it wrap SpeechAnalyzer,
// which exists nowhere else. A second voice path rather than a fallback for
// hasNativeRecorder — that one records a WAV and ships it to an STT host, this
// one never leaves the phone and has no key to configure.
export function hasOnDeviceDictation(): boolean {
	try {
		return platform() === "ios";
	} catch {
		// Not running under Tauri (unit tests, plain-browser dev): no commands, so
		// no dictation. Deliberately not isIOS()'s UA fallback — that one answers
		// "is this an iPad" for a layout, and an iPad browser has no plugin.
		return false;
	}
}

// Whether the host can say an answer out loud (docs/33). Synthesis and playback
// are both the voice plugin's, and the capability that grants its commands is
// iOS-only (src-tauri/capabilities/ios.json), so a desktop invoke is refused by
// the ACL rather than answered — and off iOS the player answers every sentence
// with "this host cannot speak" anyway (plugins/voice/src/fallback.rs).
//
// Its own question rather than hasOnDeviceDictation's: that one is the
// microphone and this one is the speaker, and the day a desktop gets the grant
// only one of them changes.
export function hasNativeSpeech(): boolean {
	try {
		return platform() === "ios";
	} catch {
		// Not running under Tauri (unit tests, plain-browser dev): no commands.
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

// Whether this is a phone or tablet OS rather than a desktop one. It decides the
// device's role (docs/36): collection needs tens of seconds of live webview per
// article, and a backgrounded mobile app gets seconds of runtime in total, so
// mobile is a reader and the choice is not offered there. Deliberately by
// platform and not by screen size — an iPad runs the desktop shell and is still
// a reader.
const MOBILE_PLATFORMS = new Set(["ios", "android"]);

export function isMobilePlatform(): boolean {
	try {
		return MOBILE_PLATFORMS.has(platform());
	} catch {
		// Not running under Tauri (unit tests, plain-browser dev): treat the dev
		// machine as the desktop it is.
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
