// Which sites the reader has a session with, derived from the sources they
// subscribe to (docs/17).
//
// A `webview` source that names a sign-in page is a source that reads better
// signed in — Bloomberg gives an anonymous reader ~500 characters of a story
// that runs to ~2000 for a subscriber. Several sources share one site and one
// cookie jar (seven Bloomberg sections, one bloomberg.com), so the sign-in is
// per site, not per source, and this is where sources are folded into sites.
//
// Pure: the descriptors go in, the sites come out. Settings › Accounts lists
// them through info/sources/accounts.ts. What the state means and where it is
// stored is below; the calls that change it are in
// workshop/extract/webview-session.ts.

import type { SourceDescriptor } from "./descriptor";
import { X_SEARCH_SOURCE } from "./x-search";
import { t } from "../../i18n";

/** One site the reader can sign in to, and the sources behind it. */
export interface SignInSite {
	/** Registrable host as the descriptor spells it ("www.bloomberg.com"). */
	host: string;
	/** What to show: the host without www ("bloomberg.com"). */
	label: string;
	/** The site's own login page. */
	signInUrl: string;
	/** Where to load when checking whether the session is real: the site root. */
	checkUrl: string;
	/** Names of the subscribed sources that read through this session. */
	sourceNames: string[];
	/** Ids of those same sources, so a caller may name either. */
	sourceIds: string[];
}

/** Last known answer for one site. Cached, never authoritative — the site is. */
export interface SiteSessionState {
	signedIn: boolean;
	/** When the check ran (epoch ms). */
	checkedAt: number;
	/** Set when the check could not tell (a wall, a timeout, no webview). */
	unknown?: string;
	/**
	 * Signed out by the site rather than by the reader: a check found no session
	 * where an earlier one had found one. Signing out here forgets the site, so
	 * this never follows the reader's own sign-out.
	 */
	expired?: boolean;
}

export type SiteSessions = Record<string, SiteSessionState>;

function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * The sign-in rows for a source list: one per site, in the order the sites first
 * appear, with the sources that read through each.
 *
 * Disabled sources count. A reader sets a subscription up before turning it on,
 * and a site whose session has expired should say so whether or not its feeds
 * are currently being polled.
 */
export function signInSites(sources: SourceDescriptor[]): SignInSite[] {
	const byHost = new Map<string, SignInSite>();
	for (const source of sources) {
		if (source.fulltext.mode !== "webview") continue;
		const signInUrl = source.fulltext.signInUrl;
		if (!signInUrl) continue;
		const host = hostOf(signInUrl);
		if (!host) continue;
		const existing = byHost.get(host);
		if (existing) {
			if (!existing.sourceNames.includes(source.name)) existing.sourceNames.push(source.name);
			if (!existing.sourceIds.includes(source.id)) existing.sourceIds.push(source.id);
			continue;
		}
		byHost.set(host, {
			host,
			label: host.replace(/^www\./, ""),
			signInUrl,
			// The root rather than the article or the login page. The login page
			// says nothing about a session that already exists — checked on a
			// cold profile it reads as "signed in", because a page whose whole
			// job is signing in has no sign-in link to offer — and an article is
			// a slow and paywalled way to ask a simple question.
			checkUrl: new URL("/", signInUrl).toString(),
			sourceNames: [source.name],
			sourceIds: [source.id],
		});
	}
	return [...byHost.values()];
}

/**
 * Every site the reader can sign in to on this device: the subscribed sources'
 * sites, then X when the reader has a topic search (`hasTopicSearches`, active
 * or stopped). X search is not a subscription; the topic search reads it in the
 * browse window (x-search.ts), and a reader with no topic search has no use for
 * an X session. What the companion and the collector's status file list; the
 * Accounts page lists every account in its registry besides (accounts.ts).
 */
export function allSignInSites(subscribed: SourceDescriptor[], topicSearch: boolean): SignInSite[] {
	return signInSites(topicSearch ? [...subscribed, X_SEARCH_SOURCE] : subscribed);
}

/** How a site is offered to a caller that has to pick one: name, then sources. */
export function signInSiteLine(site: SignInSite): string {
	return `${site.label} — ${site.sourceNames.join(", ")}`;
}

function siteKey(text: string): string {
	return text.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * The site an identifier names, or null.
 *
 * A caller picks a site out of this list; it never describes one. That is the
 * whole design of the lookup, and it is what makes it safe to hand to the AI
 * companion: a sign-in window can only ever open a URL that came from the
 * reader's own subscribed sources, so a URL sitting in an article body or a page
 * the model read has no path to becoming a login page. An identifier that
 * matches nothing is refused rather than resolved to the nearest site — a
 * "close enough" match is the same hole with an extra step.
 */
export function resolveSignInSite(sites: SignInSite[], identifier: string): SignInSite | null {
	const want = siteKey(identifier);
	if (!want) return null;
	for (const site of sites) {
		if (siteKey(site.host) === want || siteKey(site.label) === want) return site;
		if (site.sourceIds.some((id) => siteKey(id) === want)) return site;
		if (site.sourceNames.some((name) => siteKey(name) === want)) return site;
	}
	return null;
}

/** What a site's row prints for a site that nothing is happening to. */
export function sessionLabel(state: SiteSessionState | undefined): string {
	if (!state) return t("sources.session.notChecked");
	if (state.unknown) return t("sources.session.couldNotTell");
	if (state.signedIn) return t("sources.session.signedIn");
	return state.expired ? t("sources.session.expired") : t("sources.session.notSignedIn");
}

/**
 * What the app is doing about one site right now.
 *
 * Signing in is two waits, not one, and they are nothing alike: first the reader
 * types into a window of the site's own, which ends when they close it, and then
 * the app loads the site's front page to see whether it worked, which takes
 * ~16s. One "Working…" spanning both says something is happening and nothing
 * about what, to a reader who has just closed the window and has no idea what
 * the app is now waiting for.
 */
export type SessionWork = "signing-in" | "confirming" | "checking" | "signing-out";

/** Which site is being worked on, and at what. */
export interface SessionBusy {
	host: string;
	work: SessionWork;
}

/** What a site's row prints while `work` is running. */
export function sessionWorkLabel(work: SessionWork): string {
	switch (work) {
		// The window is open and the reader is in it. This line says what ends the
		// flow, for the moment they look back at this screen; the window's own
		// title says the same thing where they are actually looking
		// (webview_fetch/session.rs).
		case "signing-in":
			return t("sources.session.workSigningIn");
		case "confirming":
			return t("sources.session.workConfirming");
		case "checking":
			return t("sources.session.workChecking");
		case "signing-out":
			return t("sources.session.workSigningOut");
	}
}

/** The work under way on `host`, or null when that site is idle. */
export function sessionWorkFor(
	busy: SessionBusy | null | undefined,
	host: string,
): SessionWork | null {
	return busy && busy.host === host ? busy.work : null;
}

/**
 * Fold a check into the stored state. A check that could not tell (a bot wall
 * answered, the load timed out, there is no webview here) records that it could
 * not tell rather than overwriting a real answer with "signed out" — being
 * blocked says nothing about whether the reader has an account.
 *
 * A real "signed out" after a "signed in" is an expiry: the reader did not sign
 * out (that forgets the site), so the site did. It stays expired through later
 * checks until one finds a session again.
 */
export function applySessionCheck(
	sessions: SiteSessions,
	host: string,
	check: { status: string; signedIn: boolean; detail?: string | null },
	now: number,
): SiteSessions {
	const conclusive = check.status === "ok" || check.status === "empty";
	const prior = sessions[host];
	if (!conclusive) {
		return {
			...sessions,
			[host]: {
				signedIn: prior?.signedIn ?? false,
				checkedAt: now,
				unknown: check.detail || check.status,
				...(prior?.expired ? { expired: true } : {}),
			},
		};
	}
	const expired = !check.signedIn && !!prior && (prior.signedIn || !!prior.expired);
	return {
		...sessions,
		[host]: { signedIn: check.signedIn, checkedAt: now, ...(expired ? { expired: true } : {}) },
	};
}

/** Forget a site's state, after signing out of it. */
export function forgetSession(sessions: SiteSessions, host: string): SiteSessions {
	const next = { ...sessions };
	delete next[host];
	return next;
}

/** Parse the stored file, dropping anything that is not a state. */
export function parseSiteSessions(text: string): SiteSessions {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return {};
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) return {};
	const out: SiteSessions = {};
	for (const [host, value] of Object.entries(data as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const v = value as Record<string, unknown>;
		if (typeof v.signedIn !== "boolean" || typeof v.checkedAt !== "number") continue;
		out[host] = {
			signedIn: v.signedIn,
			checkedAt: v.checkedAt,
			...(typeof v.unknown === "string" ? { unknown: v.unknown } : {}),
			...(v.expired === true ? { expired: true } : {}),
		};
	}
	return out;
}
