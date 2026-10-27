// A prep session's steps (src/info/meals/recipe/prep-steps.ts): the request,
// the one call with a fake model, the stored entry beside the recipes, the
// sweep writing it first, and the run written onto the plan (prep-progress.ts).
// Run: scripts/t.sh tests/info/meals/recipe/prep-steps.test.ts

import { expect, test } from "bun:test";
import { createFakeAppData } from "../../../support/guarded-appdata";
import type { MealsPorts } from "../../../../src/info/meals/apply";
import type { MealsState, WeekPlan } from "../../../../src/info/meals/plan/types";
import { recordPrepEvent, startPrep } from "../../../../src/info/meals/prep-progress";
import { isPrepRequest, prepStepsRequest, writePrepSteps, type PrepStepsEntry, type PrepStepsRequest } from "../../../../src/info/meals/recipe/prep-steps";
import { loadPrepSteps, loadRecipe, savePrepSteps, storedRecipeKeys } from "../../../../src/info/meals/recipe/recipe-store";
import { createRecipeWriter, prepStepsToWrite } from "../../../../src/info/meals/recipe/recipe-sweep";
import { planPrep } from "../../../../src/info/meals/screen/batch-cook";
import { RICE_POT } from "../../../../src/info/meals/timeline/steps";
import { plannerState, START } from "../screen/batch-cook-fixture";

const OPTS = { today: START, region: "other" as const, language: "en" as const };

function request(state: MealsState = plannerState()): PrepStepsRequest {
  const r = prepStepsRequest(state, OPTS);
  if (!r) throw new Error("no prep request");
  return r;
}

// A reply that holds for the request: one step per pot, the rice too.
function goodReply(r: PrepStepsRequest): string {
  const device = r.devices.includes("stove") ? "stove" : "counter";
  const steps = r.pots.map((p, i) => ({ id: `p${i}`, text: `Cook ${p.name}`, device, pot: p.id, active: 10, wait: 20 }));
  if (r.rice) steps.push({ id: "rice", text: "Start the rice", device: "counter", pot: RICE_POT, active: 5, wait: 0 });
  return JSON.stringify({ steps: [{ id: "cut", text: "Cut everything", device: "counter", pot: null, active: 15, wait: 0 }, ...steps.map((s) => ({ ...s, after: ["cut"] }))] });
}

test("the request names the session's pots and keys on what changes the steps", () => {
  const r = request();
  expect(isPrepRequest(r)).toBe(true);
  expect(r.session).toBe("s1");
  expect(r.pots.length).toBeGreaterThan(0);
  expect(request().key).toBe(r.key);
  expect(prepStepsRequest(plannerState(), { ...OPTS, language: "zh-CN" })!.key).not.toBe(r.key);
  expect(prepStepsRequest(plannerState({ profile: { people: 2 } }), OPTS)!.key).not.toBe(r.key);
});

test("one call writes the steps, numbered in the planned order", async () => {
  const r = request();
  const saved: PrepStepsEntry[] = [];
  const entry = await writePrepSteps(r, {
    call: async () => goodReply(r),
    save: async (_key, e) => (saved.push(e), e),
    now: () => 7,
  });
  expect(saved).toHaveLength(1);
  expect(entry.steps[0]).toMatchObject({ id: "1", text: "Cut everything", after: [] });
  expect(entry.steps.slice(1).every((s) => s.after.includes("1"))).toBe(true);
});

test("a reply that does not hold writes nothing", async () => {
  const r = request();
  let saves = 0;
  const deps = { save: async (_k: string, e: PrepStepsEntry) => (saves++, e), now: () => 7 };
  await expect(writePrepSteps(r, { ...deps, call: async () => "Sorry, I cannot." })).rejects.toThrow();
  await expect(writePrepSteps(r, { ...deps, call: async () => JSON.stringify({ steps: [{ id: 1, text: "x", device: "laser", active: 5 }] }) })).rejects.toThrow();
  expect(saves).toBe(0);
});

test("the steps are kept beside the recipes, under their own key", async () => {
  const io = createFakeAppData();
  const r = request();
  const entry: PrepStepsEntry = { kind: "prep", at: 5, name: r.name, session: r.session, steps: [{ id: "1", text: "Cut", device: "counter", pot: null, active: 5, wait: 0, after: [] }] };
  await savePrepSteps(r.key, entry, 5, io);
  expect(await loadPrepSteps(r.key, io)).toEqual(entry);
  expect(await loadRecipe(r.key, io)).toBeNull();
  expect((await storedRecipeKeys(io)).has(r.key)).toBe(true);
});

test("the sweep writes a prep still ahead first, and not once it is done or stored", async () => {
  const state = plannerState();
  const stored = new Set<string>();
  expect(prepStepsToWrite(state, { ...OPTS, stored })).toHaveLength(1);
  expect(prepStepsToWrite(plannerState({ preppedAt: 1 }), { ...OPTS, stored })).toHaveLength(0);
  expect(prepStepsToWrite(state, { ...OPTS, stored: new Set([request().key]) })).toHaveLength(0);

  const asked: string[] = [];
  let fail = true;
  let now = 0;
  const writer = createRecipeWriter({
    state: async () => state,
    language: async () => "en",
    region: () => "other",
    stored: async () => stored,
    write: async (req) => {
      asked.push(isPrepRequest(req) ? "prep" : "recipe");
      if (fail) throw new Error("model down");
      stored.add(req.key);
    },
    today: () => START,
    now: () => now,
  });
  expect((await writer.sweep()).why).toBe("failed");
  expect(asked).toEqual(["prep"]);
  expect((await writer.sweep()).why).toBe("backing-off");
  fail = false;
  now = 60 * 60 * 1000;
  await writer.sweep();
  expect(asked[1]).toBe("prep");
});

test("the written minutes win over the estimate", () => {
  expect(planPrep(plannerState(), START, { activeMin: 7, totalMin: 9 })).toMatchObject({ activeMin: 7, totalMin: 9 });
});

test("start and events are written onto the plan's planner record", async () => {
  let state = plannerState();
  let saves = 0;
  let clock = Date.UTC(2026, 9, 25, 14, 0);
  const ports: Pick<MealsPorts, "current" | "savePlan" | "now" | "changed"> = {
    current: async () => state,
    savePlan: async (plan: WeekPlan) => {
      saves++;
      state = { ...state, plan };
    },
    now: () => clock,
    changed: () => {},
  };
  const timeline = { key: "k1", steps: [{ id: "1", text: "Cut", device: "counter" as const, pot: null, active: 10, wait: 0, after: [] }], kitchen: { burners: 2 } };
  expect(await recordPrepEvent(ports, timeline, { step: "1", event: "done" })).toBeNull();
  const run = await startPrep(ports, "k1");
  expect(run?.startedAt).toBe(clock);
  clock += 60_000;
  expect(await startPrep(ports, "k1")).toEqual(run);
  expect(saves).toBe(1);
  clock += 11 * 60_000;
  const r = await recordPrepEvent(ports, timeline, { step: "1", event: "done" });
  expect(r?.applied).toBe(true);
  expect(state.plan?.planner?.prepRun?.steps["1"]).toEqual({ started: 0, handsDone: 12, done: 12 });
  expect(state.plan?.revision).toBe(plannerState().plan?.revision);
});
