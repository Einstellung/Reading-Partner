// The prep's voice (docs/671 时间线与语音): the front's step list, prep_step and
// prep_say, start_prep, the timer prompts and the prep card.
// Run: scripts/t.sh tests/info/meals/prep-voice.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../src/i18n";
import { putMealsPrepCard, type PrepCardThreads } from "../../../src/info/briefer/meals-call";
import type { MealsPrepCardData } from "../../../src/info/meals/cards";
import type { MealsState, PrepRun } from "../../../src/info/meals/plan/types";
import type { PrepProgressPorts } from "../../../src/info/meals/prep-progress";
import { recordPrepSessionEvent, startPrepSession, type PrepSteps } from "../../../src/info/meals/prep-session";
import {
  buildPrepSayTool,
  buildPrepStepTool,
  buildStartPrepTool,
  createDuePrompter,
  dueSentence,
  prepCallPlace,
  prepCardView,
  prepId,
  prepInput,
  prepStepList,
  prepVoiceState,
  stepByNumber,
  type PrepVoiceTimeline,
} from "../../../src/info/meals/prep-voice";
import { prepGraph } from "../../../src/info/meals/screen/prep-graph";
import * as P from "./screen/prep-graph-fixture";
import type { StepEvent } from "../../../src/info/meals/timeline/run";
import { sayDue, sayLeft, sayNext, sayNow, timelineView } from "../../../src/info/meals/timeline/view";
import type { PersistedPart } from "../../../src/platform/app/threads";
import { plannerState } from "./screen/batch-cook-fixture";
import { at, CHILI_STEPS, runOnStep2, STEPS_KEY, T0 } from "./screen/prep-timeline-fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

const STEPS: PrepSteps = { key: STEPS_KEY, steps: CHILI_STEPS, kitchen: { burners: 2 }, boxes: true };
const tl = (run: PrepRun): PrepVoiceTimeline => ({ ...STEPS, run });
const view = (run: PrepRun, minute: number) => timelineView(prepInput(tl(run), at(minute)));

function withRun(run: PrepRun | null): MealsState {
  const s = plannerState();
  const plan = s.plan!;
  return { ...s, plan: { ...plan, planner: { ...plan.planner!, ...(run ? { prepRun: run } : {}) } } };
}

/** The plan on a fake store, its clock, and every card put. */
function store(run: PrepRun | null, minute = 12) {
  let state = withRun(run);
  const clock = { now: at(minute) };
  const cards: MealsPrepCardData[] = [];
  const ports = {
    current: async () => state,
    savePlan: async (plan: MealsState["plan"]) => {
      state = { ...state, plan };
    },
    now: () => clock.now,
    changed: () => {},
  } as unknown as PrepProgressPorts;
  const deps = { ports, putCard: async (card: MealsPrepCardData) => void cards.push(card) };
  return { deps, cards, clock, run: () => state.plan!.planner!.prepRun! };
}

test("the front's list: number, sentence, device, state; no clock times and no minutes", () => {
  const v = view(runOnStep2(), 12);
  const list = prepStepList(v);
  expect(list.split("\n")[0]).toBe("1. Chop the onion and the peppers | Counter | done");
  expect(list).toContain("2. Brown the chicken in the big pot | Stove | doing now");
  expect(list).toContain("3. Add the beans and tomatoes, then simmer | Stove | not started");
  expect(list).not.toMatch(/\d{1,2}:\d{2}|\bmin/);
  expect(prepCallPlace(v)).toContain(list);
});

test("prep_step writes the event through the run: done on step 2 moves the timeline", async () => {
  const s = store(runOnStep2(), 15);
  const timeline = () => tl(s.run());
  const tool = buildPrepStepTool({
    timeline,
    now: () => s.clock.now,
    say: () => true,
    record: (e) => recordPrepSessionEvent(s.deps, STEPS, e),
  });
  const before = view(s.run(), 15);
  const out = await tool.execute({ step: 2, event: "done" });
  expect(out).toBe("Step 2: done recorded; the timeline moved.");
  expect(s.run().steps["2"]?.done).toBe(15);
  const after = view(s.run(), 15);
  expect(after.steps.find((x) => x.id === "3")!.start).toBeLessThan(before.steps.find((x) => x.id === "3")!.start);
  // The card moved with it, in place under the prep's id.
  expect(s.cards).toHaveLength(1);
  expect(s.cards[0]!.prepId).toBe(prepId(s.run()));
  expect(s.cards[0]!.run).toEqual(s.run());
  // A step already done changes nothing.
  expect(await tool.execute({ step: 1, event: "done" })).toBe("Step 1 is already done. Nothing changed.");
  expect(s.cards).toHaveLength(1);
});

test("prep_step: more takes the minutes said, else 5; numbers name the steps, the program's last included", async () => {
  const events: StepEvent[] = [];
  const tool = buildPrepStepTool({
    timeline: () => tl(runOnStep2()),
    now: () => at(12),
    say: () => true,
    record: async (e) => {
      events.push(e);
      return { run: runOnStep2(), applied: true };
    },
  });
  await tool.execute({ step: 2, event: "more" });
  await tool.execute({ step: "2", event: "more", minutes: 3 });
  await tool.execute({ step: 5, event: "started" });
  expect(await tool.execute({ step: 9, event: "done" })).toContain("no step");
  expect(await tool.execute({ step: 2, event: "finished" })).toContain("done, started or more");
  expect(events).toEqual([
    { step: "2", event: "more", minutes: 5 },
    { step: "2", event: "more", minutes: 3 },
    { step: "pack", event: "started" },
  ]);
});

// The real 17-step prep (two pressure-cooker pots and the rice): the voice goes by
// the numbers the prep page shows, and a waiting-only step by its step's number.
const POTS: Omit<PrepVoiceTimeline, "run"> = { key: P.POTS_KEY, steps: P.POTS_STEPS, kitchen: P.POTS_KITCHEN, boxes: true };
const potsView = (minute: number) => timelineView(prepInput({ ...POTS, run: P.onPlan(minute) }, P.potsAt(minute)));

test("the voice numbers the steps as the page does: hands-on steps in start order, waits under their step", () => {
  setLocale("zh-CN");
  const v = potsView(30);
  const n = (id: string) => v.steps.find((s) => s.id === id)!;
  expect([n("8").n, n("17").n, n("pack").n]).toEqual([7, 15, 16]);
  expect([n("7").n, n("7").under, n("15").n, n("15").under]).toEqual([null, "3", null, "14"]);
  // The page's commits carry the same numbers.
  const graph = prepGraph(v, "running", P.POTS_NAMES);
  const shown = graph.rows.flatMap((r) => (r.kind === "commit" ? [[r.id, r.n]] : []));
  expect(shown).toEqual(v.steps.flatMap((s) => (s.n === null ? [] : [[s.id, s.n]])));

  const lines = prepStepList(v).split("\n");
  expect(lines.filter((l) => /^\d+\. /.test(l))).toHaveLength(16);
  const three = lines.findIndex((l) => l.startsWith("3. 盖好压力锅并设高压烹煮十二分钟"));
  expect(lines[three + 1]).toBe("   after 3: 让压力锅自然泄压至浮阀完全落下。 | 电压力锅 | waiting");
  expect(lines).toContain("7. 开盖检查鸡胸肉最厚处中心温度达到七十四摄氏度，确保熟透。 | 电压力锅 | not started");
  const thirteen = lines.findIndex((l) => l.startsWith("13. 盖好压力锅并设高压烹煮四十分钟"));
  expect(lines[thirteen + 1]).toStartWith("   after 13: 让压力锅自然泄压");
  expect(lines[thirteen + 2]).toStartWith("14. 开盖用低温煎炒档收汁");
  expect(lines).toContain("15. 关闭加热并将挤出的青柠汁拌入牛肉。 | 电压力锅 | not started");
  expect(lines.join("\n")).not.toMatch(/\d{1,2}:\d{2}|分钟后|\bmin\b/);
});

test("prep_step on a number acts on the first of that step and its waits not done yet", async () => {
  for (const [minute, number, id] of [
    [8, 3, "3"], // step 3's pot is still cooking: its own wait
    [30, 3, "7"], // cooked, letting the pressure out: the wait hung under it
    [30, 7, "8"],
    [110, 13, "15"],
    [110, 15, "17"],
    [110, 16, "pack"],
    [110, 1, "1"], // all done: the step itself, which the run reports as already done
  ] as const) {
    const events: StepEvent[] = [];
    const tool = buildPrepStepTool({
      timeline: () => ({ ...POTS, run: P.onPlan(minute) }),
      now: () => P.potsAt(minute),
      say: () => true,
      record: async (e) => {
        events.push(e);
        return { run: P.onPlan(minute), applied: true };
      },
    });
    await tool.execute({ step: number, event: "done" });
    expect([minute, number, events[0]?.step]).toEqual([minute, number, id]);
  }
  expect(stepByNumber(potsView(30), 17)).toBeNull();
});

test("prep_say speaks the program's sentence through the call and asks no model", async () => {
  const said: string[] = [];
  const run = runOnStep2();
  const tool = buildPrepSayTool({ timeline: () => tl(run), now: () => at(12), say: (text) => said.push(text) > 0 });
  const v = view(run, 12);
  expect(await tool.execute({ what: "next" })).toBe(`Said: ${sayNext(v)}`);
  await tool.execute({ what: "now" });
  await tool.execute({ what: "left" });
  expect(said).toEqual([sayNext(v), sayNow(v), sayLeft(v)]);
  expect(said[2]).toMatch(/Done around/);
  expect(await tool.execute({ what: "recipe" })).toBe("Ask for next, now or left.");
  expect(said).toHaveLength(3);
});

test("with nothing running the tools write and say nothing", async () => {
  const said: string[] = [];
  const deps = { timeline: () => null, now: () => at(1), say: (x: string) => said.push(x) > 0, record: async () => null };
  expect(await buildPrepStepTool(deps).execute({ step: 1, event: "done" })).toContain("No prep is running");
  expect(await buildPrepSayTool(deps).execute({ what: "now" })).toBe("No prep is running.");
  expect(said).toEqual([]);
});

// Step 3 started at 20, hands done at 25: the pot simmers until 55.
const SIMMERING = runOnStep2({ "2": { started: 9, handsDone: 19, done: 19 }, "3": { started: 20, handsDone: 25 } });

test("a waiting step running out is said once, with what to do now", () => {
  const due = dueSentence(view(SIMMERING, 54), view(SIMMERING, 55));
  expect(due).toBe(sayDue(view(SIMMERING, 55), "3"));
  expect(due).toStartWith("Stove is done.");
  expect(dueSentence(view(SIMMERING, 55), view(SIMMERING, 56))).toBeNull();
  expect(dueSentence(view(SIMMERING, 40), view(SIMMERING, 41))).toBeNull();
});

test("the prompter ticks on the run's minutes, says each change once, and only what the clock did", () => {
  let run = SIMMERING;
  let now = at(53);
  const timers: { fn: () => void; ms: number }[] = [];
  const said: string[] = [];
  const prompter = createDuePrompter({
    timeline: () => tl(run),
    say: (x) => said.push(x) > 0,
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return () => void timers.splice(timers.indexOf(t), 1);
    },
  });
  prompter.start();
  expect(timers).toHaveLength(1);
  expect(timers[0]!.ms).toBeLessThanOrEqual(60_050);
  const fire = (minute: number) => {
    now = at(minute);
    timers.shift()!.fn();
  };
  fire(54);
  expect(said).toEqual([]);
  fire(55);
  expect(said).toEqual([sayDue(view(run, 55), "3")]);
  fire(56);
  expect(said).toHaveLength(1);
  // Hung up: the timer goes, the run is left as it is.
  prompter.stop();
  expect(timers).toHaveLength(0);
  // Back on a call: what happened meanwhile is not said.
  now = at(57);
  prompter.start();
  fire(58);
  expect(said).toHaveLength(1);
  prompter.stop();
  // The cook says the pot is done a minute early: an event, not the clock, so no prompt.
  run = SIMMERING;
  now = at(53);
  prompter.start();
  run = { ...SIMMERING, steps: { ...SIMMERING.steps, "3": { started: 20, handsDone: 25, done: 54 } } };
  fire(55);
  expect(said).toHaveLength(1);
});

test("start_prep: started with or without voice, and absent where nobody cooks", async () => {
  const tool = (voice: "call" | "joined" | "none") => buildStartPrepTool({ startPrep: async () => ({ kind: "started", voice }) });
  expect(await tool("call").execute({})).toContain("voice call is on");
  expect(await tool("joined").execute({})).toContain("voice call is on");
  expect(await tool("none").execute({})).toContain("Voice is not available");
  expect(await buildStartPrepTool({}).execute({})).toBe("Starting the prep is not available here.");
  expect(await buildStartPrepTool({ startPrep: async () => ({ kind: "no-prep" }) }).execute({})).toContain("no prep session");
});

test("the start writes the run, places the card, then asks for the call; a second start keeps the clock", async () => {
  const s = store(null, 0);
  s.clock.now = T0;
  const order: string[] = [];
  const out = await startPrepSession(
    { ...s.deps, putCard: async (c) => void order.push(`card ${c.run.startedAt}`) },
    STEPS,
    () => {
      order.push("call");
      return "call";
    },
  );
  expect(out).toEqual({ kind: "started", voice: "call" });
  expect(order).toEqual([`card ${T0}`, "call"]);
  s.clock.now = at(5);
  await startPrepSession(s.deps, STEPS, () => "joined");
  expect(s.run().startedAt).toBe(T0);
});

test("the card is placed once and replaced in place under the prep's id", async () => {
  const rows: { ts: number; parts?: PersistedPart[] }[] = [];
  const patched: number[] = [];
  const threads: PrepCardThreads = {
    open: async () => ({ id: "meals", messages: rows }),
    append: (_id, m) => void rows.push({ ts: m.ts, parts: m.parts }),
    patch: (_id, ts, p) => {
      patched.push(ts);
      rows.find((r) => r.ts === ts)!.parts = p.parts;
    },
    now: () => 1000 + rows.length,
  };
  const card = (run: PrepRun): MealsPrepCardData => ({ kind: "meals-prep", prepId: prepId(run), key: STEPS_KEY, steps: CHILI_STEPS, burners: 2, boxes: true, run });
  await putMealsPrepCard(card(runOnStep2()), threads);
  await putMealsPrepCard(card(SIMMERING), threads);
  expect(rows).toHaveLength(1);
  expect(patched).toEqual([1000]);
  const part = rows[0]!.parts![0] as unknown as { type: "card"; id: string; card: MealsPrepCardData };
  expect(part.id).toBe(prepId(SIMMERING));
  // The card reads the same view the page does.
  expect(prepCardView(part.card, at(30))).toEqual(view(SIMMERING, 30));
});

test("the page's voice line: off without voice, idle after a hang-up, in a call", () => {
  expect(prepVoiceState(false, false)).toBe("off");
  expect(prepVoiceState(true, false)).toBe("idle");
  expect(prepVoiceState(true, true)).toBe("in-call");
});
