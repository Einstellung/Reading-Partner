// Platform detection for the webview. Used to pick the login layout: desktop
// keeps the loopback OAuth flow as the primary path; iOS (iPhone/iPad) has no
// working loopback listener, so the code-based flows are promoted to primary.
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
