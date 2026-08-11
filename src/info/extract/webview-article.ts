// Frontend side of the hidden-webview article fetcher (src-tauri/src/webview_fetch,
// docs/17). One call: give it an article URL, get the rendered body back.
//
// Nothing here decides when to use it. Which sources go through a webview
// instead of plain HTTP is a descriptor question and is not wired yet; this
// module only exposes the capability and the way it fails.

import { invoke } from "@tauri-apps/api/core";
import { hasWebviewFetch } from "../../platform/app/platform";

/**
 * How a fetch ended. The failures stay apart because they call for different
 * answers: `blocked` means a bot wall or captcha answered instead of the page
 * (retrying changes nothing; a real session might), `timeout` means it never
 * settled (retrying may well work), `network` means it never loaded, `empty`
 * means the page loaded and simply had no article in it.
 */
export type WebviewFetchStatus =
	| "ok"
	| "blocked"
	| "empty"
	| "timeout"
	| "network"
	| "unsupported";

export interface WebviewArticle {
	status: WebviewFetchStatus;
	requestedUrl: string;
	/** Where the webview ended up, redirects included. */
	finalUrl: string | null;
	title: string | null;
	/** The article container's rendered text. */
	text: string | null;
	/** That container's markup, for the extraction stack. */
	html: string | null;
	/** Which selector produced the body, or `p-merge`. */
	selector: string | null;
	/** `application/ld+json` blocks from the page, unparsed. */
	ldJson: string[];
	chars: number;
	/** Whether this call paid for a homepage warm-up (tens of seconds). */
	warmed: boolean;
	elapsedMs: number;
	/** Human-readable reason, for the failures. */
	detail: string | null;
}

function unsupported(url: string, detail: string): WebviewArticle {
	return {
		status: "unsupported",
		requestedUrl: url,
		finalUrl: null,
		title: null,
		text: null,
		html: null,
		selector: null,
		ldJson: [],
		chars: 0,
		warmed: false,
		elapsedMs: 0,
		detail,
	};
}

/**
 * Render `url` in a hidden webview and return its article body. Slow by nature:
 * the first article of a site pays for a homepage warm-up (the cookie jar is
 * what gets past the bot wall), so expect tens of seconds there and a few for
 * the ones after it.
 *
 * Throws only when the URL is one the fetcher refuses outright — a non-web
 * scheme, or an address on this machine.
 */
export async function fetchArticleViaWebview(url: string): Promise<WebviewArticle> {
	if (!hasWebviewFetch()) {
		return unsupported(url, "no hidden-webview fetcher on this platform");
	}
	return invoke<WebviewArticle>("fetch_article_via_webview", { url });
}
