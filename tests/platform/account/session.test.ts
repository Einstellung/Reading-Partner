// A Supabase session for the license check (src/platform/account/session.ts):
// stored while fresh, refreshed when not, re-exchanged when refused, and
// "unreachable" kept apart from "signed out". Run: bun test.

import { expect, test } from "bun:test";
import { ensureSession, type SessionDeps } from "../../../src/platform/account/session";
import type { SupabaseSession } from "../../../src/platform/account/supabase";

const NOW = Date.UTC(2027, 1, 1, 12);
const ORIGIN = "https://ref.supabase.co";
const ID_GRANT = `${ORIGIN}/auth/v1/token?grant_type=id_token`;
const REFRESH_GRANT = `${ORIGIN}/auth/v1/token?grant_type=refresh_token`;

const STORED: SupabaseSession = {
  accessToken: "old-acc",
  refreshToken: "old-ref",
  expiresAt: NOW + 3600_000,
  userId: "u1",
};

function grant(tag: string) {
  return { access_token: `${tag}-acc`, refresh_token: `${tag}-ref`, expires_in: 3600, user: { id: "u1" } };
}

type Route = { status: number; body?: unknown } | "offline";

function harness(
  stored: SupabaseSession | null,
  routes: Partial<Record<string, Route>> = {},
  idToken: () => Promise<string | null> = async () => "google-id",
) {
  const calls: string[] = [];
  const saved: SupabaseSession[] = [];
  const table: Record<string, Route> = {
    [ID_GRANT]: { status: 200, body: grant("id") },
    [REFRESH_GRANT]: { status: 200, body: grant("rf") },
    ...routes,
  };
  const deps: SessionDeps = {
    backend: { url: ORIGIN, key: "pk" },
    loadSession: async () => stored,
    storeSession: async (s) => {
      saved.push(s);
    },
    idToken: async () => {
      calls.push("idToken");
      return idToken();
    },
    fetch: async (url) => {
      calls.push(url);
      const route = table[url] ?? "offline";
      if (route === "offline") throw new TypeError("network down");
      return new Response(JSON.stringify(route.body ?? {}), { status: route.status });
    },
    now: () => NOW,
  };
  return { deps, calls, saved };
}

test("a fresh stored session is used as it is", async () => {
  const h = harness(STORED);
  expect(await ensureSession(h.deps)).toEqual({ kind: "session", session: STORED });
  expect(h.calls).toEqual([]);
});

test("a session within a minute of expiry is refreshed and stored", async () => {
  const h = harness({ ...STORED, expiresAt: NOW + 30_000 });
  const got = await ensureSession(h.deps);
  expect(got.kind === "session" && got.session.accessToken).toBe("rf-acc");
  expect(h.calls).toEqual([REFRESH_GRANT]);
  expect(h.saved.map((s) => s.refreshToken)).toEqual(["rf-ref"]);
});

test("forceRefresh refreshes a fresh session too", async () => {
  const h = harness(STORED);
  await ensureSession(h.deps, { forceRefresh: true });
  expect(h.calls).toEqual([REFRESH_GRANT]);
});

test("a refused refresh falls through to a new exchange", async () => {
  const h = harness({ ...STORED, expiresAt: 0 }, { [REFRESH_GRANT]: { status: 400 } });
  const got = await ensureSession(h.deps);
  expect(got.kind === "session" && got.session.accessToken).toBe("id-acc");
  expect(h.calls).toEqual([REFRESH_GRANT, "idToken", ID_GRANT]);
});

test("a refresh that cannot reach the server is unreachable, not a sign-out", async () => {
  const offline = harness({ ...STORED, expiresAt: 0 }, { [REFRESH_GRANT]: "offline" });
  expect(await ensureSession(offline.deps)).toEqual({ kind: "unreachable", userId: "u1" });
  expect(offline.calls).toEqual([REFRESH_GRANT]);
  const down = harness({ ...STORED, expiresAt: 0 }, { [REFRESH_GRANT]: { status: 503 } });
  expect(await ensureSession(down.deps)).toEqual({ kind: "unreachable", userId: "u1" });
});

test("no stored session exchanges a Google id_token", async () => {
  const h = harness(null);
  const got = await ensureSession(h.deps);
  expect(got.kind === "session" && got.session.accessToken).toBe("id-acc");
  expect(h.saved).toHaveLength(1);
});

test("signed out of Google with nothing stored is signed out", async () => {
  const h = harness(null, {}, async () => null);
  expect(await ensureSession(h.deps)).toEqual({ kind: "signed-out" });
});

test("Google out of reach is unreachable", async () => {
  const h = harness(null, {}, async () => Promise.reject(new Error("offline")));
  expect(await ensureSession(h.deps)).toEqual({ kind: "unreachable", userId: null });
});

test("an exchange the backend refuses is unreachable, not a sign-out", async () => {
  const h = harness(null, { [ID_GRANT]: { status: 400 } });
  expect(await ensureSession(h.deps)).toEqual({ kind: "unreachable", userId: null });
});
