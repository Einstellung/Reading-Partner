// Route AI-provider HTTP through the Tauri http plugin so those requests
// bypass the webview's CORS (the Anthropic token endpoint sends no CORS
// headers) and never expose credentials to JS. Everything else — vite dev
// requests, the reader iframe's assets, any localhost traffic — keeps the
// native fetch: the plugin rejects origins outside its capability allowlist,
// so bridging globally would break them. Only active inside Tauri.

import { isTauri } from "../platform/app/host";
import { cleanTauriFetch } from "../platform/app/tauri-fetch";
import { bridgedHosts } from "./providers";

// The hosts the two OAuth flows reach: the authorize pages, the token endpoints,
// and the inference hosts. The four that are not any provider's baseUrl
// (platform.claude.com, claude.ai, api.openai.com, auth.openai.com) are why this
// list exists at all. All CORS-free, and none may see the webview origin.
const OAUTH_HOSTS = [
	"api.anthropic.com",
	"platform.claude.com",
	"claude.ai",
	"api.openai.com",
	"auth.openai.com",
	"chatgpt.com",
];

// Every host the app's AI traffic goes to: the OAuth endpoints plus whatever the
// provider table's baseUrls resolve to (src/ai/providers.ts bridgedHosts). Read
// off the table rather than copied out of it, so a provider added there is
// reachable without a second edit here.
export function bridgedFetchHosts(): Set<string> {
	const hosts = bridgedHosts();
	for (const host of OAUTH_HOSTS) hosts.add(host);
	return hosts;
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

// The Anthropic SDK adds this header in browser environments; requests routed
// through the Rust side are not browser requests, and subscription (OAuth)
// organizations reject any request carrying it ("CORS requests are not
// allowed for this Organization").
const BROWSER_MARKER = "anthropic-dangerous-direct-browser-access";

// De-browserify headers for the Rust path: drop the SDK's browser marker and
// send an empty Origin — with the plugin's unsafe-headers feature an empty
// Origin means "omit the header" (otherwise the plugin force-appends the
// webview origin, and Anthropic treats any Origin-carrying request as CORS).
// See docs/pitfall/15.
function bridgedHeaders(
	init: RequestInit | undefined,
	input: RequestInfo | URL,
): Headers {
	const h = new Headers(
		init?.headers ?? (input instanceof Request ? input.headers : undefined),
	);
	h.delete(BROWSER_MARKER);
	h.set("Origin", "");
	return h;
}

let installed = false;

export function installFetchBridge(): void {
	if (installed || !isTauri()) return;
	const bridged = bridgedFetchHosts();
	const nativeFetch = window.fetch.bind(window);
	window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		try {
			const host = new URL(requestUrl(input), window.location.href).hostname;
			if (bridged.has(host)) {
				const bridgedInit: RequestInit = { ...init, headers: bridgedHeaders(init, input) };
				return cleanTauriFetch(input, bridgedInit);
			}
		} catch {
			// Unparseable URL: let the native fetch produce the error.
		}
		return nativeFetch(input, init);
	}) as typeof window.fetch;
	installed = true;
}
