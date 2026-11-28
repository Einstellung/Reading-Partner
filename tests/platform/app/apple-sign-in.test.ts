// The Sign in with Apple wrapper (src/platform/app/apple-sign-in.ts) against an
// injected invoke. Run: scripts/t.sh tests/platform/app/apple-sign-in.test.ts

import { expect, test } from "bun:test";

import {
  APPLE_SIGN_IN_ENABLED,
  appleSignInAvailable,
  sha256Hex,
  signInWithApple,
  type AppleSignInDeps,
} from "../../../src/platform/app/apple-sign-in";

function deps(answer: unknown, overrides: Partial<AppleSignInDeps> = {}) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const d: AppleSignInDeps = {
    enabled: true,
    isTauri: () => true,
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      if (answer instanceof Error) throw answer;
      return answer;
    },
    randomBytes: (n) => new Uint8Array(n).fill(0xab),
    ...overrides,
  };
  return { d, calls };
}

test("ships turned off", () => {
  expect(APPLE_SIGN_IN_ENABLED).toBe(false);
});

test("turned off, nothing is invoked and the answer is unavailable", async () => {
  const { d, calls } = deps({ ok: true, idToken: "t" }, { enabled: false });
  expect(await signInWithApple(d)).toEqual({ ok: false, error: "unavailable" });
  expect(await appleSignInAvailable(d)).toBe(false);
  expect(calls.length).toBe(0);
});

test("the default deps never reach a plugin under bun", async () => {
  expect(await signInWithApple()).toEqual({ ok: false, error: "unavailable" });
  expect(await appleSignInAvailable()).toBe(false);
});

test("without a Tauri host, nothing is invoked", async () => {
  const { d, calls } = deps({ ok: true, idToken: "t" }, { isTauri: () => false });
  expect(await signInWithApple(d)).toEqual({ ok: false, error: "unavailable" });
  expect(calls.length).toBe(0);
});

test("the plugin gets the SHA-256 of the raw nonce, and the caller gets the raw nonce", async () => {
  const { d, calls } = deps({ ok: true, idToken: "apple.jwt" });
  const result = await signInWithApple(d);
  const raw = "ab".repeat(32);
  expect(result).toEqual({ ok: true, idToken: "apple.jwt", nonce: raw });
  expect(calls).toEqual([{ cmd: "plugin:apple-sign-in|sign_in", args: { nonce: await sha256Hex(raw) } }]);
});

test("sha256Hex is lowercase hex", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("a cancel, a failure and a thrown invoke each come back as values", async () => {
  expect(await signInWithApple(deps({ ok: false, cancelled: true }).d)).toEqual({ ok: false, cancelled: true });
  expect(await signInWithApple(deps({ ok: false, error: "boom" }).d)).toEqual({ ok: false, error: "boom" });
  expect(await signInWithApple(deps({ ok: true }).d)).toEqual({ ok: false, error: "Apple sign-in failed." });
  expect(await signInWithApple(deps(new Error("ipc down")).d)).toEqual({ ok: false, error: "ipc down" });
});

test("availability follows the probe and swallows its failure", async () => {
  expect(await appleSignInAvailable(deps(true).d)).toBe(true);
  expect(await appleSignInAvailable(deps(false).d)).toBe(false);
  expect(await appleSignInAvailable(deps(new Error("no plugin")).d)).toBe(false);
});
