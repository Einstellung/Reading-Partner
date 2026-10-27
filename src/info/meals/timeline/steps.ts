// A prep session's steps (docs/671 菜品图, 时间线与语音): what the model writes
// for the session's pots, held to a shape the scheduler can lay out.
//
// The model writes each step's sentence, the device it runs on, its pot, its
// hands-on and waiting minutes and the steps it waits for. It never writes a
// clock time, an order of the day, the packing or the storage: the scheduler
// places the steps (schedule.ts) and the program adds the last step, the one
// that packs and puts everything away (PACK_STEP_ID).

import { EQUIPMENT, type Equipment } from "../dishes/types";

/** Where a step runs: a device of the kitchen, or the counter for work with no device (cutting, mixing). */
export type LaneDevice = Equipment | "counter";

export const COUNTER = "counter" as const;

/** The pot id the session's batch of rice goes by. */
export const RICE_POT = "rice";

/** The program's last step: pack the pots and put everything away. Never the model's. */
export const PACK_STEP_ID = "pack";
/** Its hands-on minutes: a starting value, not measured. */
export const PACK_MIN = 10;

/** A step's minutes are held to this, hands-on and waiting each. */
export const MAX_STEP_MIN = 240;
/** The most steps one session's reply may hold. */
export const MAX_PREP_STEPS = 40;

export interface PrepStep {
  /** "1".."n" in the order first planned; PACK_STEP_ID for the program's last step. */
  id: string;
  /** One sentence, in the reader's language. Empty on the program's step: the screen words it. */
  text: string;
  device: LaneDevice;
  /** The pot it belongs to (a batch id, or RICE_POT), or null for a step shared by pots. */
  pot: string | null;
  /** Minutes the reader's hands are on it. */
  active: number;
  /** Minutes the device then runs or the food sits without the reader (simmering, the rice cooker). */
  wait: number;
  /** Steps that must be finished before this one starts. */
  after: string[];
}

/** What a reply is checked against: the session's kitchen and pots. */
export interface StepContext {
  devices: ReadonlySet<string>;
  pots: ReadonlySet<string>;
}

type Parsed = { ok: true; value: PrepStep[] } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// "1. ", "Step 2:", "第3步：" — the screen numbers the steps itself.
const LEADING_NUMBER = /^\s*(?:step\s*\d+\s*[:.：]|第\s*\d+\s*步\s*[:：]?|\d+\s*[.)、:：])\s*/i;

function idOf(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function minutesOf(raw: unknown): number | null {
  const n = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_STEP_MIN) return null;
  return Math.round(n);
}

/** Whether the `after` links leave every step reachable without going round in a circle. */
export function acyclic(steps: readonly Pick<PrepStep, "id" | "after">[]): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const seen = state.get(id);
    if (seen === 2) return true;
    if (seen === 1) return false;
    state.set(id, 1);
    for (const p of byId.get(id)?.after ?? []) if (!visit(p)) return false;
    state.set(id, 2);
    return true;
  };
  return steps.every((s) => visit(s.id));
}

/**
 * The steps of a reply, or why the reply is refused. Whole replies are
 * refused rather than patched: a step on a device the reader lacks, a pot
 * that is not the session's, a pot with no step, a link to a step that does
 * not exist or a circle of links. Only a leading number on a sentence is
 * taken off and minutes are rounded. Ids are the model's, as written; the
 * caller renumbers them (renumber).
 */
export function readPrepSteps(raw: unknown, ctx: StepContext): Parsed {
  if (!isRecord(raw)) return { ok: false, error: "reply is not an object" };
  const list = raw.steps;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: "no steps in reply" };
  if (list.length > MAX_PREP_STEPS) return { ok: false, error: `more than ${MAX_PREP_STEPS} steps` };
  const steps: PrepStep[] = [];
  const ids = new Set<string>();
  for (const [i, item] of list.entries()) {
    const at = `step ${i + 1}`;
    if (!isRecord(item)) return { ok: false, error: `${at} is not an object` };
    const id = idOf(item.id);
    if (!id) return { ok: false, error: `${at} has no id` };
    if (id === PACK_STEP_ID || ids.has(id)) return { ok: false, error: `${at} repeats the id ${id}` };
    ids.add(id);
    const text = typeof item.text === "string" ? item.text.trim().replace(LEADING_NUMBER, "").trim() : "";
    if (!text) return { ok: false, error: `${at} has no text` };
    const device = typeof item.device === "string" ? item.device.trim().toLowerCase() : "";
    if (device !== COUNTER && !ctx.devices.has(device)) return { ok: false, error: `${at} uses ${device || "no device"}, not in the kitchen` };
    const pot = item.pot === null || item.pot === undefined || item.pot === "" ? null : idOf(item.pot);
    if (pot !== null && !ctx.pots.has(pot)) return { ok: false, error: `${at} names pot ${pot}, not one of this session's` };
    const active = minutesOf(item.active ?? 0);
    const wait = minutesOf(item.wait ?? 0);
    if (active === null || wait === null) return { ok: false, error: `${at} has minutes out of 0..${MAX_STEP_MIN}` };
    if (active + wait === 0) return { ok: false, error: `${at} takes no time` };
    const afterRaw = item.after ?? [];
    if (!Array.isArray(afterRaw)) return { ok: false, error: `${at} has an after that is not a list` };
    const after = afterRaw.map(idOf);
    if (after.some((a) => a === null)) return { ok: false, error: `${at} has an after entry that is not an id` };
    steps.push({ id, text, device: device as LaneDevice, pot, active, wait, after: [...new Set(after as string[])] });
  }
  for (const s of steps) {
    const bad = s.after.find((a) => a === s.id || !ids.has(a));
    if (bad) return { ok: false, error: `step ${s.id} waits for ${bad}, which is not another step` };
  }
  if (!acyclic(steps)) return { ok: false, error: "the steps wait for each other in a circle" };
  const missing = [...ctx.pots].filter((p) => !steps.some((s) => s.pot === p));
  if (missing.length) return { ok: false, error: `no step for pot ${missing.join(", ")}` };
  return { ok: true, value: steps };
}

/** The steps with ids "1".."n" in the given order, every link moved with them. */
export function renumber(steps: readonly PrepStep[], order: readonly string[]): PrepStep[] {
  const next = new Map(order.map((id, i) => [id, String(i + 1)]));
  const byId = new Map(steps.map((s) => [s.id, s]));
  return order.flatMap((id) => {
    const s = byId.get(id);
    return s ? [{ ...s, id: next.get(id)!, after: s.after.map((a) => next.get(a) ?? a) }] : [];
  });
}

/** The program's last step, after every other one. */
export function packStep(steps: readonly Pick<PrepStep, "id">[]): PrepStep {
  return { id: PACK_STEP_ID, text: "", device: COUNTER, pot: null, active: PACK_MIN, wait: 0, after: steps.map((s) => s.id) };
}

/** The stored steps with the program's last step added. */
export function withPackStep(steps: readonly PrepStep[]): PrepStep[] {
  const own = steps.filter((s) => s.id !== PACK_STEP_ID);
  return [...own, packStep(own)];
}

/** Whether a stored value is a list of steps the scheduler can lay out (the file is read back through it). */
export function isStepList(raw: unknown): raw is PrepStep[] {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  const devices = new Set<string>([...EQUIPMENT, COUNTER]);
  const ok = raw.every(
    (s) =>
      isRecord(s) &&
      typeof s.id === "string" &&
      typeof s.text === "string" &&
      typeof s.device === "string" &&
      devices.has(s.device) &&
      (s.pot === null || typeof s.pot === "string") &&
      typeof s.active === "number" &&
      typeof s.wait === "number" &&
      s.active >= 0 &&
      s.wait >= 0 &&
      Array.isArray(s.after) &&
      s.after.every((a) => typeof a === "string"),
  );
  if (!ok) return false;
  const steps = raw as PrepStep[];
  const ids = new Set(steps.map((s) => s.id));
  return ids.size === steps.length && steps.every((s) => s.after.every((a) => ids.has(a) && a !== s.id)) && acyclic(steps);
}
