// The nightly collection's switch (src/info/program/nightly-collect.ts): off,
// the briefing neither generates itself nor polls its sources, and the 05:00
// round has no schedule to ring a bell for. On, the gates are the ones the
// assembly hands in and the round is registered as before. Run:
// scripts/t.sh tests/info/program/nightly-collect.test.ts

import { expect, test } from "bun:test";
import {
  NIGHTLY_COLLECT_ENABLED,
  switchedGates,
} from "../../../src/info/program/nightly-collect";
import {
  DAILY_ANCHOR_HOUR,
  DAILY_ROUND_SCHEDULE,
  registerMorningRound,
} from "../../../src/info/program/daily";
import { registeredSchedules } from "../../../src/legion/schedule";
import { COLLECT_KIND } from "../../../src/info/briefer/handoff";

function counting() {
  const asked = { generate: 0, poll: 0 };
  const gates = {
    canAutoGenerate: async () => {
      asked.generate += 1;
      return true;
    },
    backgroundOn: async () => {
      asked.poll += 1;
      return true;
    },
  };
  return { asked, gates };
}

// Pinned on purpose: switched off 2026-10-17 until the briefing's redesign says
// otherwise. Turning it back on is that one line and this one.
test("the nightly collection is switched off", () => {
  expect(NIGHTLY_COLLECT_ENABLED).toBe(false);
});

test("off: both gates are closed and the assembly's gates are never asked", async () => {
  const { asked, gates } = counting();
  const off = switchedGates(gates, false);
  expect(await off.canAutoGenerate()).toBe(false);
  expect(await off.backgroundOn()).toBe(false);
  expect(asked).toEqual({ generate: 0, poll: 0 });
});

test("the default is the switch's value", async () => {
  const { gates } = counting();
  expect(await switchedGates(gates).canAutoGenerate()).toBe(NIGHTLY_COLLECT_ENABLED);
  expect(await switchedGates(gates).backgroundOn()).toBe(NIGHTLY_COLLECT_ENABLED);
});

test("on: the assembly's gates answer", async () => {
  const { asked, gates } = counting();
  const on = switchedGates(gates, true);
  expect(await on.canAutoGenerate()).toBe(true);
  expect(await on.backgroundOn()).toBe(true);
  expect(asked).toEqual({ generate: 1, poll: 1 });
});

test("off: the morning round registers no schedule", () => {
  expect(registerMorningRound()).toBe(false);
  expect(registerMorningRound(false)).toBe(false);
  expect(registeredSchedules().some((s) => s.id === DAILY_ROUND_SCHEDULE)).toBe(false);
});

test("on: the morning round is the collect election's at the anchor hour", () => {
  expect(registerMorningRound(true)).toBe(true);
  const round = registeredSchedules().find((s) => s.id === DAILY_ROUND_SCHEDULE);
  expect(round?.kind).toBe(COLLECT_KIND);
  expect(round?.at).toEqual({ daily: { hour: DAILY_ANCHOR_HOUR } });
});
