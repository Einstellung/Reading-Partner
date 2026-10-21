// handleRegister (server/lib/register.ts) with a fake verifier and store.
// Run: cd server && bun test (also picked up by the repo-root scripts/t.sh).

import { expect, test } from "bun:test";
import type { GoogleIdentity } from "../lib/google-id-token";
import { handleRegister, type DeviceReport, type RegisterDeps } from "../lib/register";

const NOW = new Date("2026-10-21T08:00:00Z");
const USER: GoogleIdentity = { sub: "1234", email: "reader@example.com", name: "Reader" };
const DEVICE: DeviceReport = {
  id: "0b6c8f1e-6a59-4c55-9b71-1f7d1c2b3a4d",
  platform: "ios",
  osVersion: "18.1",
  model: "iPad14,1",
  appVersion: "0.26.2",
};

function fakeDeps(identity: GoogleIdentity | null) {
  const users: Array<[GoogleIdentity, Date]> = [];
  const devices: Array<[DeviceReport, string, Date]> = [];
  const tokens: string[] = [];
  const deps: RegisterDeps = {
    verify: async (token) => {
      tokens.push(token);
      return identity;
    },
    store: {
      upsertUser: async (u, now) => void users.push([u, now]),
      upsertDevice: async (d, sub, now) => void devices.push([d, sub, now]),
    },
    now: () => NOW,
  };
  return { deps, users, devices, tokens };
}

test("a verified token upserts the user and the device", async () => {
  const { deps, users, devices, tokens } = fakeDeps(USER);
  const result = await handleRegister({ idToken: "tok", device: DEVICE }, deps);
  expect(result).toEqual({ status: 200, body: { ok: true } });
  expect(tokens).toEqual(["tok"]);
  expect(users).toEqual([[USER, NOW]]);
  expect(devices).toEqual([[DEVICE, "1234", NOW]]);
});

test("a token that fails verification is 401 and writes nothing", async () => {
  const { deps, users, devices } = fakeDeps(null);
  const result = await handleRegister({ idToken: "tok", device: DEVICE }, deps);
  expect(result.status).toBe(401);
  expect(users).toEqual([]);
  expect(devices).toEqual([]);
});

test("absent optional device fields are stored as null", async () => {
  const { deps, devices } = fakeDeps(USER);
  const result = await handleRegister(
    { idToken: "tok", device: { id: "d1", platform: "linux" } },
    deps,
  );
  expect(result.status).toBe(200);
  expect(devices[0][0]).toEqual({
    id: "d1",
    platform: "linux",
    osVersion: null,
    model: null,
    appVersion: null,
  });
});

test("malformed bodies are 400 and never reach the verifier", async () => {
  const bodies: unknown[] = [
    null,
    "x",
    { device: DEVICE },
    { idToken: "", device: DEVICE },
    { idToken: "tok" },
    { idToken: "tok", device: { ...DEVICE, id: "" } },
    { idToken: "tok", device: { ...DEVICE, platform: 3 } },
    { idToken: "tok", device: { ...DEVICE, model: 7 } },
    { idToken: "tok", device: { ...DEVICE, id: "x".repeat(201) } },
  ];
  for (const body of bodies) {
    const { deps, tokens } = fakeDeps(USER);
    expect((await handleRegister(body, deps)).status).toBe(400);
    expect(tokens).toEqual([]);
  }
});
