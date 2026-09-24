// src/platform/app/health.ts: the call off iOS, and the reduction of the raw
// HealthKit payload to what the meal targets use.

import { expect, test } from "bun:test";

import {
  readBodyMeasurements,
  toBodyMeasurements,
  type HealthBodyPayload,
  type HealthSample,
} from "../../../src/platform/app/health";

const NOW = new Date(2026, 8, 24, 12, 0); // 2026-09-24 local noon
const DAY = 24 * 3600 * 1000;

function sample(value: number, daysAgo: number): HealthSample {
  const at = new Date(NOW.getTime() - daysAgo * DAY);
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return { value, day, at: at.getTime() };
}

test("no Tauri host means not iOS: null at once", async () => {
  expect(await readBodyMeasurements()).toBeNull();
});

test("a device with no Health store gives null", () => {
  expect(toBodyMeasurements({ available: false }, NOW)).toBeNull();
});

test("nothing recorded or nothing allowed gives null", () => {
  expect(toBodyMeasurements({ available: true, mass: [], leanMass: [] }, NOW)).toBeNull();
});

test("a full payload maps field by field", () => {
  const raw: HealthBodyPayload = {
    available: true,
    height: sample(172.46, 400),
    mass: [sample(70.2, 0.5), sample(71, 3), sample(70.4, 6), sample(75, 10)],
    bodyFat: sample(0.214, 5),
    leanMass: [sample(50, 3)],
    waist: sample(81.26, 12),
    sex: "f",
    birth: { year: 1990, month: 3, day: 15 },
  };
  expect(toBodyMeasurements(raw, NOW)).toEqual({
    heightCm: 172.5,
    // 10 days ago is outside the week.
    weightKg: 70.5,
    weightFrom: "2026-09-18",
    weightTo: "2026-09-24",
    // Recorded body fat wins over the lean-mass derivation.
    bodyFatPct: 21.4,
    waistCm: 81.3,
    sex: "f",
    age: 36,
  });
});

test("no weight in the last 7 days leaves weight and its range null", () => {
  const m = toBodyMeasurements({ available: true, mass: [sample(72, 9)], height: sample(180, 30) }, NOW);
  expect(m?.weightKg).toBeNull();
  expect(m?.weightFrom).toBeNull();
  expect(m?.weightTo).toBeNull();
  expect(m?.heightCm).toBe(180);
});

test("without recorded body fat, lean mass over same-day body mass is used", () => {
  const raw: HealthBodyPayload = {
    available: true,
    mass: [sample(80, 2), sample(82, 20)],
    // The newest lean sample has no body mass on its day; the older one does.
    leanMass: [sample(60, 1), sample(61.5, 20)],
  };
  expect(toBodyMeasurements(raw, NOW)?.bodyFatPct).toBe(25);
});

test("lean mass with no same-day body mass gives no body fat", () => {
  const raw: HealthBodyPayload = { available: true, mass: [sample(80, 2)], leanMass: [sample(60, 1)] };
  expect(toBodyMeasurements(raw, NOW)?.bodyFatPct).toBeNull();
});

test("age turns over on the birthday itself", () => {
  const on = (month: number, day: number) =>
    toBodyMeasurements({ available: true, birth: { year: 2000, month, day } }, NOW)?.age;
  expect(on(9, 24)).toBe(26);
  expect(on(9, 25)).toBe(25);
  expect(on(10, 1)).toBe(25);
  expect(on(1, 1)).toBe(26);
});

test("a sex other than m or f is null", () => {
  const m = toBodyMeasurements({ available: true, sex: "other", height: sample(170, 1) }, NOW);
  expect(m?.sex).toBeNull();
});
