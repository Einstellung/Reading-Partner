// Both shells start the distillation sweeps, the phone on its own cadence
// (src/memory/live/sweeps.ts sweepCadence). Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sweepCadence } from "../../src/memory/live/sweeps";
import { SWEEP_INTERVAL_MS } from "../../src/memory/observations/arrears";

const SRC = join(import.meta.dir, "../../src");

test("the phone sweeps only in front, and less often than the desktop", () => {
  expect(sweepCadence("desktop")).toEqual({ intervalMs: SWEEP_INTERVAL_MS, foregroundOnly: false });
  const phone = sweepCadence("phone");
  expect(phone.foregroundOnly).toBe(true);
  expect(phone.intervalMs).toBeGreaterThan(SWEEP_INTERVAL_MS);
});

test("both shells start the sweeps, and the phone names its form", () => {
  const phone = readFileSync(join(SRC, "PhoneApp.tsx"), "utf8");
  const desktop = readFileSync(join(SRC, "App.tsx"), "utf8");
  expect(phone).toMatch(/startDistillSweeps\([^;]*"phone"\)/);
  expect(desktop).toContain("startDistillSweeps(");
});

test("both shells start the daily round through the shared background services", () => {
  const services = readFileSync(join(SRC, "ui/components/common/useBackgroundServices.ts"), "utf8");
  expect(services).toContain("startDailyRound()");
  for (const shell of ["App.tsx", "PhoneApp.tsx"]) {
    expect(readFileSync(join(SRC, shell), "utf8")).toContain("useBackgroundServices(");
  }
});
