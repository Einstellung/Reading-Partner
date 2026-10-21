// parseIdTokenClaims (src/platform/sync/auth.ts): pull the email and name claims
// out of an OIDC id_token without verifying it. Run: bun test.

import { expect, test } from "bun:test";
import { parseIdTokenClaims } from "../../../src/platform/sync/auth";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

test("reads the email and name claims from a well-formed id_token", () => {
  const token = `${b64url({ alg: "RS256" })}.${b64url({ email: "reader@example.com", name: "Lin Reader", sub: "1" })}.sig`;
  expect(parseIdTokenClaims(token)).toEqual({ email: "reader@example.com", name: "Lin Reader" });
});

test("a token from before the profile scope has no name", () => {
  const token = `${b64url({ alg: "RS256" })}.${b64url({ email: "reader@example.com", sub: "1" })}.sig`;
  expect(parseIdTokenClaims(token)).toEqual({ email: "reader@example.com", name: null });
});

test("returns nulls for missing/garbage tokens", () => {
  const none = { email: null, name: null };
  expect(parseIdTokenClaims(undefined)).toEqual(none);
  expect(parseIdTokenClaims("not-a-jwt")).toEqual(none);
  expect(parseIdTokenClaims(`${b64url({})}.${b64url({ sub: "1" })}.sig`)).toEqual(none);
});
