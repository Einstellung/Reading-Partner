// The presence with the real claim writer and the real round over in-memory
// claim files: who claims, and that the dream follows the election while the
// sweep runs wherever the round does.

import { describe, expect, test } from "bun:test";
import { createClaimWriter, type DeviceClaim } from "../../src/legion/claim";
import { createDailyRound } from "../../src/presence/daily";
import { createDevicePresence } from "../../src/presence/session";
import type { DeviceRole } from "../../src/platform/app/device";

const settle = () => new Promise((r) => setTimeout(r, 0));

function device(opts: { role: DeviceRole; willing?: boolean; others?: DeviceClaim[] }) {
  const files = new Map<string, DeviceClaim>();
  for (const c of opts.others ?? []) files.set(c.deviceId, c);
  let role = opts.role;
  let clock = 1_000_000;
  const calls = { dream: 0, sweep: 0 };
  const ticks: (() => void)[] = [];
  const writer = createClaimWriter<number>({
    deviceId: () => "me",
    describe: async () => ({ deviceName: "desk", platform: "linux", capabilities: [] }),
    willing: async () => opts.willing ?? true,
    readOwn: async (id) => files.get(id) ?? null,
    readAll: async () => [...files.values()],
    write: async (claim) => {
      files.set(claim.deviceId, claim);
    },
    now: () => clock,
    setInterval: () => 0,
    clearInterval: () => {},
    // Not signed in: a machine alone in the world claims at once.
    subscribeSyncStatus: (cb) => {
      cb({ engineStarted: false, lastSyncAt: null });
      return () => {};
    },
    onExit: () => {},
  });
  let electedFor: () => Promise<boolean> = async () => false;
  const round = createDailyRound({
    elected: () => electedFor(),
    dream: async () => {
      calls.dream += 1;
    },
    sweep: async () => {
      calls.sweep += 1;
    },
    setTimer: (_ms, cb) => {
      ticks.push(cb);
      return () => {};
    },
    onForeground: () => {},
    onExit: () => {},
  });
  const presence = createDevicePresence({ role: () => role, writer, round });
  electedFor = presence.elected;
  return {
    presence,
    files,
    calls,
    ticks,
    setRole: (r: DeviceRole) => {
      role = r;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function claim(deviceId: string, claimedAt: number | null, heartbeatAt: number): DeviceClaim {
  return { deviceId, deviceName: deviceId, platform: "macos", capabilities: [], claimedAt, heartbeatAt };
}

describe("device presence", () => {
  test("a collector alone claims, and its round runs the dream and the sweep", async () => {
    const d = device({ role: "collector" });
    await d.presence.refresh();
    await settle();
    expect(d.files.get("me")?.claimedAt).not.toBeNull();
    expect(d.calls).toMatchObject({ dream: 1, sweep: 1 });
    // At the next tick it asks again.
    d.advance(60_001);
    d.ticks[0]!();
    await settle();
    expect(d.calls).toMatchObject({ dream: 2, sweep: 2 });
  });

  test("a collector that lost the election sweeps but leaves the dream to the winner", async () => {
    const d = device({ role: "collector", others: [claim("older", 1, 1_000_000)] });
    await d.presence.refresh();
    await settle();
    expect(await d.presence.elected()).toBe(false);
    expect(d.calls).toMatchObject({ dream: 0, sweep: 1 });
  });

  test("a collector with background work switched off stands for nothing but still sweeps", async () => {
    const d = device({ role: "collector", willing: false });
    await d.presence.refresh();
    await settle();
    expect(d.files.get("me")?.claimedAt).toBeNull();
    expect(d.calls).toMatchObject({ dream: 0, sweep: 1 });
  });

  test("a reader writes no claim and runs no round", async () => {
    const d = device({ role: "reader" });
    await d.presence.refresh();
    await settle();
    expect(d.files.has("me")).toBe(false);
    expect(d.calls).toMatchObject({ dream: 0, sweep: 0 });
    expect(d.ticks).toHaveLength(0);
  });

  test("turning a collector into a reader gives the claim up", async () => {
    const d = device({ role: "collector" });
    await d.presence.refresh();
    d.setRole("reader");
    await d.presence.refresh();
    expect(d.files.get("me")?.claimedAt).toBeNull();
    expect(await d.presence.elected()).toBe(false);
  });
});
