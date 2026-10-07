// Frontend side of the generic page fetch (src-tauri/src/webview_fetch/page.rs).
// Load any URL in one of the fetcher's hidden windows, optionally run a script
// in it, and get the document's markup and the script's value back.
//
// `webview-article.ts` next door is the article version: it extracts a body and
// warms the site up first. This one extracts nothing and judges nothing — the
// caller's script decides what the page is worth.

import { invoke } from "@tauri-apps/api/core";
import { hasWebviewFetch } from "../../platform/app/platform";
import type { WebviewFetchStatus } from "./webview-article";

export interface WebviewPage {
	status: WebviewFetchStatus;
	requestedUrl: string;
	/** Where the webview ended up, redirects included. */
	finalUrl: string | null;
	title: string | null;
	/** `document.documentElement.outerHTML` once the load settled. */
	html: string | null;
	/**
	 * What the script evaluated to, JSON round-tripped. `null` when no script
	 * was given, or when it threw — `detail` then says why.
	 */
	result: unknown | null;
	elapsedMs: number;
	/**
	 * Human-readable reason: why a status is not `ok`, why the script has no
	 * result, whether the markup was truncated.
	 */
	detail: string | null;
}

/**
 * Render `url` in a hidden webview and return the page.
 *
 * `script` is an expression or an IIFE whose value is JSON-serialisable; it is
 * serialised in the page and parsed here, so `result` is a plain value and
 * never a live DOM node. A script that throws leaves `result` null and puts the
 * error in `detail` — the status still says `ok` if the page itself loaded.
 *
 * `timeoutMs` is the ceiling on the whole call, clamped host-side to between 5
 * and 180 seconds.
 *
 * Throws only when the URL is one the fetcher refuses outright — a non-web
 * scheme, or an address on this machine.
 */
export async function fetchPageViaWebview(
	url: string,
	opts: { script?: string; timeoutMs?: number } = {},
): Promise<WebviewPage> {
	if (!hasWebviewFetch()) {
		return {
			status: "unsupported",
			requestedUrl: url,
			finalUrl: null,
			title: null,
			html: null,
			result: null,
			elapsedMs: 0,
			detail: "no hidden-webview fetcher on this platform",
		};
	}
	return invoke<WebviewPage>("fetch_page_via_webview", {
		url,
		script: opts.script ?? null,
		timeoutMs: opts.timeoutMs ?? null,
	});
}
