// A prep session's steps (docs/671 菜品图, 时间线与语音): what the model is asked
// for the session's pots, what its answer is held to, and the stored entry.
//
// Written like the recipe page's steps (docs/73 做法页): ahead of time by the
// background sweep (recipe-sweep.ts) on the everyday tier, on the spot when
// the prep page opens first, one call per key, a failure written down as
// nothing. The key is the session's pots, each at its solved grams for the
// people eating, the rice, the kitchen, the burners, the language and the
// prompt version: a change to any of them asks for new steps.
//
// The model writes each step's sentence, device, pot, hands-on and waiting
// minutes and what it waits for. Where the steps go in time is the scheduler's
// (timeline/schedule.ts); the packing step is the program's.

import type { Locale } from "../../../i18n/locale";
import { aiLanguageName } from "../../../platform/app/settings";
import { newTally, type ParseTally } from "../../../platform/app/structured-output";
import { readObject } from "../../../platform/std/json";
import { hashText } from "../../../platform/sync/merge/text";
import type { Equipment } from "../dishes/types";
import { foodById } from "../nutrition/foods";
import type { Region } from "../nutrition/targets";
import { targetsOf } from "../plan/solve-week";
import type { MealsState } from "../plan/types";
import { kitchenOf } from "../planner/library";
import { checkPlannerRecord } from "../planner/to-week";
import { planPrep } from "../screen/batch-cook";
import { kitchenFor, schedule } from "../timeline/schedule";
import { MAX_PREP_STEPS, readPrepSteps, renumber, RICE_POT, type PrepStep } from "../timeline/steps";

// Raised when the prompt changes what the steps may say; every stored session's steps are written again once.
export const PREP_STEPS_PROMPT_VERSION = 2;

export interface PrepStepsRow {
  food: string;
  name: string;
  grams: number;
}

export interface PrepStepsPot {
  /** The batch id the steps name it by. */
  id: string;
  dish: string;
  name: string;
  method: string;
  equipment: Equipment[];
  /** The library's minutes for one pot: a hint for the model, not the timeline's. */
  activeMin: number;
  totalMin: number;
  /** Meals it feeds times the people eating. */
  portions: number;
  /** The whole pot for everyone eating, at its solved grams. */
  rows: PrepStepsRow[];
}

export interface PrepStepsRice {
  name: string;
  food: string;
  foodName: string;
  grams: number;
  portions: number;
}

export interface PrepStepsRequest {
  kind: "prep";
  key: string;
  session: string;
  /** The pots' names, for whoever reads the file. */
  name: string;
  pots: PrepStepsPot[];
  /** The batch of rice cooked at the session, or null. */
  rice: PrepStepsRice | null;
  /** The reader's kitchen: the default one plus what the profile names. */
  devices: Equipment[];
  burners: number;
  language: Locale;
}

/** One session's stored steps (info-meals-recipes.json, beside the recipes). */
export interface PrepStepsEntry {
  kind: "prep";
  at: number;
  name: string;
  session: string;
  /** "1".."n" in the order first planned, without the program's last step. */
  steps: PrepStep[];
}

export function isPrepRequest(request: { key: string }): request is PrepStepsRequest {
  return (request as Partial<PrepStepsRequest>).kind === "prep";
}

export function prepStepsKey(r: Omit<PrepStepsRequest, "key" | "kind" | "session" | "name">): string {
  return hashText(
    JSON.stringify([
      "prep",
      PREP_STEPS_PROMPT_VERSION,
      r.language,
      [...r.devices].sort(),
      r.burners,
      r.pots.map((p) => [p.id, p.dish, p.portions, p.rows.map((x) => `${x.food}:${x.grams}`).sort()]),
      r.rice ? [r.rice.food, r.rice.grams, r.rice.portions] : null,
    ]),
  );
}

/**
 * The request for the stored plan's prep session, or null when the plan has
 * none or its draft no longer solves. Built from the same solve as the prep
 * page (screen/prep-view.ts), so both ask under one key.
 */
export function prepStepsRequest(state: MealsState, opts: { today: string; region: Region; language: Locale }): PrepStepsRequest | null {
  const plan = state.plan;
  const charter = state.charter;
  const targets = targetsOf(charter, opts.region);
  const prep = planPrep(state, opts.today);
  if (!plan?.planner || !charter || !targets || !prep) return null;
  const check = checkPlannerRecord(plan, charter.profile, targets);
  const solved = check?.result.plan;
  const session = check?.draft.sessions.find((s) => s.id === prep.session);
  if (!check || !solved || !session) return null;
  const zh = opts.language === "zh-CN";
  const people = charter.profile.people ?? 1;
  const foodName = (id: string) => {
    const f = foodById(id);
    return f ? (zh ? f.zh : f.en) : id;
  };
  const pots: PrepStepsPot[] = solved.batches
    .filter((b) => b.session === session.id)
    .flatMap((b) => {
      const dish = check.lib.dish(b.dish);
      if (!dish) return [];
      return [
        {
          id: b.id,
          dish: b.dish,
          name: zh ? dish.name : dish.nameEn,
          method: zh ? dish.summary : dish.summaryEn,
          equipment: [...dish.equipment],
          activeMin: dish.activeMin,
          totalMin: dish.totalMin,
          portions: b.meals.length * people,
          rows: b.lines.map((l) => ({ food: l.food, name: foodName(l.food), grams: Math.round(l.grams * people) })),
        },
      ];
    });
  if (!pots.length) return null;
  const r = check.result.storage?.rice;
  const riceDish = r ? check.lib.dish(r.staple) : undefined;
  const rice: PrepStepsRice | null =
    r && r.cookedAt.slot === "prep" && r.cookedAt.day === session.day
      ? { name: riceDish ? (zh ? riceDish.name : riceDish.nameEn) : r.staple, food: r.food, foodName: foodName(r.food), grams: Math.round(r.grams), portions: r.portions }
      : null;
  const body = {
    pots,
    rice,
    devices: [...kitchenOf(charter.profile)].sort(),
    burners: kitchenFor(charter.profile).burners,
    language: opts.language,
  };
  return { kind: "prep", key: prepStepsKey(body), session: session.id, name: pots.map((p) => p.name).join(" + "), ...body };
}

function languageName(language: Locale): string {
  return aiLanguageName(language) ?? "English";
}

/** The system prompt. */
export function prepStepsSystemPrompt(request: Pick<PrepStepsRequest, "language" | "burners">): string {
  const language = languageName(request.language);
  return [
    `Write every step in ${language}.`,
    "",
    "You write the steps of one batch-cooking session: the reader cooks every pot below in one go, alone, with one pair of hands, in their own kitchen. The app lays the steps out on a timeline itself (which step when, what runs side by side), so a step says what is done and how long it takes, never when.",
    "",
    "Each step is an object:",
    '- "id": a short id of your own ("1", "2", …), unique.',
    '- "text": one short sentence, one action. Say the heat or the setting where it matters.',
    '- "device": where it runs: one of the kitchen ids listed, or "counter" for work with no device (cutting, rinsing, mixing).',
    `- "pot": the id of the pot it belongs to, "${RICE_POT}" for the rice, or null for a step that serves several pots.`,
    '- "active": minutes the reader\'s hands are on it.',
    '- "wait": minutes the device then runs or the food sits on its own (simmering, pressure cooking, the rice cooker), 0 if none.',
    '- "after": ids of the steps that must be finished before this one can start; [] if none.',
    "",
    "Rules:",
    '- Split where the hands come free: "seal the pressure cooker and cook on high 25 minutes" is one step, active 2 and wait 25 plus the minutes it takes to come up to pressure. Write a step that is only waiting when the food sits after the device is done (the pressure dropping on its own).',
    `- A step on the stove or the steamer takes one burner; the reader has ${request.burners}. Every other device does one thing at a time. Use only the devices listed.`,
    "- While a device is busy with an earlier pot, a later pot's hands-on work that does not need that device (browning or searing the meat, frying the aromatics, mixing the sauce) goes on the stove or the counter in the meantime, so the pot goes into the device as soon as it is free. Judge whether that work improves the dish and is worth the extra pan to wash; do not add it where it does not.",
    "- Every pot, and the rice when there is one, gets its steps from the raw ingredients to cooked. Do not repeat the grams: the list is on the page.",
    "- The listed seasoning (a dry blend, a jar of sauce) is the flavour, used as it comes. Use only the listed ingredients plus salt, pepper, cooking oil and water.",
    "- Say when something has to be cooked through to be safe to eat (chicken, pork, beans, eggs).",
    "- No clock times, no order of the day, no cooling, packing, boxes or storage: the app adds the last step that packs and puts everything away.",
    `- At most 8 steps a pot and ${MAX_PREP_STEPS} in all.`,
    "",
    `Write every sentence in ${language}. The pot names, methods and ingredient names may be in another language, often Chinese: that is how the plan stores them, not the language to answer in. Translate what you use.`,
    "",
    "Reply with one JSON object and nothing else:",
    `{"steps": [{"id": "1", "text": "…", "device": "counter", "pot": "A", "active": 5, "wait": 0, "after": []}]}`,
  ].join("\n");
}

/** The user message: each pot with its ingredients, the rice, the kitchen. */
export function prepStepsUserText(request: PrepStepsRequest): string {
  const lines = [`Write the steps in ${languageName(request.language)}, whatever language the lines below are in.`, ""];
  for (const p of request.pots) {
    lines.push(
      `Pot "${p.id}": ${p.name}. How: ${p.method}`,
      `Equipment: ${p.equipment.join(", ") || "stove"}. The library's minutes for it: ${p.activeMin} hands-on, ${p.totalMin} in all. It makes ${p.portions} portions.`,
      "Ingredients for the whole pot:",
      ...p.rows.map((r, i) => `${i + 1}. ${r.name} ${r.grams} g`),
      "",
    );
  }
  if (request.rice) {
    const r = request.rice;
    lines.push(`Pot "${RICE_POT}": ${r.name}, ${r.grams} g of ${r.foodName}, ${r.portions} portions, in the rice cooker.`, "");
  }
  lines.push(`Kitchen (device ids): ${request.devices.join(", ")}. Burners on the stove: ${request.burners}.`);
  return lines.join("\n");
}

/**
 * The model's reply as steps, or why it is refused (timeline/steps.ts
 * readPrepSteps). Accepted steps are numbered in the order the scheduler
 * first lays them out, so step 1 is the first thing done.
 */
export function parsePrepStepsReply(
  text: string,
  request: Pick<PrepStepsRequest, "devices" | "burners" | "pots" | "rice">,
  tally?: ParseTally,
): { ok: true; value: PrepStep[] } | { ok: false; error: string } {
  const read = readObject(text);
  if (!read.ok) return read;
  const raw = read.value.steps;
  if (tally) tally.seen += Array.isArray(raw) ? raw.length : 0;
  const pots = new Set([...request.pots.map((p) => p.id), ...(request.rice ? [RICE_POT] : [])]);
  const parsed = readPrepSteps(read.value, { devices: new Set(request.devices), pots });
  if (!parsed.ok) {
    if (tally) tally.fail = Array.isArray(raw) && raw.length ? "empty-result" : "missing-field";
    return parsed;
  }
  if (tally) tally.kept += parsed.value.length;
  const order = schedule(parsed.value, { burners: request.burners }).order;
  return { ok: true, value: renumber(parsed.value, order) };
}

/** What writing one session's steps needs, so it runs without a model in tests. */
export interface PrepStepsDeps {
  call(system: string, user: string): Promise<string>;
  save(key: string, entry: PrepStepsEntry): Promise<PrepStepsEntry>;
  now(): number;
  report?(text: string, tally: ParseTally, error: string | undefined): void;
}

/** One call for a session's steps; a reply that does not hold is a failure and nothing is written. */
export async function writePrepSteps(request: PrepStepsRequest, deps: PrepStepsDeps): Promise<PrepStepsEntry> {
  const text = await deps.call(prepStepsSystemPrompt(request), prepStepsUserText(request));
  const tally = newTally();
  const parsed = parsePrepStepsReply(text, request, tally);
  deps.report?.(text, tally, parsed.ok ? undefined : parsed.error);
  if (!parsed.ok) throw new Error(parsed.error);
  return deps.save(request.key, { kind: "prep", at: deps.now(), name: request.name, session: request.session, steps: parsed.value });
}
