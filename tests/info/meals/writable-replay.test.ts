// The two meals changes that failed before edit_data (docs/platform/687 三餐),
// replayed on the data of the day, through the real sandbox in a Worker, the
// housekeeper's guards and the meals stores, with the files in memory.
//
// 10-31: "I have 600 g of chicken breast and 400 g of beef shank, change the
// menu to that" on the saved plan. 11-06: "make the shredded chicken diced and
// braised, without the pressure cooker" on the draft not saved yet. The
// fixtures are that day's files with the reader's body numbers swapped for the
// neutral ones of batch-plan.json and their own words removed.

import { afterEach, describe, expect, test } from "bun:test";
import type { AgentTool, ToolResult } from "../../../src/legion/durable/contract";
import { buildEditTools, registeredWritables, type WritableEntry, type WriteDeps, type WriteIo } from "../../../src/housekeeper/write";
import { PALACE } from "../../../src/palace";
import type { GuardedFileIo } from "../../../src/platform/app/guarded-file";
import { applyDraftFile, type MealsPorts } from "../../../src/info/meals/apply";
import { MEALS_DRAFT_FILE, parseDraftFile } from "../../../src/info/meals/draft-file";
import { liveDraftPorts } from "../../../src/info/meals/draft-store";
import { holdUserDishes } from "../../../src/info/meals/dishes/user-dishes";
import { loadMeals, MEALS_FILE, savePlan, saveShopping, saveCharter, saveDeviation } from "../../../src/info/meals/plan/store";
import type { MealsState } from "../../../src/info/meals/plan/types";
import { addDays } from "../../../src/info/meals/plan/week";
import { targetsOf } from "../../../src/info/meals/plan/solve-week";
import { checkDraft } from "../../../src/info/meals/planner/checks";
import { parseDraft } from "../../../src/info/meals/planner/draft";
import { draftContext } from "../../../src/info/meals/planner/redraft";
import { prepStepsRequest } from "../../../src/info/meals/recipe/prep-steps";
import { buildTaskingAgent } from "../../../src/info/tasking/tasking-agent";
import { runSubagent } from "../../../src/legion/subagent/run";
import {
  mealsDishesEntry,
  mealsDraftEntry,
  mealsPlanEntry,
  registerMealsWritables,
  type MealsWriteDeps,
} from "../../../src/info/meals/writable";
import { testQuickJsWasm } from "../../support/quickjs";
import meals1031 from "./fixtures/replay-1031-meals.json";
import draft1106 from "./fixtures/replay-1106-draft.json";

function guarded<T>(files: Map<string, string>): GuardedFileIo<T> {
  return {
    read: async (file, validate) => {
      const text = files.get(file);
      if (text === undefined) return { status: "missing" };
      const value = validate(JSON.parse(text));
      return value ? { status: "ok", value } : { status: "corrupt", savedAs: null };
    },
    write: async (file, contents) => {
      files.set(file, contents);
    },
    quarantine: async () => null,
    reportCorrupt: () => {},
  };
}

function writeIo(files: Map<string, string>): WriteIo {
  return {
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, text) => {
      files.set(path, text);
    },
    remove: async (path) => {
      files.delete(path);
    },
    list: async (dir) =>
      [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/")).map((p) => p.slice(dir.length + 1)),
  };
}

function setup(today: string, seed: Record<string, unknown>) {
  const files = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const io = guarded<MealsState>(files);
  const clock = { now: Date.parse(`${today}T08:00:00Z`) };
  const log = { changed: 0 };
  const ports: MealsPorts = {
    current: () => loadMeals(io),
    saveCharter: (charter, week) => saveCharter(charter, week, io),
    savePlan: (plan, shopping) => savePlan(plan, shopping, io),
    saveShopping: (shopping) => saveShopping(shopping, io),
    saveDeviation: (deviation, plan, shopping) => saveDeviation(deviation, plan, shopping, io),
    region: () => "other",
    now: () => clock.now,
    today: () => today,
    changed: () => log.changed++,
    drafts: liveDraftPorts(guarded(files)),
  };
  const deps: MealsWriteDeps = { readText: async (p) => files.get(p) ?? null, ports, dishIo: guarded(files) };
  const entries = [mealsDraftEntry(deps), mealsPlanEntry(deps), mealsDishesEntry(deps)] as WritableEntry<unknown>[];
  const write: WriteDeps = {
    io: writeIo(files),
    rows: PALACE,
    now: () => clock.now,
    device: () => "dev-test",
    entryOf: (kind) => entries.find((e) => e.kind === kind) ?? null,
  };
  const cards: unknown[] = [];
  const [edit, undo] = buildEditTools(
    [],
    { initiator: { threadId: "meals", place: "meals" }, raiseCard: (card) => cards.push(card) },
    { wasm: testQuickJsWasm, runner: "worker", write },
  );
  const call = async (tool: AgentTool, args: Record<string, unknown>): Promise<ToolResult> => {
    clock.now += 60_000;
    const out = await tool.execute(args);
    return typeof out === "string" ? { text: out } : out;
  };
  return {
    files,
    ports,
    log,
    cards,
    edit: (kind: string, code: string, why: string) => call(edit!, { kind, code, why }),
    undo: (kind: string) => call(undo!, { kind }),
    state: () => loadMeals(io),
  };
}

afterEach(() => holdUserDishes([]));

/** The raw protein grams a pot's meals eat, added up from the solved plan. */
function potGrams(state: MealsState, batchId: string): number {
  const rec = state.plan!.planner!;
  const batch = parseDraft(rec.draft).batches.find((b) => b.id === batchId)!;
  return batch.meals.reduce((sum, m) => {
    const day = state.plan!.days.find((d) => d.date === addDays(rec.start, m.day - 1))!;
    return sum + (day[m.slot].solved ?? []).filter((l) => l.role === "protein").reduce((s, l) => s + l.grams, 0);
  }, 0);
}

const SET_RAW = `
const pots = data.plan.planner.draft.batches;
pots.find((b) => b.id === "chicken").rawG = 600;
pots.find((b) => b.id === "beef").rawG = 400;
return data;`;

describe("10-31: the pots set to what the reader has", () => {
  test("one edit_data writes the grams, the list and the revision; undo_edit puts them back", async () => {
    const s = setup("2026-10-31", { [MEALS_FILE]: meals1031 });
    const before = await s.state();
    const out = await s.edit("info-meals", SET_RAW, "按手头 600 克鸡胸、400 克牛腱重算");
    expect(out.text).toContain("Written");
    expect(s.cards).toEqual([]);
    const after = await s.state();
    expect(after.plan!.revision).toBe(before.plan!.revision + 1);
    expect(after.plan!.createdAt).toBe(before.plan!.createdAt);
    expect(potGrams(after, "chicken")).toBe(600);
    expect(potGrams(after, "beef")).toBe(400);
    const line = (food: string) => after.shopping.items.find((i) => i.foodId === food);
    expect(line("chicken_breast")?.grams).toBe(600);
    expect(line("beef_shank_raw")?.grams).toBe(400);
    expect(s.log.changed).toBe(1);

    const back = await s.undo("info-meals");
    expect(back.text).toContain("Written");
    const undone = await s.state();
    expect(undone.plan!.days).toEqual(before.plan!.days);
    expect(undone.plan!.planner).toEqual(before.plan!.planner);
    expect(undone.shopping).toEqual(before.shopping);
    expect(undone.plan!.revision).toBe(before.plan!.revision + 2);
  });

  test("writing the solved grams is sent back with the input to change", async () => {
    const s = setup("2026-10-31", { [MEALS_FILE]: meals1031 });
    const before = s.files.get(MEALS_FILE);
    const out = await s.edit(
      "info-meals",
      `const day = data.plan.days.find((d) => d.date === "2026-10-31");
day.lunch.solved.find((l) => l.role === "protein").grams = 200;
return data;`,
      "鸡胸改 200 克",
    );
    expect(out.text).toContain("Nothing was written.");
    expect(out.text).toContain("solved");
    expect(out.text).toContain("computed by the app; change plan.planner.draft (a pot's rawG");
    expect(s.files.get(MEALS_FILE)).toBe(before);
  });
});

describe("11-06: the draft's chicken pot made another way", () => {
  test("a dish of the reader's from the seed one, then the pot switched to it", async () => {
    const s = setup("2026-11-06", { [MEALS_FILE]: meals1031, [MEALS_DRAFT_FILE]: draft1106 });
    const dish = await s.edit(
      "info-meals-dishes",
      `const base = data.seed.salsa_shredded_chicken;
data.dishes.diced_chicken_braise = {
  ...base,
  id: "diced_chicken_braise",
  name: "番茄鸡丁炒锅焖",
  nameEn: "Skillet-braised diced salsa chicken",
  summary: "鸡胸肉切丁，和番茄碎、洋葱、青椒加墨西哥香料在炒锅里焖 15 分钟",
  summaryEn: "Diced chicken breast braised 15 minutes in a skillet with crushed tomato, onion, pepper and taco spice.",
  method: "braise",
  equipment: ["stove"],
  ways: base.ways.map((w) => ({ ...w, name: w.name.replace("手撕鸡", "鸡丁"), nameEn: w.nameEn.replace("Salsa chicken", "Diced salsa chicken") })),
};
return data;`,
      "手撕鸡改成鸡丁炒锅焖，不用压力锅",
    );
    expect(dish.text).toContain("Written");

    const pot = await s.edit(
      "info-meals-draft",
      `data.draft.batches.find((b) => b.id === "chicken").dish = "diced_chicken_braise";
return data;`,
      "鸡肉锅换成鸡丁炒锅焖",
    );
    expect(pot.text).toContain("Written");
    expect(s.cards).toEqual([]);

    const file = parseDraftFile(JSON.parse(s.files.get(MEALS_DRAFT_FILE)!))!;
    expect(file.version).toBe(2);
    expect(file.previous).toEqual(parseDraft(draft1106.draft));
    expect(file.draft.batches.find((b) => b.id === "chicken")?.dish).toBe("diced_chicken_braise");
    expect(file.picks?.batches.find((b) => b.id === "chicken")?.dish).toBe("diced_chicken_braise");
    expect(file.draft.batches.find((b) => b.id === "beef")).toEqual(parseDraft(draft1106.draft).batches.find((b) => b.id === "beef"));
    const state = await s.state();
    const profile = state.charter!.profile;
    const result = checkDraft(file.draft, draftContext(profile, targetsOf(state.charter, "other")!, file.startDate, file.draft.days.length));
    expect(result.plan).not.toBeNull();

    // Saved as the plan, its prep asks for the new pot on the stove and the beef as it was.
    expect((await applyDraftFile(file.draftId, s.ports))?.ok).toBe(true);
    const request = prepStepsRequest(await s.state(), { today: "2026-11-06", region: "other", language: "en" })!;
    const chicken = request.pots.find((p) => p.id === "chicken")!;
    expect(chicken.dish).toBe("diced_chicken_braise");
    expect(chicken.equipment).toEqual(["stove"]);
    expect(chicken.method).toContain("skillet");
    expect(request.pots.find((p) => p.id === "beef")?.dish).toBe("tomato_braised_beef_shank");
  });
});

describe("the tasking worker", () => {
  test("edit_data as runSubagent mounts it lists the three meals kinds", async () => {
    const s = setup("2026-10-31", { [MEALS_FILE]: meals1031 });
    const off = registerMealsWritables({ readText: async (p) => s.files.get(p) ?? null, ports: s.ports, dishIo: guarded(s.files) });
    try {
      expect(registeredWritables().map((e) => e.kind).sort()).toEqual(["info-meals", "info-meals-dishes", "info-meals-draft"]);
      let tools: readonly AgentTool[] = [];
      await runSubagent(
        { definition: buildTaskingAgent({}, () => []), task: "change the pots", edit: { initiator: { runId: "run-1" } } } as never,
        {
          run: async (req: { tools: readonly AgentTool[] }) => {
            tools = req.tools;
            return { kind: "done", text: "done" };
          },
        } as never,
      ).catch(() => {});
      const edit = tools.find((t) => t.name === "edit_data");
      expect(edit).toBeDefined();
      const refused = await Promise.resolve(edit!.execute({ kind: "nope", code: "return 1;", why: "x" })).catch((e: Error) => e.message);
      expect(refused).toContain("info-meals:");
      expect(refused).toContain("info-meals-draft:");
      expect(refused).toContain("info-meals-dishes:");
    } finally {
      off();
    }
  });
});

describe("what the reader and the model are told", () => {
  test("a refused change names its days by date as well as number", async () => {
    const s = setup("2026-10-31", { [MEALS_FILE]: meals1031 });
    const out = await s.edit(
      "info-meals",
      `const d = data.plan.planner.draft;
d.days = d.days.slice(0, 2);
return data;`,
      "only two days",
    );
    expect(out.text).toContain("Nothing was written.");
    expect(out.text).toMatch(/\d{4}-\d{2}-\d{2} \(Day \d\)/);
    expect(out.text).not.toMatch(/(^|[^)] )Day \d/m);
  });
});
