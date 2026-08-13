// The order the three site-session gestures happen in (docs/17): check, sign in,
// sign out. site-session.ts decides what a check means; this decides when it
// runs, what the row says while it is running, and what is written when it is
// over.
//
// Over ports, not over the live webview and store, because the part worth
// pinning is the sequencing: signing in is two waits and the second starts the
// instant the first ends, a sign-in window that never opened must not be
// followed by a confirmation of nothing, and a check that throws must still
// release the row.

import {
  applySessionCheck,
  forgetSession,
  type SessionBusy,
  type SessionWork,
  type SignInSite,
  type SiteSessions,
} from "./site-session";

export interface SessionFlowPorts {
  // Load the site's front page in the hidden window and read what it offers.
  check(url: string): Promise<{ status: string; signedIn: boolean; detail?: string | null }>;
  // The site's own login page, in a window the user types into. It resolves when
  // they close the window.
  openSignIn(url: string): Promise<unknown>;
  clearCookies(host: string): Promise<unknown>;
  loadSessions(): Promise<SiteSessions>;
  saveSessions(sessions: SiteSessions): Promise<void>;
  now(): number;
  // What the row shows: which site is being worked on and at what, or null.
  setBusy(busy: SessionBusy | null): void;
  setSessions(sessions: SiteSessions): void;
}

/**
 * A site's session, checked by loading its front page in the hidden window and
 * seeing whether it still offers a sign-in. ~16s, so the row names the wait
 * rather than only showing one; the answer is cached because the check is not
 * free and the reader wants to see where they stand on arrival, not after a
 * wait.
 *
 * A check that throws leaves the stored answer alone — it learned nothing — but
 * still releases the row, or the site would sit on "Checking the site…" forever.
 */
export async function runSessionCheck(
  ports: SessionFlowPorts,
  site: SignInSite,
  work: SessionWork = "checking",
): Promise<void> {
  ports.setBusy({ host: site.host, work });
  try {
    const status = await ports.check(site.checkUrl);
    const next = applySessionCheck(await ports.loadSessions(), site.host, status, ports.now());
    await ports.saveSessions(next);
    ports.setSessions(next);
  } catch (e) {
    console.warn("session check failed", e);
  } finally {
    ports.setBusy(null);
  }
}

/**
 * Sign in: the site's own page, in a window the user types into. It resolves
 * when they close the window, and the state is checked right after — closing
 * says the flow is over, not that it worked.
 *
 * Straight from one wait to the other with no idle frame between them: the
 * window has closed and the ~16s confirmation starts here. A window that could
 * not be opened is the one case that stops — there is nothing to confirm.
 */
export async function runSignIn(ports: SessionFlowPorts, site: SignInSite): Promise<void> {
  ports.setBusy({ host: site.host, work: "signing-in" });
  try {
    await ports.openSignIn(site.signInUrl);
  } catch (e) {
    console.warn("sign-in window failed", e);
    ports.setBusy(null);
    return;
  }
  await runSessionCheck(ports, site, "confirming");
}

/**
 * Sign out: delete the site's cookies. Nothing else is held, so nothing else has
 * to be undone.
 */
export async function runSignOut(ports: SessionFlowPorts, site: SignInSite): Promise<void> {
  ports.setBusy({ host: site.host, work: "signing-out" });
  try {
    await ports.clearCookies(site.host);
    const next = forgetSession(await ports.loadSessions(), site.host);
    await ports.saveSessions(next);
    ports.setSessions(next);
  } catch (e) {
    console.warn("sign-out failed", e);
  } finally {
    ports.setBusy(null);
  }
}
