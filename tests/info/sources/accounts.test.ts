// The accounts the app can use and what each row of Settings › Accounts says
// (src/info/sources/accounts.ts). Pure — no webview, no fs.

import { expect, test } from "bun:test";
import {
  ACCOUNTS,
  accountRows,
  accountSites,
  accountStatus,
  accountView,
  type AccountRow,
} from "../../../src/info/sources/accounts";
import { BUILTIN_SOURCES } from "../../../src/info/sources/builtins";
import type { SourceDescriptor } from "../../../src/info/sources/descriptor";
import { X_SIGN_IN_URL } from "../../../src/info/sources/x-search";

const BLOOMBERG = BUILTIN_SOURCES.filter((s) => s.id.startsWith("bloomberg-"));

const FT: SourceDescriptor = {
  ...BLOOMBERG[0],
  id: "ft-markets",
  name: "FT Markets",
  fulltext: { mode: "webview", signInUrl: "https://www.ft.com/login" },
};

function row(rows: AccountRow[], id: string): AccountRow {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

test("every registry account has a row, subscribed or not", () => {
  const rows = accountRows([], false);
  expect(rows.map((r) => r.id)).toEqual(ACCOUNTS.map((a) => a.id));
  expect(rows.map((r) => r.name)).toEqual(["X", "Bloomberg"]);
  const x = row(rows, "x");
  expect(x.site.host).toBe("x.com");
  expect(x.site.signInUrl).toBe(X_SIGN_IN_URL);
  // The session is checked on the site root, never on the login page.
  expect(x.site.checkUrl).toBe("https://x.com/");
  expect(x.site.sourceNames).toEqual([]);
  expect(row(rows, "bloomberg").site.checkUrl).toBe("https://www.bloomberg.com/");
  expect(x.benefit).toBeTruthy();
  expect(x.caution).toContain("secondary account");
  expect(row(rows, "bloomberg").caution).toBeNull();
});

test("a registry row takes the subscribed sources' site, so it knows what reads through it", () => {
  const rows = accountRows(BLOOMBERG, true);
  expect(rows.map((r) => r.id)).toEqual(["x", "bloomberg"]);
  expect(row(rows, "bloomberg").site.sourceIds.length).toBe(BLOOMBERG.length);
  expect(row(rows, "x").site.sourceNames).toEqual(["X search"]);
});

test("a site only a subscribed source names gets a row after the registry's", () => {
  const rows = accountRows([FT, ...BLOOMBERG], false);
  expect(rows.map((r) => r.id)).toEqual(["x", "bloomberg", "www.ft.com"]);
  const ft = row(rows, "www.ft.com");
  expect(ft.name).toBe("ft.com");
  expect(ft.benefit).toBeNull();
  expect(accountView(ft, { sessions: {}, busy: null, canSignIn: true }).detail).toBe("Used by FT Markets");
  expect(accountSites([FT], false).map((s) => s.host)).toEqual(["x.com", "www.bloomberg.com", "www.ft.com"]);
});

test("the status light tells signed in, expired, signed out and not known apart", () => {
  expect(accountStatus(undefined)).toBe("unknown");
  expect(accountStatus({ signedIn: true, checkedAt: 1 })).toBe("signed-in");
  expect(accountStatus({ signedIn: false, checkedAt: 1 })).toBe("signed-out");
  expect(accountStatus({ signedIn: false, checkedAt: 1, expired: true })).toBe("expired");
  expect(accountStatus({ signedIn: true, checkedAt: 1, unknown: "timeout" })).toBe("unknown");
});

test("a device that signs in offers the button that fits, and the work disables it", () => {
  const x = row(accountRows([], true), "x");
  const signedIn = { "x.com": { signedIn: true, checkedAt: 1 } };
  expect(accountView(x, { sessions: signedIn, busy: null, canSignIn: true })).toMatchObject({
    status: "signed-in",
    line: "Signed in",
    action: "sign-out",
    work: null,
  });
  const expired = { "x.com": { signedIn: false, checkedAt: 1, expired: true } };
  expect(accountView(x, { sessions: expired, busy: null, canSignIn: true })).toMatchObject({
    status: "expired",
    line: "Expired",
    action: "sign-in",
  });
  const busy = { host: "x.com", work: "confirming" } as const;
  expect(accountView(x, { sessions: expired, busy, canSignIn: true })).toMatchObject({
    line: "Confirming your sign-in…",
    work: "confirming",
  });
  // A collector with no webview shows its own state and no buttons.
  expect(accountView(x, { sessions: signedIn, busy: null, canSignIn: false })).toMatchObject({
    status: "signed-in",
    action: null,
  });
});

test("a reader shows what the collecting machine reports, read-only", () => {
  const rows = accountRows(BLOOMBERG, true);
  const collector = { deviceName: "desk-linux", sites: { "x.com": true, "www.bloomberg.com": false } };
  const ctx = { sessions: {}, busy: null, canSignIn: false, remote: { collector } };
  expect(accountView(row(rows, "x"), ctx)).toMatchObject({
    status: "signed-in",
    line: "Signed in on desk-linux",
    action: null,
  });
  expect(accountView(row(rows, "bloomberg"), ctx)).toMatchObject({
    status: "signed-out",
    line: "Needs signing in on desk-linux",
  });
  // No collector has reported yet: say where signing in happens.
  expect(accountView(row(rows, "x"), { ...ctx, remote: { collector: null } }).line).toBe(
    "Sign in on the computer that collects your sources",
  );
});
