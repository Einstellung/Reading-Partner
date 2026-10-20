// The accounts the app can use, and the rows Settings › Accounts draws from
// them (docs/north-star/accounts.md). Pure: the subscribed sources and the
// stored session states go in, the rows and what each one says come out.
//
// One registry entry per account. Today every entry is a browser session — the
// site's own login page in a window the reader types into, the cookie kept on
// this machine (site-session.ts, session-flow.ts). Another site of that kind is
// one more entry here. An account of another kind (an API credential such as a
// GitHub token) is a new `kind` with its own flow beside session-flow.ts; the
// rows and the page take it as one more entry.
//
// Every sign-in URL here is written in code or comes from a subscribed source's
// descriptor, never from a model, which keeps resolveSignInSite's rule: no URL
// a model read can become a login page.

import { t } from "../../i18n";
import { BLOOMBERG_SIGN_IN_URL } from "./builtins";
import type { SourceDescriptor } from "./descriptor";
import {
	allSignInSites,
	sessionLabel,
	sessionWorkFor,
	sessionWorkLabel,
	type SessionBusy,
	type SessionWork,
	type SignInSite,
	type SiteSessions,
	type SiteSessionState,
} from "./site-session";
import { X_SIGN_IN_URL } from "./x-search";

/** One account the app can use. */
export interface AccountDef {
	id: string;
	kind: "site-session";
	/** What the row is called: the service's own name. */
	name: string;
	/** The site's own login page; the session is per host of this URL. */
	signInUrl: string;
	/** What signing in gives the reader, looked up when the row is built. */
	benefit: () => string;
	/** A plain word of advice about which account to sign in with, for a site the app reads on its own. */
	caution?: () => string;
}

export const ACCOUNTS: readonly AccountDef[] = [
	{
		id: "x",
		kind: "site-session",
		name: "X",
		signInUrl: X_SIGN_IN_URL,
		benefit: () => t("sources.account.benefitX"),
		caution: () => t("sources.account.cautionX"),
	},
	{
		id: "bloomberg",
		kind: "site-session",
		name: "Bloomberg",
		signInUrl: BLOOMBERG_SIGN_IN_URL,
		benefit: () => t("sources.account.benefitBloomberg"),
	},
];

/** One row of the Accounts page. */
export interface AccountRow {
	id: string;
	name: string;
	/** What the session flow runs on: the login page, the check URL, the host. */
	site: SignInSite;
	/** The registry's benefit line, translated; null for a row only a source names. */
	benefit: string | null;
	/** The registry's advice on which account to use, translated; null when it has none. */
	caution: string | null;
}

function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

function siteFor(def: AccountDef, host: string): SignInSite {
	return {
		host,
		label: host.replace(/^www\./, ""),
		signInUrl: def.signInUrl,
		checkUrl: new URL("/", def.signInUrl).toString(),
		sourceNames: [],
		sourceIds: [],
	};
}

/**
 * Every account row: the registry's entries in registry order, then any site a
 * subscribed source signs in to that the registry does not name (a source the
 * reader added through the chat). A registry entry whose site a source also
 * names takes that source's site, so the row knows what reads through it.
 *
 * The registry rows are there whether or not anything subscribes to them: this
 * is where the reader signs in before setting something up, too.
 */
export function accountRows(subscribed: SourceDescriptor[], topicSearch: boolean): AccountRow[] {
	const derived = allSignInSites(subscribed, topicSearch);
	const byHost = new Map(derived.map((s) => [s.host, s]));
	const rows: AccountRow[] = [];
	const claimed = new Set<string>();
	for (const def of ACCOUNTS) {
		const host = hostOf(def.signInUrl);
		if (!host || claimed.has(host)) continue;
		claimed.add(host);
		rows.push({
			id: def.id,
			name: def.name,
			site: byHost.get(host) ?? siteFor(def, host),
			benefit: def.benefit(),
			caution: def.caution?.() ?? null,
		});
	}
	for (const site of derived) {
		if (claimed.has(site.host)) continue;
		claimed.add(site.host);
		rows.push({ id: site.host, name: site.label, site, benefit: null, caution: null });
	}
	return rows;
}

/** The sites behind every account row, for the collector's status file. */
export function accountSites(subscribed: SourceDescriptor[], topicSearch: boolean): SignInSite[] {
	return accountRows(subscribed, topicSearch).map((r) => r.site);
}

/** Where an account stands, for the row's status light. */
export type AccountStatus = "signed-in" | "expired" | "signed-out" | "unknown";

export function accountStatus(state: SiteSessionState | undefined): AccountStatus {
	if (!state || state.unknown) return "unknown";
	if (state.signedIn) return "signed-in";
	return state.expired ? "expired" : "signed-out";
}

/** The row's status line: the work under way, or where the account stands. */
export function accountLine(state: SiteSessionState | undefined, work: SessionWork | null): string {
	return work ? sessionWorkLabel(work) : sessionLabel(state);
}

/**
 * The row's second line besides the status: what signing in gives, or — for a
 * row only a source names — which sources read through it.
 */
export function accountDetail(row: AccountRow): string {
	if (row.benefit) return row.benefit;
	return t("sources.account.usedBy", { names: row.site.sourceNames.join(", ") });
}

/** What the collecting machine reports about its sessions (briefer/reader.ts). */
export interface CollectorReport {
	deviceName: string;
	sites: Record<string, boolean>;
}

/**
 * A device that cannot sign in itself (a phone, a tablet, a computer that does
 * not collect): the cookie is on the collecting machine, so that is where the
 * session is and the only place it can be repaired (docs/36). Read-only.
 */
export function remoteAccountView(
	collector: CollectorReport | null,
	host: string,
): { status: AccountStatus; line: string } {
	if (!collector) return { status: "unknown", line: t("sources.account.signInOnCollector") };
	const device = collector.deviceName;
	return collector.sites[host] === true
		? { status: "signed-in", line: t("sources.collectorSignedIn", { device }) }
		: { status: "signed-out", line: t("sources.collectorNeedsSignIn", { device }) };
}

/** Everything one row draws. */
export interface AccountView {
	status: AccountStatus;
	line: string;
	detail: string;
	/** The work under way on this account, which disables its buttons. */
	work: SessionWork | null;
	/** The button besides Check, or null when this device draws no buttons. */
	action: "sign-in" | "sign-out" | null;
}

export interface AccountContext {
	sessions: SiteSessions;
	busy: SessionBusy | null;
	canSignIn: boolean;
	/**
	 * Set on a reader: the session is on the collecting machine, so the row shows
	 * that machine's report (null until one has reported) and draws no buttons.
	 * Unset on a collector, whose own stored state is the real one even where it
	 * has no webview to sign in with.
	 */
	remote?: { collector: CollectorReport | null };
}

export function accountView(row: AccountRow, ctx: AccountContext): AccountView {
	const detail = accountDetail(row);
	if (ctx.remote) {
		return { ...remoteAccountView(ctx.remote.collector, row.site.host), detail, work: null, action: null };
	}
	const state = ctx.sessions[row.site.host];
	const work = sessionWorkFor(ctx.busy, row.site.host);
	const status = accountStatus(state);
	return {
		status,
		line: accountLine(state, work),
		detail,
		work,
		action: ctx.canSignIn ? (status === "signed-in" ? "sign-out" : "sign-in") : null,
	};
}
