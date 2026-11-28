// The Supabase requests and their parsing (src/platform/account/supabase.ts),
// against an injected fetch. Run: bun test.

import { expect, test } from "bun:test";
import {
  exchangeIdToken,
  idTokenBody,
  parseSession,
  parseStoredSession,
  refreshSession,
  reportDevice,
  reportDeviceUrl,
  tokenUrl,
  type FetchLike,
} from "../../../src/platform/account/supabase";

const BACKEND = { url: "https://ref.supabase.co/", key: "sb_publishable_x" };
const NOW = 1_800_000_000_000;
const GRANT = {
  access_token: "acc",
  refresh_token: "ref",
  expires_in: 3600,
  expires_at: 1_800_003_600,
  user: { id: "user-1", email: "a@example.com" },
};

function recorder(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

test("urls are built from the project origin, with or without a trailing slash", () => {
  expect(tokenUrl(BACKEND, "id_token")).toBe("https://ref.supabase.co/auth/v1/token?grant_type=id_token");
  expect(tokenUrl({ ...BACKEND, url: "https://ref.supabase.co" }, "refresh_token")).toBe(
    "https://ref.supabase.co/auth/v1/token?grant_type=refresh_token",
  );
  expect(reportDeviceUrl(BACKEND)).toBe("https://ref.supabase.co/rest/v1/rpc/report_device");
});

test("the id_token exchange sends the key and a google provider body, and returns the session", async () => {
  const r = recorder(200, GRANT);
  const session = await exchangeIdToken(BACKEND, "gid", r.fetch, NOW);
  expect(session).toEqual({
    accessToken: "acc",
    refreshToken: "ref",
    expiresAt: 1_800_003_600_000,
    userId: "user-1",
  });
  expect(r.calls.length).toBe(1);
  const { url, init } = r.calls[0];
  expect(url).toBe("https://ref.supabase.co/auth/v1/token?grant_type=id_token");
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ apikey: "sb_publishable_x", "Content-Type": "application/json" });
  expect(JSON.parse(init.body as string)).toEqual({ provider: "google", id_token: "gid" });
});

test("an Apple id_token exchange sends the apple provider and the raw nonce", async () => {
  const r = recorder(200, GRANT);
  const session = await exchangeIdToken(BACKEND, "aid", r.fetch, NOW, { provider: "apple", nonce: "raw-nonce" });
  expect(session.userId).toBe("user-1");
  const { url, init } = r.calls[0];
  expect(url).toBe("https://ref.supabase.co/auth/v1/token?grant_type=id_token");
  expect(init.headers).toEqual({ apikey: "sb_publishable_x", "Content-Type": "application/json" });
  expect(JSON.parse(init.body as string)).toEqual({ provider: "apple", id_token: "aid", nonce: "raw-nonce" });
});

test("the id_token body carries a nonce only when one is given", () => {
  expect(idTokenBody("gid")).toEqual({ provider: "google", id_token: "gid" });
  expect(idTokenBody("aid", { provider: "apple" })).toEqual({ provider: "apple", id_token: "aid" });
  expect(idTokenBody("aid", { provider: "apple", nonce: "n" })).toEqual({
    provider: "apple",
    id_token: "aid",
    nonce: "n",
  });
});

test("a refresh sends the refresh token and returns the rotated one", async () => {
  const r = recorder(200, { ...GRANT, refresh_token: "ref2" });
  const session = await refreshSession(BACKEND, "ref", r.fetch, NOW);
  expect(session.refreshToken).toBe("ref2");
  expect(r.calls[0].url).toBe("https://ref.supabase.co/auth/v1/token?grant_type=refresh_token");
  expect(JSON.parse(r.calls[0].init.body as string)).toEqual({ refresh_token: "ref" });
});

test("a refused grant throws", async () => {
  const r = recorder(400, { error: "invalid_grant" });
  await expect(refreshSession(BACKEND, "dead", r.fetch, NOW)).rejects.toThrow("400");
});

test("report_device carries the session as a bearer token and the device as named arguments", async () => {
  const r = recorder(204, undefined);
  await reportDevice(
    BACKEND,
    { accessToken: "acc", refreshToken: "ref", expiresAt: 0, userId: "user-1" },
    { id: "dev-1", platform: "ios", osVersion: "18.1", model: null, appVersion: "0.28.1" },
    r.fetch,
  );
  const { url, init } = r.calls[0];
  expect(url).toBe("https://ref.supabase.co/rest/v1/rpc/report_device");
  expect(init.headers).toEqual({
    apikey: "sb_publishable_x",
    Authorization: "Bearer acc",
    "Content-Type": "application/json",
  });
  expect(JSON.parse(init.body as string)).toEqual({
    p_device_id: "dev-1",
    p_platform: "ios",
    p_os_version: "18.1",
    p_model: null,
    p_app_version: "0.28.1",
  });

  const refused = recorder(401, { message: "JWT expired" });
  await expect(
    reportDevice(
      BACKEND,
      { accessToken: "old", refreshToken: "ref", expiresAt: 0, userId: "user-1" },
      { id: "dev-1", platform: "ios", osVersion: null, model: null, appVersion: "0.28.1" },
      refused.fetch,
    ),
  ).rejects.toThrow("401");
});

test("parseSession falls back to expires_in and rejects an answer without a user", () => {
  const { expires_at: _, ...noExpiresAt } = GRANT;
  expect(parseSession(noExpiresAt, NOW).expiresAt).toBe(NOW + 3_600_000);
  expect(() => parseSession({ ...GRANT, user: undefined }, NOW)).toThrow();
  expect(() => parseSession(null, NOW)).toThrow();
});

test("parseStoredSession accepts only a complete session", () => {
  const ok = { accessToken: "a", refreshToken: "r", expiresAt: 1, userId: "u" };
  expect(parseStoredSession(ok)).toEqual(ok);
  expect(parseStoredSession({ ...ok, userId: 3 })).toBeNull();
  expect(parseStoredSession(undefined)).toBeNull();
});
