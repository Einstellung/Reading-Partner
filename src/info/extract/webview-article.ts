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
	/** Inline "Read More:" promo lines dropped from the body. */
	promosDropped: number;
	/**
	 * Whether the page still showed a way to sign in — i.e. whether this came
	 * back as an anonymous reader or as the signed-in one.
	 */
	seesSignIn: boolean;
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
		promosDropped: 0,
		seesSignIn: false,
		warmed: false,
		elapsedMs: 0,
		detail,
	};
}

/**
 * What a fetch means for the item that asked for it.
 *
 * `retry` is the distinction that matters: a bot wall, a timeout and a dead
 * network are all "no body this time", and none of them is evidence that the
 * article has no body. Nothing in the pipeline records a permanent "this one is
 * bodiless" — the run marks an item as paid for so it is not fetched twice in
 * the same run, and the article cache only ever stores bodies that exist — so
 * the next run asks again, which is what a blocked or timed-out fetch deserves.
 */
export type WebviewBody =
  | { kind: "body"; title: string | null; html: string | null; text: string; preview: boolean }
  | { kind: "retry"; reason: string }
  | { kind: "absent"; reason: string };

/**
 * Read a fetch result as a body, a reason to try again, or a body that is not
 * there. Pure.
 *
 * `preview` says the body came back without a session on a source whose bodies
 * depend on one — Bloomberg anonymous is ~500 characters of a story that runs to
 * ~2000 signed in. It is a real body and worth keeping, but it is not the whole
 * article, so the item stays flagged the way a paywall-truncated feed body is.
 * The caller passes whether this source has a sign-in at all: on a site that
 * gives an anonymous reader everything, a sign-in link in the header means
 * nothing.
 */
export function webviewBody(article: WebviewArticle, opts: { hasSignIn?: boolean } = {}): WebviewBody {
  switch (article.status) {
    case "ok": {
      const text = article.text ?? "";
      if (!text.trim()) return { kind: "absent", reason: "the page held no article text" };
      return {
        kind: "body",
        title: article.title,
        html: article.html,
        text,
        preview: !!opts.hasSignIn && article.seesSignIn,
      };
    }
    case "blocked":
    case "timeout":
    case "network":
      return { kind: "retry", reason: article.detail || article.status };
    case "empty":
      return { kind: "absent", reason: article.detail || "no article body on the page" };
    case "unsupported":
      return { kind: "absent", reason: article.detail || "no webview fetcher here" };
  }
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
