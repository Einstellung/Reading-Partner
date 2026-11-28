// One license check (src/platform/license/check.ts) against a fake backend,
// with answers signed by the server's own code (supabase/functions/_shared),
// so the two ends are tested against each other. Run: bun test.

import { beforeAll, expect, test } from "bun:test";
import type { SessionOutcome } from "../../../src/platform/account/session";
import type { SupabaseSession } from "../../../src/platform/account/supabase";
import {
  checkLicense,
  parseCache,
  requestAccountDeletion,
  serializeCache,
  type CheckDeps,
} from "../../../src/platform/license/check";
import {
  base64UrlToBytes,
  parsePayload,
  verifySignedLicense,
} from "../../../src/platform/license/signed";
import {
  buildPayload,
  importSigningKey,
  signPayload,
  type AccountRow,
  type LicensePayload,
} from "../../../supabase/functions/_shared/license.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2027, 1, 1, 12);
const ORIGIN = "https://ref.supabase.co";
const STATUS_URL = `${ORIGIN}/functions/v1/license-status`;

let signingKey: CryptoKey;
let publicKey: JsonWebKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  // Through the server's own import, from the JWK text the secret would hold.
  signingKey = await importSigningKey(
    JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    crypto.subtle,
  );
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  publicKey = { kty, crv, x, y };
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  otherKey = other.privateKey;
});

const SESSION: SupabaseSession = {
  accessToken: "acc-1",
  refreshToken: "ref-1",
  expiresAt: NOW + 3600_000,
  userId: "u1",
};

const TRIAL_ROW: AccountRow = {
  trial_started_at: new Date(NOW - 10 * DAY).toISOString(),
  purchased_at: null,
  banned: false,
};

function serverPayload(over: Partial<LicensePayload> = {}, at = NOW): LicensePayload {
  return { ...buildPayload("u1", TRIAL_ROW, true, new Date(at)), ...over };
}

async function signed(payload: LicensePayload, key = signingKey) {
  return signPayload(payload, key, crypto.subtle);
}

type Route = { status: number; body?: unknown } | "offline";

function harness(opts: {
  session?: SessionOutcome | ((force: boolean) => SessionOutcome);
  routes?: Route[];
  cache?: string | null;
  now?: number;
}) {
  const routes = [...(opts.routes ?? [])];
  const requests: Array<{ url: string; auth: string | null }> = [];
  const sessionCalls: boolean[] = [];
  let cache = opts.cache ?? null;
  const writes: string[] = [];
  const deps: CheckDeps = {
    backend: { url: ORIGIN, key: "pk" },
    publicKey,
    signInAvailable: true,
    session: async (o) => {
      const force = o?.forceRefresh === true;
      sessionCalls.push(force);
      const s = opts.session ?? { kind: "session", session: SESSION };
      return typeof s === "function" ? s(force) : s;
    },
    fetch: async (url, init) => {
      requests.push({ url, auth: new Headers(init.headers).get("Authorization") });
      const route = routes.shift() ?? "offline";
      if (route === "offline") throw new TypeError("network down");
      return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
        status: route.status,
      });
    },
    subtle: crypto.subtle,
    readCache: async () => cache,
    writeCache: async (text) => {
      writes.push(text);
      cache = text;
    },
    now: () => opts.now ?? NOW,
  };
  return { deps, requests, sessionCalls, writes, cache: () => cache };
}

const ON = true;

test("an unconfigured key, backend or sign-in leaves the app open without a request", async () => {
  for (const over of [{ publicKey: null }, { backend: { url: "", key: "" } }, { signInAvailable: false }]) {
    const h = harness({});
    expect(await checkLicense({ ...h.deps, ...over }, ON)).toEqual({ view: "open" });
    expect(h.requests).toEqual([]);
    expect(h.sessionCalls).toEqual([]);
  }
});

test("no session asks for a sign-in and requests nothing", async () => {
  const h = harness({ session: { kind: "signed-out" } });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "sign-in" });
  expect(h.requests).toEqual([]);
});

test("a verified trial opens the app and is cached", async () => {
  const answer = await signed(serverPayload());
  const h = harness({ routes: [{ status: 200, body: answer }] });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "open" });
  expect(h.requests).toEqual([{ url: STATUS_URL, auth: "Bearer acc-1" }]);
  expect(parseCache(h.cache())).toEqual(answer);
});

test("a verified expired answer locks", async () => {
  const expired = buildPayload(
    "u1",
    { ...TRIAL_ROW, trial_started_at: new Date(NOW - 200 * DAY).toISOString() },
    true,
    new Date(NOW),
  );
  expect(expired.status).toBe("expired");
  const h = harness({ routes: [{ status: 200, body: await signed(expired) }] });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "locked", reason: "expired", userId: "u1" });
});

test("the server switch off answers open, and the client opens", async () => {
  const open = buildPayload("u1", { ...TRIAL_ROW, banned: true }, false, new Date(NOW));
  const h = harness({ routes: [{ status: 200, body: await signed(open) }] });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "open" });
});

test("offline within the grace uses the cache", async () => {
  const cache = serializeCache(await signed(serverPayload({ status: "purchased" }, NOW - 6 * DAY)));
  const h = harness({ routes: ["offline"], cache });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "open" });
  expect(h.writes).toEqual([]);
});

test("offline past the grace locks", async () => {
  const cache = serializeCache(await signed(serverPayload({ status: "purchased" }, NOW - 8 * DAY)));
  const h = harness({ routes: ["offline"], cache });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "locked", reason: "offline", userId: "u1" });
});

test("no session to be had offline still uses the cache", async () => {
  const cache = serializeCache(await signed(serverPayload({ status: "purchased" }, NOW - DAY)));
  const h = harness({ session: { kind: "unreachable", userId: null }, cache });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "open" });
  expect(h.requests).toEqual([]);
});

test("a server error falls back on the cache", async () => {
  const cache = serializeCache(await signed(serverPayload({ status: "purchased" }, NOW - DAY)));
  const h = harness({ routes: [{ status: 503, body: {} }], cache });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "open" });
});

test("an answer signed by another key is no answer", async () => {
  const forged = await signed(serverPayload({ status: "purchased" }), otherKey);
  const h = harness({ routes: [{ status: 200, body: forged }] });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "locked", reason: "offline", userId: "u1" });
  expect(h.writes).toEqual([]);
});

test("an edited cache is no cache", async () => {
  const real = await signed(serverPayload({ status: "expired" }, NOW - DAY));
  const edited = serializeCache({ ...real, payload: real.payload.replace('"expired"', '"purchased"') });
  const h = harness({ routes: ["offline"], cache: edited });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "locked", reason: "offline", userId: "u1" });
});

test("an answer for another user is no answer", async () => {
  const theirs = await signed(serverPayload({ userId: "u2", status: "purchased" }));
  const h = harness({ routes: [{ status: 200, body: theirs }] });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "locked", reason: "offline", userId: "u1" });
});

test("a 401 refreshes the session once and asks again", async () => {
  const fresh: SupabaseSession = { ...SESSION, accessToken: "acc-2" };
  const h = harness({
    session: (force) => ({ kind: "session", session: force ? fresh : SESSION }),
    routes: [{ status: 401, body: {} }, { status: 200, body: await signed(serverPayload()) }],
  });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "open" });
  expect(h.sessionCalls).toEqual([false, true]);
  expect(h.requests.map((r) => r.auth)).toEqual(["Bearer acc-1", "Bearer acc-2"]);
});

test("a 401 whose refresh finds no account asks for a sign-in", async () => {
  const h = harness({
    session: (force) => (force ? { kind: "signed-out" } : { kind: "session", session: SESSION }),
    routes: [{ status: 401, body: {} }],
  });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "sign-in" });
});

test("a malformed body falls back on the cache", async () => {
  const h = harness({ routes: [{ status: 200, body: { nope: true } }] });
  expect(await checkLicense(h.deps, ON)).toEqual({ view: "locked", reason: "offline", userId: "u1" });
});

test("the payload the server builds is the payload the client reads", async () => {
  const payload = serverPayload();
  const answer = await signed(payload);
  const read = await verifySignedLicense(answer, publicKey, crypto.subtle);
  expect(read).toEqual({
    v: 1,
    userId: "u1",
    status: "trial",
    trialEndsAt: Date.parse(payload.trialEndsAt!),
    issuedAt: NOW,
  });
  expect(base64UrlToBytes(answer.signature)?.length).toBe(64);
});

test("payload parsing refuses what it does not know", () => {
  const ok = { v: 1, userId: "u", status: "trial", trialEndsAt: null, issuedAt: new Date(NOW).toISOString() };
  expect(parsePayload(JSON.stringify(ok))).not.toBeNull();
  expect(parsePayload(JSON.stringify({ ...ok, v: 2 }))).toBeNull();
  expect(parsePayload(JSON.stringify({ ...ok, status: "free" }))).toBeNull();
  expect(parsePayload(JSON.stringify({ ...ok, issuedAt: "soon" }))).toBeNull();
  expect(parsePayload(JSON.stringify({ ...ok, trialEndsAt: 5 }))).toBeNull();
  expect(parsePayload(JSON.stringify({ ...ok, userId: "" }))).toBeNull();
  expect(parsePayload("not json")).toBeNull();
  expect(parseCache("not json")).toBeNull();
  expect(parseCache(null)).toBeNull();
});

test("account deletion calls the function with the session", async () => {
  const h = harness({ routes: [{ status: 200, body: { deleted: true } }] });
  expect(await requestAccountDeletion(h.deps)).toBe(true);
  expect(h.requests).toEqual([{ url: `${ORIGIN}/functions/v1/delete-account`, auth: "Bearer acc-1" }]);
});

test("account deletion fails without a session or on an error", async () => {
  expect(await requestAccountDeletion(harness({ session: { kind: "signed-out" } }).deps)).toBe(false);
  expect(await requestAccountDeletion(harness({ routes: [{ status: 500, body: {} }] }).deps)).toBe(false);
  expect(await requestAccountDeletion(harness({ routes: ["offline"] }).deps)).toBe(false);
});
