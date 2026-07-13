// Route the app's HTTP through the Tauri http plugin so AI provider requests
// bypass the webview's CORS (the Anthropic token endpoint sends no CORS headers)
// and never expose credentials to JS. Only overrides inside Tauri; in a plain
// browser (headless integration tests) the native fetch is left in place.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let installed = false;

export function installFetchBridge(): void {
	if (installed || !isTauri()) return;
	window.fetch = tauriFetch as unknown as typeof window.fetch;
	installed = true;
}
