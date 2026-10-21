// Account registration rules (src/platform/account/report.ts): consent, the
// endpoint, once a day, silent failure. Run: bun test.

import { expect, test } from "bun:test";
import {
  parseAccountState,
  registerUrl,
  reportAfterSignIn,
  reportOnStartup,
  type AccountState,
  type DeviceInfo,
  type ReportDeps,
} from "../../../src/platform/account/report";
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

function harness(initial: Partial<AccountState>, over: Partial<ReportDeps> = {}) {
  let state: AccountState = { consent: false, lastReportDay: null, ...initial };
  const posts: Array<{ url: string; body: unknown }> = [];
  const deps: ReportDeps = {
    endpoint: "https://rp.example.app/",
    loadState: async () => state,
    saveState: async (s) => {
      state = s;
    },
    deviceInfo: async () => DEVICE,
    post: async (url, body) => void posts.push({ url, body: JSON.parse(body) }),
    now: () => NOW,
    ...over,
  };
  return { deps, posts, state: () => state };
}

test("after sign-in with consent: posts the id_token and the device, marks the day", async () => {
  const h = harness({ consent: true });
  expect(await reportAfterSignIn("tok", h.deps)).toBe(true);
  expect(h.posts).toEqual([
    { url: "https://rp.example.app/api/register", body: { idToken: "tok", device: DEVICE } },
  ]);
  expect(h.state().lastReportDay).toBe(TODAY);
});

test("nothing is sent without consent, without an endpoint, or without a token", async () => {
  const noConsent = harness({ consent: false });
  expect(await reportAfterSignIn("tok", noConsent.deps)).toBe(false);
  expect(await reportOnStartup(async () => "tok", noConsent.deps)).toBe(false);
  expect(noConsent.posts).toEqual([]);
  expect(noConsent.state().lastReportDay).toBeNull();

  const noEndpoint = harness({ consent: true }, { endpoint: "" });
  expect(await reportAfterSignIn("tok", noEndpoint.deps)).toBe(false);
  expect(await reportOnStartup(async () => "tok", noEndpoint.deps)).toBe(false);
  expect(noEndpoint.posts).toEqual([]);

  const noToken = harness({ consent: true });
  expect(await reportAfterSignIn(null, noToken.deps)).toBe(false);
  expect(noToken.posts).toEqual([]);
});

test("at startup: once per local day, and the token is fetched only when due", async () => {
  let fetched = 0;
  const token = async () => {
    fetched++;
    return "tok";
  };
  const h = harness({ consent: true, lastReportDay: "2026-10-20" });
  expect(await reportOnStartup(token, h.deps)).toBe(true);
  expect(await reportOnStartup(token, h.deps)).toBe(false);
  expect(fetched).toBe(1);
  expect(h.posts.length).toBe(1);
  expect(h.state().lastReportDay).toBe(TODAY);
});

test("a sign-in report covers the day's startup report", async () => {
  const h = harness({ consent: true });
  await reportAfterSignIn("tok", h.deps);
  expect(await reportOnStartup(async () => "tok2", h.deps)).toBe(false);
  expect(h.posts.length).toBe(1);
});

test("failures are silent and are not retried the same day", async () => {
  const h = harness(
    { consent: true },
    {
      post: async () => {
        throw new Error("offline");
      },
    },
  );
  expect(await reportOnStartup(async () => "tok", h.deps)).toBe(false);
  expect(h.state().lastReportDay).toBe(TODAY);

  const tokenFails = harness({ consent: true });
  const failing = async (): Promise<string | null> => {
    throw new Error("invalid_grant");
  };
  expect(await reportOnStartup(failing, tokenFails.deps)).toBe(false);
  expect(tokenFails.posts).toEqual([]);
});

test("a device without an identity yet sends nothing", async () => {
  const h = harness({ consent: true }, { deviceInfo: async () => null });
  expect(await reportAfterSignIn("tok", h.deps)).toBe(false);
  expect(h.posts).toEqual([]);
});

test("parseAccountState defaults anything unreadable to no consent", () => {
  expect(parseAccountState(null)).toEqual({ consent: false, lastReportDay: null });
  expect(parseAccountState({ consent: "yes", lastReportDay: 3 })).toEqual({
    consent: false,
    lastReportDay: null,
  });
  expect(parseAccountState({ consent: true, lastReportDay: "2026-10-21" })).toEqual({
    consent: true,
    lastReportDay: "2026-10-21",
  });
});

test("registerUrl tolerates a trailing slash", () => {
  expect(registerUrl("https://a.vercel.app")).toBe("https://a.vercel.app/api/register");
  expect(registerUrl("https://a.vercel.app/")).toBe("https://a.vercel.app/api/register");
});
