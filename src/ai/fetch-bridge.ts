// Route AI-provider HTTP through the Tauri http plugin so those requests
// bypass the webview's CORS (the Anthropic token endpoint sends no CORS
// headers) and never expose credentials to JS. Everything else — vite dev
// requests, the reader iframe's assets, any localhost traffic — keeps the
// native fetch: the plugin rejects origins outside its capability allowlist,
// so bridging globally would break them. Only active inside Tauri.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

// Must stay in sync with the http:default allowlist in
// src-tauri/capabilities/default.json.
const BRIDGED_HOSTS = new Set([
	"api.anthropic.com",
	"platform.claude.com",
	"claude.ai",
	"api.openai.com",
	"api.deepseek.com",
]);

function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

let installed = false;

export function installFetchBridge(): void {
	if (installed || !isTauri()) return;
	const nativeFetch = window.fetch.bind(window);
	window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		try {
			const host = new URL(requestUrl(input), window.location.href).hostname;
			if (BRIDGED_HOSTS.has(host)) {
				return tauriFetch(input as Parameters<typeof tauriFetch>[0], init);
			}
		} catch {
			// Unparseable URL: let the native fetch produce the error.
		}
		return nativeFetch(input, init);
	}) as typeof window.fetch;
	installed = true;
}
