// Account registration rules (src/platform/account/report.ts): consent, the
// backend, once a day, refresh before re-exchange, silent failure. Run: bun test.

import { expect, test } from "bun:test";
import {
  clearSession,
  parseAccountState,
  reportAfterSignIn,
  reportOnStartup,
  type AccountState,
  type DeviceInfo,
  type ReportDeps,
} from "../../../src/platform/account/report";
import type { SupabaseSession } from "../../../src/platform/account/supabase";
import { localDate } from "../../../src/platform/std/day";

const NOW = new Date(2026, 9, 21, 9, 0).getTime();
const TODAY = localDate(NOW);
const DEVICE: DeviceInfo = {
  id: "dev-1",
  platform: "ios",
  osVersion: "18.1",
  model: "iPad14,1",
  appVersion: "0.26.2",
};
const ORIGIN = "https://ref.supabase.co";
const ID_GRANT = `${ORIGIN}/auth/v1/token?grant_type=id_token`;
const REFRESH_GRANT = `${ORIGIN}/auth/v1/token?grant_type=refresh_token`;
const RPC = `${ORIGIN}/rest/v1/rpc/report_device`;

const STORED: SupabaseSession = {
  accessToken: "old-acc",
  refreshToken: "old-ref",
  expiresAt: NOW - 1,
  userId: "user-1",
};

function grant(tag: string) {
  return {
    access_token: `${tag}-acc`,
    refresh_token: `${tag}-ref`,
    expires_in: 3600,
    user: { id: "user-1" },
  };
}

type Route = { status: number; body?: unknown } | "offline";

function harness(
  initial: Partial<AccountState>,
  routes: Partial<Record<string, Route>> = {},
  over: Partial<ReportDeps> = {},
) {
  let state: AccountState = { consent: true, lastReportDay: null, session: null, ...initial };
  const calls: Array<{ url: string; body: unknown; auth: string | undefined }> = [];
  const table: Record<string, Route> = {
    [ID_GRANT]: { status: 200, body: grant("id") },
    [REFRESH_GRANT]: { status: 200, body: grant("rf") },
    [RPC]: { status: 204 },
    ...routes,
  } as Record<string, Route>;
  const deps: ReportDeps = {
    backend: { url: ORIGIN, key: "pk" },
    loadState: async () => state,
    saveState: async (s) => {
      state = s;
    },
    deviceInfo: async () => DEVICE,
    fetch: async (url, init) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, body: JSON.parse(init.body as string), auth: headers.Authorization });
      const route = table[url];
      if (!route || route === "offline") throw new Error("offline");
      return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
        status: route.status,
      });
    },
    now: () => NOW,
    ...over,
  };
  return { deps, calls, urls: () => calls.map((c) => c.url), state: () => state };
}

test("after sign-in: exchanges the id_token, stores the session, reports the device, marks the day", async () => {
  const h = harness({});
  expect(await reportAfterSignIn("gid", h.deps)).toBe(true);
  expect(h.urls()).toEqual([ID_GRANT, RPC]);
  expect(h.calls[0].body).toEqual({ provider: "google", id_token: "gid" });
  expect(h.calls[1].auth).toBe("Bearer id-acc");
  expect(h.calls[1].body).toMatchObject({ p_device_id: "dev-1", p_model: "iPad14,1" });
  expect(h.state().session).toEqual({
    accessToken: "id-acc",
    refreshToken: "id-ref",
    expiresAt: NOW + 3_600_000,
    userId: "user-1",
  });
  expect(h.state().lastReportDay).toBe(TODAY);
});

test("nothing is sent with consent turned off, without a backend, or without a token", async () => {
  const noConsent = harness({ consent: false });
  expect(await reportAfterSignIn("gid", noConsent.deps)).toBe(false);
  expect(await reportOnStartup(async () => "gid", noConsent.deps)).toBe(false);
  expect(noConsent.calls).toEqual([]);
  expect(noConsent.state().lastReportDay).toBeNull();

  const noBackend = harness({}, {}, { backend: { url: "", key: "pk" } });
  expect(await reportAfterSignIn("gid", noBackend.deps)).toBe(false);
  expect(await reportOnStartup(async () => "gid", noBackend.deps)).toBe(false);
  expect(noBackend.calls).toEqual([]);

  const noToken = harness({});
  expect(await reportAfterSignIn(null, noToken.deps)).toBe(false);
  expect(noToken.calls).toEqual([]);
});

test("at startup with a stored session: refreshes it, keeps the rotated token, reports", async () => {
  let fetched = 0;
  const idToken = async () => {
    fetched++;
    return "gid";
  };
  const h = harness({ lastReportDay: "2026-10-20", session: STORED });
  expect(await reportOnStartup(idToken, h.deps)).toBe(true);
  expect(h.urls()).toEqual([REFRESH_GRANT, RPC]);
  expect(h.calls[0].body).toEqual({ refresh_token: "old-ref" });
  expect(h.calls[1].auth).toBe("Bearer rf-acc");
  expect(h.state().session?.refreshToken).toBe("rf-ref");
  expect(fetched).toBe(0);
  expect(h.state().lastReportDay).toBe(TODAY);

  // Once per local day.
  expect(await reportOnStartup(idToken, h.deps)).toBe(false);
  expect(h.calls.length).toBe(2);
});

test("at startup without a session: exchanges a fresh id_token", async () => {
  const h = harness({ lastReportDay: "2026-10-20" });
  expect(await reportOnStartup(async () => "gid", h.deps)).toBe(true);
  expect(h.urls()).toEqual([ID_GRANT, RPC]);
  expect(h.state().session?.refreshToken).toBe("id-ref");
});

test("a refused refresh falls back to the id_token exchange", async () => {
  const h = harness(
    { session: STORED },
    { [REFRESH_GRANT]: { status: 400, body: { error: "invalid_grant" } } },
  );
  expect(await reportOnStartup(async () => "gid", h.deps)).toBe(true);
  expect(h.urls()).toEqual([REFRESH_GRANT, ID_GRANT, RPC]);
  expect(h.state().session?.accessToken).toBe("id-acc");
});

test("a sign-in report covers the day's startup report", async () => {
  const h = harness({});
  await reportAfterSignIn("gid", h.deps);
  expect(await reportOnStartup(async () => "gid2", h.deps)).toBe(false);
  expect(h.urls()).toEqual([ID_GRANT, RPC]);
});

test("failures are silent and are not retried the same day", async () => {
  const offline = harness(
    { session: STORED },
    { [REFRESH_GRANT]: "offline", [ID_GRANT]: "offline" },
  );
  expect(await reportOnStartup(async () => "gid", offline.deps)).toBe(false);
  expect(offline.state().lastReportDay).toBe(TODAY);
  expect(offline.state().session).toEqual(STORED);
  expect(await reportOnStartup(async () => "gid", offline.deps)).toBe(false);
  expect(offline.urls()).toEqual([REFRESH_GRANT, ID_GRANT]);

  const tokenFails = harness({});
  const failing = async (): Promise<string | null> => {
    throw new Error("invalid_grant");
  };
  expect(await reportOnStartup(failing, tokenFails.deps)).toBe(false);
  expect(tokenFails.calls).toEqual([]);

  const rpcRefused = harness({}, { [RPC]: { status: 401 } });
  expect(await reportAfterSignIn("gid", rpcRefused.deps)).toBe(false);
  expect(rpcRefused.state().session?.accessToken).toBe("id-acc");
});

test("a device without an identity yet reports nothing", async () => {
  const h = harness({}, {}, { deviceInfo: async () => null });
  expect(await reportAfterSignIn("gid", h.deps)).toBe(false);
  expect(h.urls()).toEqual([ID_GRANT]);
});

test("clearSession drops the session and keeps the rest", async () => {
  const h = harness({ consent: false, lastReportDay: "2026-10-20", session: STORED });
  await clearSession(h.deps);
  expect(h.state()).toEqual({ consent: false, lastReportDay: "2026-10-20", session: null });
});

test("parseAccountState: consent is on unless explicitly off", () => {
  expect(parseAccountState(null)).toEqual({ consent: true, lastReportDay: null, session: null });
  expect(parseAccountState({ consent: "yes", lastReportDay: 3, session: { accessToken: 1 } })).toEqual({
    consent: true,
    lastReportDay: null,
    session: null,
  });
  expect(parseAccountState({ consent: false, lastReportDay: "2026-10-21", session: STORED })).toEqual({
    consent: false,
    lastReportDay: "2026-10-21",
    session: STORED,
  });
});
