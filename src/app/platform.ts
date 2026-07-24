// Platform detection for the webview. Used to pick the login layout: desktop
// keeps the loopback OAuth flow as the primary path; mobile (iOS and Android)
// has no working loopback listener, so the code-based flows are promoted to
// primary.
//
// iPadOS 13+ reports itself as "Macintosh" in the UA and is only distinguishable
// by touch points (a real Mac reports maxTouchPoints 0). Desktop Tauri webviews
// on Linux/macOS/Windows all return false here, so the desktop path is unchanged.

export function isIOS(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	if (/iPad|iPhone|iPod/.test(ua)) return true;
	return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export function isAndroid(): boolean {
	if (typeof navigator === "undefined") return false;
	return /Android/.test(navigator.userAgent);
}

// True on any mobile OS. The loopback OAuth listener (a bound localhost socket in
// Rust) is unavailable on both iOS and Android, so both promote the code flow to
// the primary sign-in action; desktop is unchanged.
export function isMobileOS(): boolean {
	return isIOS() || isAndroid();
}
