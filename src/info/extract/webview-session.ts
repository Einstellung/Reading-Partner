// The user's own session with a site, from the frontend side
// (src-tauri/src/webview_fetch/session.rs, docs/17).
//
// Three calls, one per thing a reader does about a site that reads better
// signed in: open its login page, ask whether the profile is signed in, and
// sign out. No credential ever reaches this side — the sign-in happens in a
// window the site itself draws, and what it leaves behind is a cookie in the
// fetcher's own profile.

import { invoke } from "@tauri-apps/api/core";
import { hasWebviewFetch } from "../../platform/app/platform";
import type { WebviewFetchStatus } from "./webview-article";

export interface SignInOutcome {
	/** Whether the user closed the window, which is what ends the flow. */
	closed: boolean;
	elapsedMs: number;
}

export interface SessionStatus {
	/** How the page load went. Only `ok`/`empty` make `signedIn` meaningful. */
	status: WebviewFetchStatus;
	/** The page offered no way to sign in, so the session is real. */
	signedIn: boolean;
	checkedUrl: string;
	finalUrl: string | null;
	title: string | null;
	elapsedMs: number;
	detail: string | null;
}

/**
 * Show the site's own sign-in page in a window the user can type into, and
 * resolve when they close it. Closing is the completion signal: what "signed
 * in" looks like differs per site and per identity provider, and guessing at it
 * from the DOM guesses wrong.
 */
export async function openSiteSignIn(url: string): Promise<SignInOutcome> {
	if (!hasWebviewFetch()) return { closed: false, elapsedMs: 0 };
	return invoke<SignInOutcome>("open_site_sign_in", { url });
}

/** Load a page in the hidden window and report whether the site still offers a sign-in. */
export async function checkSiteSession(url: string): Promise<SessionStatus> {
	if (!hasWebviewFetch()) {
		return {
			status: "unsupported",
			signedIn: false,
			checkedUrl: url,
			finalUrl: null,
			title: null,
			elapsedMs: 0,
			detail: "no webview session on this platform",
		};
	}
	return invoke<SessionStatus>("check_site_session", { url });
}

/** Sign out of a site: delete its cookies from the fetcher's profile. */
export async function clearSiteCookies(host: string): Promise<string[]> {
	if (!hasWebviewFetch()) return [];
	return invoke<string[]>("clear_site_cookies", { host });
}
