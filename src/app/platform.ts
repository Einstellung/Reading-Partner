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
