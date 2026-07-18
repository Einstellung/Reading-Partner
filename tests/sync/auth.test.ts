// parseIdTokenEmail (src/sync/auth.ts): pull the email claim out of an OIDC
// id_token without verifying it. Run: bun test.

import { expect, test } from "bun:test";
import { parseIdTokenEmail } from "../../src/sync/auth";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

test("reads the email claim from a well-formed id_token", () => {
  const token = `${b64url({ alg: "RS256" })}.${b64url({ email: "reader@example.com", sub: "1" })}.sig`;
  expect(parseIdTokenEmail(token)).toBe("reader@example.com");
});

test("returns null for missing/garbage tokens", () => {
  expect(parseIdTokenEmail(undefined)).toBeNull();
  expect(parseIdTokenEmail("not-a-jwt")).toBeNull();
  expect(parseIdTokenEmail(`${b64url({})}.${b64url({ sub: "1" })}.sig`)).toBeNull();
});
