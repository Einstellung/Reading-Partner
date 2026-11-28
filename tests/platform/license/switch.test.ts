// The client switch (src/platform/license/config.ts): licensing ships dormant.
// While LICENSING_ENABLED is false the start-up gate is open without a single
// request, read or write, and the gate never starts. Run: bun test.

import { expect, test } from "bun:test";
import { checkLicense, type CheckDeps } from "../../../src/platform/license/check";
import { LICENSING_ENABLED } from "../../../src/platform/license/config";
import { createLicenseGate } from "../../../src/platform/license/gate";

test("licensing ships switched off", () => {
  expect(LICENSING_ENABLED).toBe(false);
});

function touched() {
  const calls: string[] = [];
  const deps: CheckDeps = {
    backend: { url: "https://ref.supabase.co", key: "pk" },
    // Configured in every other respect, so only the switch keeps it open.
    publicKey: { kty: "EC", crv: "P-256", x: "x", y: "y" },
    signInAvailable: true,
    session: async () => {
      calls.push("session");
      return { kind: "signed-out" };
    },
    fetch: async () => {
      calls.push("fetch");
      return new Response("{}");
    },
    subtle: crypto.subtle,
    readCache: async () => {
      calls.push("readCache");
      return null;
    },
    writeCache: async () => {
      calls.push("writeCache");
    },
    now: () => 0,
  };
  return { calls, deps };
}

test("with the switch as shipped, the start-up gate is open and nothing is called", async () => {
  const { calls, deps } = touched();
  expect(await checkLicense(deps)).toEqual({ view: "open" });
  expect(calls).toEqual([]);
});

test("with the switch as shipped, the gate never checks or listens", async () => {
  const calls: string[] = [];
  const gate = createLicenseGate({
    enabled: LICENSING_ENABLED,
    check: async () => {
      calls.push("check");
      return { view: "sign-in" };
    },
    now: () => 0,
    observeForeground: () => {
      calls.push("observeForeground");
      return () => {};
    },
    observeSignIn: () => {
      calls.push("observeSignIn");
      return () => {};
    },
    signIn: async () => {
      calls.push("signIn");
    },
    signOut: async () => {
      calls.push("signOut");
    },
    deleteAccount: async () => {
      calls.push("deleteAccount");
      return true;
    },
    purchases: {
      buy: async () => {
        calls.push("buy");
        return { ok: true };
      },
      restore: async () => {
        calls.push("restore");
        return { ok: true };
      },
    },
  });
  gate.start()();
  expect(await gate.recheck()).toEqual({ view: "open" });
  expect(gate.get()).toEqual({ view: "open" });
  expect((await gate.buy()).ok).toBe(false);
  expect((await gate.deleteAccount()).ok).toBe(false);
  expect(calls).toEqual([]);
});

test("the live gate the shells mount is created with the shipped switch", async () => {
  // Reads the source rather than importing it: the live module binds the
  // Tauri host. The gate must take its switch from config, not a literal.
  const source = await Bun.file(
    new URL("../../../src/platform/license/index.ts", import.meta.url),
  ).text();
  expect(source).toContain("enabled: LICENSING_ENABLED,");
  expect(source).toContain("checkLicense(checkDeps)");
});
