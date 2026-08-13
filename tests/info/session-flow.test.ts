// The order the three site-session gestures happen in
// (src/info/sources/session-flow.ts). Over ports, because the part worth pinning
// is the sequencing: signing in is two waits and the second starts the instant
// the first ends, a window that never opened must not be followed by a
// confirmation of nothing, and a check that throws must still release the row.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  runSessionCheck,
  runSignIn,
  runSignOut,
  type SessionFlowPorts,
} from "../../src/info/sources/session-flow";
import type { SessionBusy, SignInSite, SiteSessions } from "../../src/info/sources/site-session";

const SITE: SignInSite = {
  host: "www.bloomberg.com",
  label: "bloomberg.com",
  signInUrl: "https://www.bloomberg.com/account/signin",
  checkUrl: "https://www.bloomberg.com/",
  sourceNames: ["Bloomberg Technology"],
  sourceIds: ["bloomberg-tech"],
};

interface Recorder {
  ports: SessionFlowPorts;
  // Every value setBusy was given, in order, so a gap between the two waits
  // would show up as a null in the middle.
  busy: (SessionBusy | null)[];
  saved: SiteSessions[];
  pushed: SiteSessions[];
  opened: string[];
  checked: string[];
  cleared: string[];
}

function recorder(opts: {
  stored?: SiteSessions;
  check?: () => Promise<{ status: string; signedIn: boolean; detail?: string | null }>;
  openSignIn?: () => Promise<unknown>;
  clearCookies?: () => Promise<unknown>;
} = {}): Recorder {
  const r: Recorder = {
    busy: [],
    saved: [],
    pushed: [],
    opened: [],
    checked: [],
    cleared: [],
    ports: null as unknown as SessionFlowPorts,
  };
  r.ports = {
    check: (url) => {
      r.checked.push(url);
      return (opts.check ?? (async () => ({ status: "ok", signedIn: true })))();
    },
    openSignIn: (url) => {
      r.opened.push(url);
      return (opts.openSignIn ?? (async () => undefined))();
    },
    clearCookies: (host) => {
      r.cleared.push(host);
      return (opts.clearCookies ?? (async () => []))();
    },
    loadSessions: async () => opts.stored ?? {},
    saveSessions: async (s) => {
      r.saved.push(s);
    },
    now: () => 1_700_000_000_000,
    setBusy: (b) => r.busy.push(b),
    setSessions: (s) => r.pushed.push(s),
  };
  return r;
}

test("a check names the wait, stores the answer, and releases the row", async () => {
  const r = recorder();
  await runSessionCheck(r.ports, SITE);
  expect(r.checked).toEqual(["https://www.bloomberg.com/"]);
  expect(r.busy).toEqual([{ host: SITE.host, work: "checking" }, null]);
  expect(r.saved).toEqual([{ [SITE.host]: { signedIn: true, checkedAt: 1_700_000_000_000 } }]);
  expect(r.pushed).toEqual(r.saved);
});

// Being blocked says nothing about whether the reader has an account, so the
// stored answer survives — but the row still has to come back, or the site sits
// on "Checking the site…" forever.
test("a check that could not tell keeps the prior answer and still releases the row", async () => {
  const r = recorder({
    stored: { [SITE.host]: { signedIn: true, checkedAt: 1 } },
    check: async () => ({ status: "blocked", signedIn: false, detail: "bot wall" }),
  });
  await runSessionCheck(r.ports, SITE);
  expect(r.saved[0][SITE.host]).toEqual({
    signedIn: true,
    checkedAt: 1_700_000_000_000,
    unknown: "bot wall",
  });
  expect(r.busy[r.busy.length - 1]).toBe(null);
});

test("a check that threw writes nothing and still releases the row", async () => {
  const r = recorder({
    check: async () => {
      throw new Error("no webview here");
    },
  });
  await runSessionCheck(r.ports, SITE);
  expect(r.saved).toEqual([]);
  expect(r.pushed).toEqual([]);
  expect(r.busy).toEqual([{ host: SITE.host, work: "checking" }, null]);
});

// Two waits, and the reader has to be told which one they are in: the window is
// theirs to finish, the ~16s confirmation is the app's. One "Working…" spanning
// both says something is happening and nothing about what.
test("signing in goes from the window straight into the confirmation, with no idle frame", async () => {
  const r = recorder();
  await runSignIn(r.ports, SITE);
  expect(r.opened).toEqual(["https://www.bloomberg.com/account/signin"]);
  expect(r.busy).toEqual([
    { host: SITE.host, work: "signing-in" },
    { host: SITE.host, work: "confirming" },
    null,
  ]);
  expect(r.checked).toEqual(["https://www.bloomberg.com/"]);
});

// Closing the window says the flow is over, not that it worked — but a window
// that never opened is not a flow at all, and confirming it would spend ~16s
// asking about something that did not happen.
test("a sign-in window that never opened is not followed by a confirmation", async () => {
  const r = recorder({
    openSignIn: async () => {
      throw new Error("webview unavailable");
    },
  });
  await runSignIn(r.ports, SITE);
  expect(r.checked).toEqual([]);
  expect(r.saved).toEqual([]);
  expect(r.busy).toEqual([{ host: SITE.host, work: "signing-in" }, null]);
});

test("signing out clears the cookies and forgets the site", async () => {
  const r = recorder({ stored: { [SITE.host]: { signedIn: true, checkedAt: 1 }, "other.com": { signedIn: false, checkedAt: 2 } } });
  await runSignOut(r.ports, SITE);
  expect(r.cleared).toEqual([SITE.host]);
  expect(r.saved).toEqual([{ "other.com": { signedIn: false, checkedAt: 2 } }]);
  expect(r.busy).toEqual([{ host: SITE.host, work: "signing-out" }, null]);
});

test("a sign-out that failed forgets nothing and still releases the row", async () => {
  const r = recorder({
    stored: { [SITE.host]: { signedIn: true, checkedAt: 1 } },
    clearCookies: async () => {
      throw new Error("cookie jar locked");
    },
  });
  await runSignOut(r.ports, SITE);
  expect(r.saved).toEqual([]);
  expect(r.busy[r.busy.length - 1]).toBe(null);
});
