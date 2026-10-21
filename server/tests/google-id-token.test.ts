// verifyGoogleIdToken (server/lib/google-id-token.ts) against tokens signed with
// a locally generated RSA key standing in for Google's.
// Run: cd server && bun test (also picked up by the repo-root scripts/t.sh).

import { beforeAll, expect, test } from "bun:test";
import { verifyGoogleIdToken, type Jwk } from "../lib/google-id-token";

const AUD = "client-a.apps.googleusercontent.com";
const NOW = Date.parse("2026-10-21T08:00:00Z");
let keys: Jwk[];
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

async function generate(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

beforeAll(async () => {
  const pair = await generate();
  privateKey = pair.privateKey;
  otherPrivateKey = (await generate()).privateKey;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
  keys = [{ ...jwk, kid: "k1" }];
});

function b64url(data: Uint8Array | string): string {
  return Buffer.from(data).toString("base64url");
}

async function sign(claims: Record<string, unknown>, opts: { kid?: string; key?: CryptoKey } = {}) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid: opts.kid ?? "k1", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign(
    ALG,
    opts.key ?? privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

const GOOD = {
  iss: "https://accounts.google.com",
  aud: AUD,
  sub: "1234",
  email: "reader@example.com",
  name: "Reader",
  exp: NOW / 1000 + 3600,
};

function verify(token: string) {
  return verifyGoogleIdToken(token, { audiences: [AUD, "client-b"], keys: async () => keys, now: NOW });
}

test("a valid token yields sub, email and name", async () => {
  expect(await verify(await sign(GOOD))).toEqual({
    sub: "1234",
    email: "reader@example.com",
    name: "Reader",
  });
});

test("the bare issuer form is accepted, and name may be absent", async () => {
  const { name: _, ...noName } = GOOD;
  const identity = await verify(await sign({ ...noName, iss: "accounts.google.com" }));
  expect(identity).toEqual({ sub: "1234", email: "reader@example.com", name: null });
});

test("rejects a wrong audience, issuer or an expired token", async () => {
  expect(await verify(await sign({ ...GOOD, aud: "someone-else" }))).toBeNull();
  expect(await verify(await sign({ ...GOOD, iss: "https://evil.example" }))).toBeNull();
  expect(await verify(await sign({ ...GOOD, exp: NOW / 1000 - 1 }))).toBeNull();
});

test("rejects a token signed by another key or naming an unknown kid", async () => {
  expect(await verify(await sign(GOOD, { key: otherPrivateKey }))).toBeNull();
  expect(await verify(await sign(GOOD, { kid: "k2" }))).toBeNull();
});

test("rejects a tampered payload and garbage", async () => {
  const token = await sign(GOOD);
  const [h, , s] = token.split(".");
  const forged = `${h}.${b64url(JSON.stringify({ ...GOOD, sub: "9999" }))}.${s}`;
  expect(await verify(forged)).toBeNull();
  expect(await verify("not-a-jwt")).toBeNull();
  expect(await verify("a.b.c")).toBeNull();
});
