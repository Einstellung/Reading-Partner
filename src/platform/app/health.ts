// Apple Health, read-only: the body measurements the meal targets start from.
//
// Native half: plugins/health (Swift HealthKit queries on iOS; null
// everywhere else). The first call on a device shows the system's
// authorization sheet, so call this only after the reader has agreed to it.
// HealthKit does not say whether a type was denied — a denied type reads as no
// samples — so every field is simply null when there is nothing to use.
//
// Swift sends the raw samples; the reductions (7-day mean, lean-mass fallback,
// age) are here, in `toBodyMeasurements`, so they can be tested.

import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";

export interface BodyMeasurements {
  heightCm: number | null;
  /** Mean of the samples in the last 7 days. */
  weightKg: number | null;
  /** The days (YYYY-MM-DD, device time zone) the weight mean covers. */
  weightFrom: string | null;
  weightTo: string | null;
  /** Percent, 0-100. */
  bodyFatPct: number | null;
  waistCm: number | null;
  sex: "m" | "f" | null;
  age: number | null;
}

/** One HealthKit sample as Swift sends it. */
export interface HealthSample {
  value: number;
  /** YYYY-MM-DD of the sample's end, in the device's time zone. */
  day: string;
  /** The same instant, epoch milliseconds. */
  at: number;
}

/** The payload of `plugin:health|read_body` (plugins/health/ios). */
export interface HealthBodyPayload {
  available: boolean;
  /** cm, the latest ever. */
  height?: HealthSample;
  /** kg, the last 30 days, newest first. */
  mass?: HealthSample[];
  /** A fraction (0.25 = 25 %), the latest within 30 days. */
  bodyFat?: HealthSample;
  /** kg, the last 30 days, newest first. */
  leanMass?: HealthSample[];
  /** cm, the latest within 30 days. */
  waist?: HealthSample;
  sex?: string;
  birth?: { year: number; month: number; day: number };
}

const DAY_MS = 24 * 3600 * 1000;
const WEIGHT_WINDOW_DAYS = 7;

/**
 * Ask Apple Health for the reader's body measurements. Null off iOS, when the
 * device has no Health store, when the request fails, and when nothing at all
 * came back.
 */
export async function readBodyMeasurements(): Promise<BodyMeasurements | null> {
  if (!onIOS()) return null;
  try {
    const raw = await invoke<HealthBodyPayload | null>("plugin:health|read_body");
    return raw ? toBodyMeasurements(raw, new Date()) : null;
  } catch {
    return null;
  }
}

function onIOS(): boolean {
  try {
    return platform() === "ios";
  } catch {
    // Not under Tauri (tests, plain-browser dev).
    return false;
  }
}

/** The payload reduced to what the meal targets use, as of `now`. */
export function toBodyMeasurements(raw: HealthBodyPayload, now: Date): BodyMeasurements | null {
  if (!raw.available) return null;
  const mass = raw.mass ?? [];

  const since = now.getTime() - WEIGHT_WINDOW_DAYS * DAY_MS;
  const week = mass.filter((s) => s.at >= since);
  const days = week.map((s) => s.day).sort();

  const out: BodyMeasurements = {
    heightCm: raw.height ? round1(raw.height.value) : null,
    weightKg: week.length ? round1(week.reduce((sum, s) => sum + s.value, 0) / week.length) : null,
    weightFrom: days[0] ?? null,
    weightTo: days[days.length - 1] ?? null,
    bodyFatPct: bodyFatPct(raw.bodyFat, raw.leanMass ?? [], mass),
    waistCm: raw.waist ? round1(raw.waist.value) : null,
    sex: raw.sex === "m" || raw.sex === "f" ? raw.sex : null,
    age: raw.birth ? ageOn(raw.birth, now) : null,
  };
  return Object.values(out).every((v) => v === null) ? null : out;
}

// Recorded body fat when there is one; otherwise 1 - lean / total from the
// newest lean-mass sample that has a body-mass sample on the same day.
function bodyFatPct(
  recorded: HealthSample | undefined,
  lean: HealthSample[],
  mass: HealthSample[],
): number | null {
  if (recorded) return round1(recorded.value * 100);
  for (const l of [...lean].sort((a, b) => b.at - a.at)) {
    const total = mass.find((m) => m.day === l.day);
    if (total && total.value > 0) return round1((1 - l.value / total.value) * 100);
  }
  return null;
}

// Whole years on `now`'s local calendar day.
function ageOn(birth: { year: number; month: number; day: number }, now: Date): number {
  const month = now.getMonth() + 1;
  const beforeBirthday = month < birth.month || (month === birth.month && now.getDate() < birth.day);
  return now.getFullYear() - birth.year - (beforeBirthday ? 1 : 0);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
