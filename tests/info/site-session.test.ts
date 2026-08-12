// Which sites a source list can be signed in to, and what a check means
// (src/info/sources/site-session.ts). Pure — no webview, no fs. Run: bun test.

import { expect, test } from "bun:test";
import {
  applySessionCheck,
  forgetSession,
  parseSiteSessions,
  resolveSignInSite,
  sessionLabel,
  sessionRowLine,
  sessionWorkFor,
  sessionWorkLabel,
  signInSiteLine,
  signInSites,
} from "../../src/info/sources/site-session";
import { BUILTIN_SOURCES } from "../../src/info/sources/builtins";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";

const BLOOMBERG = BUILTIN_SOURCES.filter((s) => s.id.startsWith("bloomberg-"));

test("seven Bloomberg sections are one site with one sign-in", () => {
  const sites = signInSites(BLOOMBERG);
  expect(sites.length).toBe(1);
  expect(sites[0].host).toBe("www.bloomberg.com");
  expect(sites[0].label).toBe("bloomberg.com");
  expect(sites[0].signInUrl).toBe("https://www.bloomberg.com/account/signin");
  // The check loads the site's front page: the login page says nothing about a
  // session that already exists.
  expect(sites[0].checkUrl).toBe("https://www.bloomberg.com/");
  expect(sites[0].sourceNames.length).toBe(BLOOMBERG.length);
  expect(sites[0].sourceIds.length).toBe(BLOOMBERG.length);
});

test("a site is resolved by its own name, its host, or one of its sources", () => {
  const sites = signInSites(BLOOMBERG);
  const want = sites[0];
  expect(resolveSignInSite(sites, "bloomberg.com")).toBe(want);
  expect(resolveSignInSite(sites, "www.bloomberg.com")).toBe(want);
  expect(resolveSignInSite(sites, "  Bloomberg.COM ")).toBe(want);
  expect(resolveSignInSite(sites, BLOOMBERG[0].id)).toBe(want);
  expect(resolveSignInSite(sites, BLOOMBERG[0].name)).toBe(want);
  expect(signInSiteLine(want)).toContain("bloomberg.com — ");
});

test("an identifier that is not in the list resolves to nothing, and an address never resolves", () => {
  const sites = signInSites(BLOOMBERG);
  // No fallback to the only site there is: a request the reader's own sources
  // cannot account for is refused, not approximated.
  expect(resolveSignInSite(sites, "")).toBeNull();
  expect(resolveSignInSite(sites, "  ")).toBeNull();
  expect(resolveSignInSite(sites, "bloomberg")).toBeNull();
  expect(resolveSignInSite(sites, "example.com")).toBeNull();
  // The shapes an injected instruction would reach for. None of them is a name
  // in the list, so none of them opens anything.
  expect(resolveSignInSite(sites, "https://bloomberg.com.evil.test/signin")).toBeNull();
  expect(resolveSignInSite(sites, "https://www.bloomberg.com/account/signin")).toBeNull();
  expect(resolveSignInSite(sites, "bloomberg.com.evil.test")).toBeNull();
  expect(resolveSignInSite([], "bloomberg.com")).toBeNull();
});

test("a disabled source still has a session worth showing", () => {
  // Subscriptions get set up before they are turned on, and an expired session
  // is worth saying either way.
  const off = BLOOMBERG.map((s) => ({ ...s, enabled: false }));
  expect(signInSites(off).length).toBe(1);
});

test("sources with no webview sign-in produce no rows", () => {
  const others = BUILTIN_SOURCES.filter((s) => !s.id.startsWith("bloomberg-"));
  expect(signInSites(others)).toEqual([]);
  // A webview source that names no sign-in page has nowhere to send anyone.
  const anonymous: SourceDescriptor = {
    ...BLOOMBERG[0],
    fulltext: { mode: "webview" },
  };
  expect(signInSites([anonymous])).toEqual([]);
});

test("a check that could not tell does not read as signed out", () => {
  const now = 1_800_000_000_000;
  let sessions = applySessionCheck({}, "www.bloomberg.com", { status: "ok", signedIn: true }, now);
  expect(sessions["www.bloomberg.com"]).toEqual({ signedIn: true, checkedAt: now });
  expect(sessionLabel(sessions["www.bloomberg.com"])).toBe("Signed in");

  // A bot wall answered instead of the site. That says nothing about whether
  // the reader has an account, so the prior answer is kept and the row says it
  // could not tell.
  sessions = applySessionCheck(
    sessions,
    "www.bloomberg.com",
    { status: "blocked", signedIn: false, detail: "bot wall: Are you a robot?" },
    now + 1000,
  );
  expect(sessions["www.bloomberg.com"].signedIn).toBe(true);
  expect(sessions["www.bloomberg.com"].unknown).toContain("bot wall");
  expect(sessionLabel(sessions["www.bloomberg.com"])).toBe("Could not tell");

  // A page that loaded and offered a sign-in is a real answer.
  sessions = applySessionCheck(
    sessions,
    "www.bloomberg.com",
    { status: "ok", signedIn: false },
    now + 2000,
  );
  expect(sessions["www.bloomberg.com"]).toEqual({ signedIn: false, checkedAt: now + 2000 });
  expect(sessionLabel(sessions["www.bloomberg.com"])).toBe("Not signed in");
});

test("signing out forgets the site", () => {
  const sessions = { "www.bloomberg.com": { signedIn: true, checkedAt: 1 }, "x.test": { signedIn: true, checkedAt: 2 } };
  const next = forgetSession(sessions, "www.bloomberg.com");
  expect(next["www.bloomberg.com"]).toBeUndefined();
  expect(next["x.test"]).toBeTruthy();
  expect(sessionLabel(undefined)).toBe("Not checked");
});

test("the stored file is parsed defensively", () => {
  expect(parseSiteSessions("not json")).toEqual({});
  expect(parseSiteSessions("[]")).toEqual({});
  expect(
    parseSiteSessions(
      JSON.stringify({
        "a.test": { signedIn: true, checkedAt: 5 },
        "b.test": { signedIn: "yes", checkedAt: 5 },
        "c.test": { signedIn: false, checkedAt: 6, unknown: "timeout" },
      }),
    ),
  ).toEqual({
    "a.test": { signedIn: true, checkedAt: 5 },
    "c.test": { signedIn: false, checkedAt: 6, unknown: "timeout" },
  });
});

test("a busy row says which of the two waits the reader is in", () => {
  const site = signInSites(BLOOMBERG)[0];
  const state = { signedIn: false, checkedAt: 1 };

  // Window open: the row names the thing that ends the flow.
  expect(sessionRowLine(site, state, "signing-in")).toBe(
    "Finish in the sign-in window, then close it",
  );
  // Window closed: the wait that follows is a different wait, and says so
  // rather than repeating "working".
  expect(sessionRowLine(site, state, "confirming")).toBe("Confirming your sign-in…");
  expect(sessionRowLine(site, state, "checking")).toBe("Checking the site…");
  expect(sessionRowLine(site, state, "signing-out")).toBe("Signing out…");
  // No two of them read alike, or the split bought nothing.
  const lines = (["signing-in", "confirming", "checking", "signing-out"] as const).map(
    sessionWorkLabel,
  );
  expect(new Set(lines).size).toBe(lines.length);
});

test("an idle row still says where the site stands and what reads through it", () => {
  const site = signInSites(BLOOMBERG)[0];
  expect(sessionRowLine(site, { signedIn: true, checkedAt: 1 }, null)).toBe(
    `Signed in · ${BLOOMBERG.length} sources`,
  );
  expect(sessionRowLine(site, undefined, null)).toBe(`Not checked · ${BLOOMBERG.length} sources`);
  // One source is named; several are counted.
  const single = signInSites([BLOOMBERG[0]])[0];
  expect(sessionRowLine(single, { signedIn: false, checkedAt: 1 }, null)).toBe(
    `Not signed in · ${BLOOMBERG[0].name}`,
  );
});

test("only the site being worked on is busy", () => {
  const busy = { host: "www.bloomberg.com", work: "confirming" } as const;
  expect(sessionWorkFor(busy, "www.bloomberg.com")).toBe("confirming");
  expect(sessionWorkFor(busy, "x.test")).toBeNull();
  expect(sessionWorkFor(null, "www.bloomberg.com")).toBeNull();
  expect(sessionWorkFor(undefined, "www.bloomberg.com")).toBeNull();
});
