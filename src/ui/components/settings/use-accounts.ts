// The state behind Settings › Accounts: which accounts there are, where each
// stands, which one is being worked on, and the three gestures (check, sign in,
// sign out). The rows and what they say are info/sources/accounts.ts; the order
// the gestures happen in is info/sources/session-flow.ts. This only binds them
// to React state and the live webview.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeviceRole } from "../../../platform/app/device";
import { hasWebviewSignIn } from "../../../platform/app/platform";
import { accountRows, type AccountContext, type AccountRow } from "../../../info/sources/accounts";
import { loadSiteSessions, loadSources, saveSiteSessions } from "../../../info/sources/source-store";
import {
  runSessionCheck,
  runSignIn,
  runSignOut,
  type SessionFlowPorts,
} from "../../../info/sources/session-flow";
import type { SessionBusy, SignInSite, SiteSessions } from "../../../info/sources/site-session";
import { hasTopicSearches } from "../../../info/topic-search/store";
import type { CollectorSites } from "../../../info/briefer/reader";
import { getInfoView } from "../../../info/program/live";
import {
  checkSiteSession,
  clearSiteCookies,
  openSiteSignIn,
} from "../../../workshop/extract/webview-session";

export interface AccountsController {
  rows: AccountRow[];
  // What accountView needs beside the row: the stored states, the work under
  // way, whether this device signs in, and on a reader the collector's report.
  context: AccountContext;
  check: (site: SignInSite) => void;
  signIn: (site: SignInSite) => void;
  signOut: (site: SignInSite) => void;
}

export function useAccounts(role: DeviceRole | null): AccountsController {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [sessions, setSessions] = useState<SiteSessions>({});
  const [busy, setBusy] = useState<SessionBusy | null>(null);
  const [collector, setCollector] = useState<CollectorSites | null>(null);
  // Signing in needs a webview to open the window with and a reason to: this
  // machine fetching for the briefing and the topic search. Elsewhere the cookie
  // would go into a jar nothing reads (docs/36).
  const canSignIn = hasWebviewSignIn() && role === "collector";

  useEffect(() => {
    let live = true;
    void Promise.all([loadSources(), hasTopicSearches(), loadSiteSessions()])
      .then(([sources, topicSearch, stored]) => {
        if (!live) return;
        setRows(accountRows(sources, topicSearch));
        setSessions(stored);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (role !== "reader") return;
    const view = getInfoView("reader");
    setCollector(view.collectorSites());
    return view.subscribe(() => setCollector(view.collectorSites()));
  }, [role]);

  const ports: SessionFlowPorts = useMemo(
    () => ({
      check: checkSiteSession,
      openSignIn: openSiteSignIn,
      clearCookies: clearSiteCookies,
      loadSessions: loadSiteSessions,
      saveSessions: saveSiteSessions,
      now: Date.now,
      setBusy,
      setSessions,
    }),
    [],
  );

  const check = useCallback((site: SignInSite) => void runSessionCheck(ports, site), [ports]);
  const signIn = useCallback((site: SignInSite) => void runSignIn(ports, site), [ports]);
  const signOut = useCallback((site: SignInSite) => void runSignOut(ports, site), [ports]);

  const context: AccountContext = useMemo(
    () => ({ sessions, busy, canSignIn, ...(role === "reader" ? { remote: { collector } } : {}) }),
    [sessions, busy, canSignIn, role, collector],
  );

  return { rows, context, check, signIn, signOut };
}
