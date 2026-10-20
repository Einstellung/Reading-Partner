// Frontend side of the browse session (src-tauri/src/webview_fetch/browse.rs,
// docs/info/88): one hidden page kept open across calls, which the caller
// navigates, reads with its own scripts, scrolls a few hundred pixels at a time,
// sends back, and closes.
//
// It knows no site. What to load, what a script reads and how fast to go are
// the caller's; the X search reading lives in info/x. One session per machine:
// opening a second while one is live answers `busy`, and a session left
// untouched for its idle window closes itself.
//
// The page is never on a screen but does render (docs/pitfall/600): on Linux
// the view sits in an offscreen window, so requestAnimationFrame, the observers
// and real scroll events all run, and a list that loads as it is scrolled does.

import { invoke } from "@tauri-apps/api/core";
import { hasWebviewFetch } from "../../platform/app/platform";

export type BrowseStatus = "ok" | "timeout" | "network" | "closed" | "busy" | "unsupported";

/** What a navigation or a step back came to. */
export interface BrowseLoad {
	status: BrowseStatus;
	/** Where the page is now, redirects included; only ever the new document's. */
	url: string | null;
	title: string | null;
	/** Whether the engine reported the load finished. A page is often readable long before. */
	loaded: boolean;
	/** The `until` script's last value on the new document. */
	value: unknown | null;
	/** What the `until` script threw. */
	error: string | null;
	elapsedMs: number;
	detail: string | null;
}

/** What a script run in the page came to. `error` is the script's own; the status says the page answered. */
export interface BrowseEval {
	status: BrowseStatus;
	url: string | null;
	title: string | null;
	value: unknown | null;
	error: string | null;
	elapsedMs: number;
	detail: string | null;
}

/** Where a scroll left the page, in CSS pixels. `before === after` means it had nowhere to go. */
export interface BrowseScroll {
	status: BrowseStatus;
	before: number;
	after: number;
	/** The document's scrollHeight after the move. */
	height: number;
	/** innerHeight: one screen. */
	viewport: number;
	detail: string | null;
}

export interface BrowseWaitOptions {
	/**
	 * An expression or IIFE run in the page every half second until it comes back
	 * truthy on the new document; that ends the wait. It runs many times, so it
	 * must only read. Without it the wait ends on the load event or on a document
	 * that has parsed and rendered something.
	 */
	until?: string;
	/** Ceiling on the wait, clamped host-side to 2-180 s. Default 60 s. */
	timeoutMs?: number;
}

export interface BrowseSession {
	readonly id: number;
	/** Load `url`. Throws only for a URL the fetcher refuses outright (non-web, local). */
	navigate(url: string, opts?: BrowseWaitOptions): Promise<BrowseLoad>;
	/** One step back in the page's history, waited for the same way. */
	back(opts?: BrowseWaitOptions): Promise<BrowseLoad>;
	/** Run `script` (an expression or IIFE with a JSON-serialisable value). */
	evaluate(script: string, opts?: { timeoutMs?: number }): Promise<BrowseEval>;
	/** One `window.scrollBy(0, dy)` in the page. */
	scrollBy(dy: number): Promise<BrowseScroll>;
	/** Close the page. Answers whether it was still open. */
	close(): Promise<boolean>;
}

export type BrowseOpen =
	| { status: "ok"; session: BrowseSession }
	| { status: Exclude<BrowseStatus, "ok">; detail: string | null };

/** The host calls, injectable so the wrapper can be tested without one. */
export interface BrowseHost {
	available(): boolean;
	invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T>;
}

const tauriHost: BrowseHost = {
	available: hasWebviewFetch,
	invoke: (cmd, args) => invoke(cmd, args),
};

interface Opened {
	status: BrowseStatus;
	session: number | null;
	detail: string | null;
}

/**
 * Open the browse page, blank. `idleTimeoutMs` is how long it may sit untouched
 * before it closes itself (host-side 1-60 min, default 15). `viewport` is the
 * page's size in CSS pixels (host-side default 1440x900); the page can read it,
 * so pick one a real screen has. `initScript` runs at document start in every
 * page the session loads, in the main frame, before the page's own scripts; a
 * caller that passes one guards it to the sites it is for. Without it the page
 * is left as it comes.
 */
export async function openBrowse(
	opts: { idleTimeoutMs?: number; viewport?: { width: number; height: number }; initScript?: string } = {},
	host: BrowseHost = tauriHost,
): Promise<BrowseOpen> {
	if (!host.available()) {
		return { status: "unsupported", detail: "no hidden-webview browser on this platform" };
	}
	const viewport = opts.viewport ? [opts.viewport.width, opts.viewport.height] : null;
	const opened = await host.invoke<Opened>("browse_open", {
		idleTimeoutMs: opts.idleTimeoutMs ?? null,
		viewport,
		initScript: opts.initScript ?? null,
	});
	if (opened.status !== "ok" || opened.session === null) {
		const status = opened.status === "ok" ? "closed" : opened.status;
		return { status, detail: opened.detail };
	}
	return { status: "ok", session: browseSession(opened.session, host) };
}

function browseSession(id: number, host: BrowseHost): BrowseSession {
	return {
		id,
		navigate: (url, opts = {}) =>
			host.invoke<BrowseLoad>("browse_navigate", {
				session: id,
				url,
				until: opts.until ?? null,
				timeoutMs: opts.timeoutMs ?? null,
			}),
		back: (opts = {}) =>
			host.invoke<BrowseLoad>("browse_back", {
				session: id,
				until: opts.until ?? null,
				timeoutMs: opts.timeoutMs ?? null,
			}),
		evaluate: (script, opts = {}) =>
			host.invoke<BrowseEval>("browse_eval", { session: id, script, timeoutMs: opts.timeoutMs ?? null }),
		scrollBy: (dy) => {
			if (!Number.isFinite(dy)) return Promise.reject(new Error(`not a scroll distance: ${dy}`));
			return host.invoke<BrowseScroll>("browse_scroll", { session: id, dy });
		},
		close: () => host.invoke<boolean>("browse_close", { session: id }),
	};
}
