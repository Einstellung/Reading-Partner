// The program's half of a draft (docs/671 对话). The model picks what takes
// taste: the main at each lunch and dinner (a pot's dish and way, or a fresh
// dish), which mains are pots, the prep session, and a breakfast only when the
// user asked for one. The program fills the rest from the library: breakfasts,
// the staples of fresh mains, sides and fruit.
//
// It fills toward the plan rules (legumes, whole grains, vegetables, fruit,
// sodium, the day's protein and kcal, packs finished) by a best-first search
// over changes (a breakfast, a staple, a side added, dropped or swapped, a pot
// meal's way), each judged by checkDraft, so changes that only pass together
// are found; then it takes back each change the plan passes as well without.
// Same picks, same plan: there is no randomness. A breakfast or staple they
// asked for across the plan (`asked`) stands like one the model wrote per day. A way or staple the model picked changes only
// when that is what fixes a rule, and says so in `changed`. What the fill
// cannot fix goes back naming the picks to change (explain).

import { referenceServing, totals, type Totals } from "../dishes/serving";
import { SEED_DISHES } from "../dishes/seed";
import type { Dish } from "../dishes/types";
import { FOODS, foodById, type Food } from "../nutrition/foods";
import { checkDraft, FRUIT_PORTIONS, type DraftContext, type DraftProblem, type DraftResult } from "./checks";
import { isBatchMain, MAIN_SLOTS, mealName, type DraftMain, type MainSlot, type PlanDraft } from "./draft";
import { planLibrary, type PlanLibrary } from "./library";
import { buyFor, shownName } from "./packs";
import { gramsOf, mainsUsing, readerPortions, sodiumOf, type ReaderPortions } from "./portions";
import { isRiceStaple, planRice, stapleOf } from "./rice";
import { fruitPortionG, growBreakfast, maxMainScale, scaledMain } from "./solve";

export interface FillOutcome {
  /** The check of the filled draft; it passed when `problems` is empty. */
  result: DraftResult;
  /** The model's picks the program changed (a pot meal's way, a fresh main's staple), one line each, for the model to say. */
  changed: string[];
  /** When it did not pass: each problem left, naming the picks to change. */
  unfilled: string[];
}

/** Changes the search puts on top of each other at most. */
const MAX_FILL_DEPTH = 6;
/** Drafts the search judges at most, under a millisecond each: the bound on its time. */
const MAX_JUDGED = 400;
/** Drafts with the same problems left that the search expands. */
const SAME_PROBLEMS_EXPANDED = 2;
/** Sides one lunch or dinner gets at most. */
const MAX_SIDES = 2;
/** Fruit tried first, in this order: whole fruit bought by the piece that keeps. */
const FRUIT_ORDER = ["apple", "banana", "orange", "mandarin", "pear", "kiwi"];

// Scoring: every problem left counts PROBLEM, plus how far it is from passing
// in the rule's unit times its weight (under one PROBLEM); then a little for
// each side to cook, each of the model's picks changed and each breakfast
// eaten twice.
const PROBLEM = 1000;
const OVER_WEIGHT: Partial<Record<DraftProblem["rule"], number>> = {
  sodium: 1,
  leftover: 1,
  vegetables: 1,
  kcal: 1,
  protein: 20,
  whole_grain: 200,
};
const SIDE_COST = 40;
const CHANGE_COST = 150;
const REPEAT_COST = 30;

interface Menu {
  breakfasts: Dish[];
  sides: Dish[];
  mains: Dish[];
  fruit: string[];
}

function menuOf(lib: PlanLibrary): Menu {
  const usable = SEED_DISHES.map((d) => lib.dish(d.id)).filter((d): d is Dish => !!d && d.equipment.every((e) => lib.kitchen.has(e)));
  const fruitOk = (f: Food) =>
    f.roles.includes("fruit") && !lib.foodBlocked(f.id) && !(buyFor(f, fruitPortionG(f)).by === "pack" && (f.keeps === "d1-2" || f.keeps === "d3-5"));
  const ordered = FRUIT_ORDER.map((id) => foodById(id)).filter((f): f is Food => !!f && fruitOk(f));
  return {
    breakfasts: usable.filter((d) => d.role === "breakfast"),
    sides: usable.filter((d) => d.role === "side"),
    mains: usable.filter((d) => d.role === "main"),
    fruit: (ordered.length ? ordered : FOODS.filter(fruitOk)).map((f) => f.id),
  };
}

function clone(d: PlanDraft): PlanDraft {
  return {
    days: d.days.map((x) => ({
      breakfast: x.breakfast,
      lunch: { main: { ...x.lunch.main }, sides: [...x.lunch.sides] },
      dinner: { main: { ...x.dinner.main }, sides: [...x.dinner.sides] },
      fruit: [...x.fruit],
    })),
    batches: d.batches.map((b) => ({ ...b, meals: b.meals.map((m) => ({ ...m })) })),
    sessions: d.sessions.map((s) => ({ ...s })),
    ...(d.asked ? { asked: { ...d.asked } } : {}),
  };
}

/** A searched draft: its check, its score and why each changed pick changed. */
interface Node {
  draft: PlanDraft;
  r: DraftResult;
  s: number;
  reasons: Map<string, string[]>;
  /** Changes on top of the first fill. */
  depth: number;
}

const problemKey = (p: DraftProblem) => `${p.rule}:${p.day ?? ""}:${p.food ?? ""}`;

/** Whether `after` is free of a problem `before` had. */
function clears(before: DraftResult, after: DraftResult): boolean {
  const left = new Set(after.problems.map(problemKey));
  return before.problems.some((p) => !left.has(problemKey(p)));
}

/** What the search can change in a draft, as one string: two drafts alike in it are judged once. */
const shape = (d: PlanDraft) => JSON.stringify(d.days.map((x) => [x.breakfast, x.lunch, x.dinner]));

const key = (day: number, slot: MainSlot) => `${day}:${slot}`;

/** A staple ref (food or staple dish) is whole grain when its food, or its staple dish's staple line, is. */
function wholeGrainStaple(lib: PlanLibrary, ref: string): boolean {
  const food = foodById(ref);
  if (food) return !!food.wholeGrain;
  const line = lib.dish(ref)?.ingredients.find((l) => l.role === "staple");
  return !!(line && foodById(line.food)?.wholeGrain);
}

function stapleUses(lib: PlanLibrary, ref: string | null | undefined, food: string): boolean {
  if (!ref) return false;
  if (ref === food) return true;
  return !!lib.dish(ref)?.ingredients.some((l) => l.food === food);
}

/** A breakfast's totals as grown for a plan day; zero for none. */
type BreakfastTotals = (id: string | undefined, day: number) => Totals;

const wholeGrainBreakfast = (d: Dish | undefined) => !!d?.ingredients.some((l) => l.role === "staple" && foodById(l.food)?.wholeGrain);

const dishUses = (dish: Dish | undefined, food: string) => !!dish?.ingredients.some((l) => l.food === food);

export function fillDraft(picks: PlanDraft, ctx: DraftContext): FillOutcome {
  const lib = ctx.library ?? planLibrary(ctx.profile);
  const context: DraftContext = { ...ctx, library: lib };
  const menu = menuOf(lib);
  // What they asked for across the plan stands for each day or fresh main that has none of its own.
  const asked = picks.asked ?? {};
  const first = clone(picks);
  first.days.forEach((d) => {
    if (!d.breakfast && asked.breakfast) d.breakfast = asked.breakfast;
    for (const slot of MAIN_SLOTS) {
      const m = d[slot].main;
      if (!isBatchMain(m) && !m.staple && asked.staple && lib.dish(m.dish)?.staples.includes(asked.staple)) m.staple = asked.staple;
    }
  });
  const pinned = new Set(first.days.flatMap((d, i) => (d.breakfast ? [i + 1] : [])));
  const pickedWay = new Map<string, { batch: string; way: number }>();
  const pickedStaple = new Map<string, string>();
  first.days.forEach((d, i) => {
    for (const slot of MAIN_SLOTS) {
      const m = d[slot].main;
      if (isBatchMain(m)) pickedWay.set(key(i + 1, slot), { ...m });
      else if (m.staple) pickedStaple.set(key(i + 1, slot), m.staple);
    }
  });
  const reasons = new Map<string, string[]>();

  // --- the first fill ---------------------------------------------------------
  for (const d of first.days) {
    d.lunch.sides = [];
    d.dinner.sides = [];
  }
  // A pot eaten twice the same way: the later meals take the lowest ways not used.
  for (const b of first.batches) {
    const ways = lib.dish(b.dish)?.ways?.length ?? 0;
    const seen = new Set<number>();
    const meals = [...b.meals].sort((x, y) => x.day - y.day || (x.slot === y.slot ? 0 : x.slot === "lunch" ? -1 : 1));
    for (const m of meals) {
      const main = first.days[m.day - 1]?.[m.slot]?.main;
      if (!main || !isBatchMain(main) || main.batch !== b.id) continue;
      if (seen.has(main.way)) {
        const free = Array.from({ length: ways }, (_, i) => i + 1).find((w) => !seen.has(w) && !meals.some((o) => o !== m && wayOf(first, o.day, o.slot) === w));
        if (free) {
          main.way = free;
          reasons.set(key(m.day, m.slot), ["ways_vary"]);
        }
      }
      seen.add(main.way);
    }
  }
  // Fresh mains without a staple, or with one the dish does not take or they cannot have.
  const rice = () => planRice(first, lib);
  first.days.forEach((d, i) => {
    for (const slot of MAIN_SLOTS) {
      const m = d[slot].main;
      if (isBatchMain(m)) continue;
      const dish = lib.dish(m.dish);
      if (!dish) continue;
      const ok = (s: string) => dish.staples.includes(s) && !lib.foodBlocked(s) && (!!foodById(s) || !!lib.dish(s));
      if (!dish.staples.length) {
        delete m.staple;
        continue;
      }
      if (m.staple && ok(m.staple)) continue;
      const plan = rice();
      const choices = dish.staples.filter(ok).filter((s) => !isRiceStaple(lib, s) || !plan || s === plan);
      const pick = choices.find((s) => wholeGrainStaple(lib, s)) ?? choices[0] ?? dish.staples.find(ok);
      if (pick) m.staple = pick;
      if (pickedStaple.has(key(i + 1, slot))) reasons.set(key(i + 1, slot), ["staple"]);
    }
  });
  // Breakfasts: the least salty for each day not pinned, a different one each day.
  const grown = new Map<string, Totals>();
  const bfTotals: BreakfastTotals = (id, day) => {
    const k = `${id}:${day}`;
    let t = grown.get(k);
    if (!t) {
      const b = lib.dish(id ?? "");
      const target = ctx.targets[day - 1];
      t = b && target ? totals(growBreakfast(b.ingredients, target)) : totals([]);
      grown.set(k, t);
    }
    return t;
  };
  const bfSodium = (id: string, day: number) => (lib.dish(id) && ctx.targets[day - 1] ? bfTotals(id, day).sodium : Number.POSITIVE_INFINITY);
  first.days.forEach((d, i) => {
    if (pinned.has(i + 1)) return;
    const taken = new Set(first.days.map((x) => x.breakfast).filter(Boolean));
    const ranked = [...menu.breakfasts].sort((a, b) => bfSodium(a.id, i + 1) - bfSodium(b.id, i + 1));
    d.breakfast = (ranked.find((b) => !taken.has(b.id)) ?? ranked[0])?.id ?? "";
  });

  const withFruit = (d: PlanDraft) => {
    d.days.forEach((day, i) => {
      const own = lib.dish(day.breakfast)?.ingredients.filter((l) => l.role === "fruit").length ?? 0;
      const want = Math.max(0, FRUIT_PORTIONS.min - own);
      const list = menu.fruit;
      day.fruit = list.length ? Array.from({ length: want }, (_, k) => list[(2 * i + k) % list.length] as string) : [];
    });
    return d;
  };

  // The search judges without the storage plan; the last check below makes it.
  const evaluate = (d: PlanDraft) => checkDraft(withFruit(d), context, { storage: false });

  const changes = (d: PlanDraft) => {
    let c = 0;
    d.days.forEach((day, i) => {
      for (const slot of MAIN_SLOTS) {
        const m = day[slot].main;
        const was = pickedWay.get(key(i + 1, slot));
        if (was && isBatchMain(m) && m.way !== was.way) c++;
        const staple = pickedStaple.get(key(i + 1, slot));
        if (staple && !isBatchMain(m) && m.staple !== staple) c++;
      }
    });
    return c;
  };
  const score = (r: DraftResult) => {
    if (!r.plan) return 1e9 + r.problems.length * PROBLEM;
    let s = 0;
    for (const p of r.problems) s += PROBLEM + Math.min(PROBLEM - 1, Math.max(0, (p.over ?? 1) * (OVER_WEIGHT[p.rule] ?? 300)));
    const d = r.draft;
    const sides = d.days.reduce((t, x) => t + x.lunch.sides.length + x.dinner.sides.length, 0);
    const bfs = d.days.map((x) => x.breakfast);
    return s + sides * SIDE_COST + changes(d) * CHANGE_COST + (bfs.length - new Set(bfs).size) * REPEAT_COST;
  };

  // A draft whose structure fails is searched too: one rice per plan is a
  // structure rule the fill can meet by a way or a staple. Any draft that
  // solves scores below one that does not.
  const root = evaluate(first);
  let best: Node = { draft: root.draft, r: root, s: score(root), reasons, depth: 0 };

  // --- the search ---------------------------------------------------------------
  // Best-first: the draft nearest to passing of all judged so far is expanded
  // next, by every change its problems allow, worse children kept in the queue,
  // so changes that only pass together are found and a dead end goes back to
  // the next best draft. Ties go in the order they were judged, so the same
  // picks fill the same way. It stops at the first round that passes, or after
  // MAX_JUDGED drafts.
  const open: Node[] = [best];
  const seen = new Set([shape(first)]);
  const judge = (from: Node, d: PlanDraft, meal?: string): Node => {
    const r = evaluate(d);
    let why = from.reasons;
    if (meal) {
      const fixed = [...new Set(from.r.problems.map((p) => p.rule))].filter((rule) => !r.problems.some((p) => p.rule === rule));
      why = new Map(why).set(meal, fixed.length ? fixed : ["the plan rules"]);
    }
    return { draft: r.draft, r, s: score(r), reasons: why, depth: from.depth + 1 };
  };
  let judged = 0;
  const expanded = new Map<string, number>();
  while (open.length && best.r.problems.length && judged < MAX_JUDGED) {
    const node = open.shift() as Node;
    if (node.depth >= MAX_FILL_DEPTH) continue;
    // Drafts left with the same problems differ in what does not matter to them (another breakfast): a few stand for all.
    const sig = node.r.problems.map(problemKey).sort().join("|");
    const times = expanded.get(sig) ?? 0;
    if (times >= SAME_PROBLEMS_EXPANDED) continue;
    expanded.set(sig, times + 1);
    for (const edit of candidates(node.draft, node.r, lib, menu, pinned, bfTotals)) {
      if (judged >= MAX_JUDGED) break;
      const d = clone(node.draft);
      edit.apply(d);
      const k = shape(d);
      if (seen.has(k)) continue;
      seen.add(k);
      const child = judge(node, d, edit.meal);
      judged++;
      if (child.s < best.s) best = child;
      // A change that neither scores better nor clears one of the problems leads nowhere.
      if (child.s >= node.s && !clears(node.r, child.r)) continue;
      let at = open.length;
      while (at > 0 && (open[at - 1] as Node).s > child.s) at--;
      open.splice(at, 0, child);
    }
  }

  // Polish: a pick the search changed goes back to the model's, and a side
  // goes, whenever the plan scores no worse without the change.
  for (let pass = 0; pass < 2; pass++) {
    let kept = false;
    for (const undo of undos(best.draft, pickedWay, pickedStaple)) {
      const d = clone(best.draft);
      undo.apply(d);
      const child = judge(best, d);
      if (child.s > best.s) continue;
      if (undo.meal) {
        child.reasons = new Map(child.reasons);
        child.reasons.delete(undo.meal);
      }
      best = child;
      kept = true;
    }
    if (!kept) break;
  }
  const state = best.draft;
  const why = new Map(best.reasons);
  reasons.clear();
  for (const [at, w] of why) reasons.set(at, w);

  // The sides and fruit are part of the draft now; a last check gives the notes without the quick sides already in it.
  const result = checkDraft(clone(state), context);
  const changed: string[] = [];
  result.draft.days.forEach((day, i) => {
    for (const slot of MAIN_SLOTS) {
      const at = key(i + 1, slot);
      const m = day[slot].main;
      const why = (reasons.get(at) ?? ["the plan rules"]).join(", ");
      const was = pickedWay.get(at);
      if (was && isBatchMain(m) && m.way !== was.way) {
        const batch = result.draft.batches.find((b) => b.id === m.batch);
        const ways = lib.dish(batch?.dish ?? "")?.ways ?? [];
        changed.push(`${mealName(i + 1, slot)} eats pot ${m.batch} as way ${m.way} (${ways[m.way - 1]?.nameEn ?? ""}) in place of way ${was.way}, for ${why}.`);
      }
      const staple = pickedStaple.get(at);
      if (staple && !isBatchMain(m) && m.staple !== staple) {
        changed.push(`${mealName(i + 1, slot)} has ${m.staple ?? "no staple"} in place of ${staple}, for ${why}.`);
      }
    }
  });
  const unfilled = result.problems.length ? explain(result, lib, menu, ctx) : [];
  return { result, changed, unfilled };
}

function wayOf(d: PlanDraft, day: number, slot: MainSlot): number | null {
  const m = d.days[day - 1]?.[slot]?.main;
  return m && isBatchMain(m) ? m.way : null;
}

// --- the changes tried ------------------------------------------------------------

interface Edit {
  apply(d: PlanDraft): void;
  /** The meal whose pick it changes (a way or a fresh main's staple), for the note. */
  meal?: string;
}

/** Rules the fill works on and the days each problem lets it touch; null for every day. */
function candidates(state: PlanDraft, r: DraftResult, lib: PlanLibrary, menu: Menu, pinned: ReadonlySet<number>, bf: BreakfastTotals): Edit[] {
  const n = state.days.length;
  const all = Array.from({ length: n }, (_, i) => i + 1);
  const out = new Map<string, Edit>();
  const add = (id: string, e: Edit) => {
    if (!out.has(id)) out.set(id, e);
  };

  const breakfasts = (days: number[], keep: (b: Dish, now: Dish | undefined, day: number) => boolean = () => true) => {
    for (const day of days) {
      if (pinned.has(day)) continue;
      const now = lib.dish(state.days[day - 1]?.breakfast ?? "");
      for (const b of menu.breakfasts) {
        if (b.id === now?.id || !keep(b, now, day)) continue;
        add(`bf:${day}:${b.id}`, { apply: (d) => void ((d.days[day - 1] as PlanDraft["days"][number]).breakfast = b.id) });
      }
    }
  };
  const staples = (days: number[], keep: (s: string, now: string | undefined) => boolean = () => true) => {
    for (const day of days) {
      for (const slot of MAIN_SLOTS) {
        const m = state.days[day - 1]?.[slot].main;
        if (!m || isBatchMain(m)) continue;
        const dish = lib.dish(m.dish);
        for (const s of dish?.staples ?? []) {
          if (s === m.staple || lib.foodBlocked(s) || (!foodById(s) && !lib.dish(s)) || !keep(s, m.staple)) continue;
          add(`st:${day}:${slot}:${s}`, { meal: key(day, slot), apply: (d) => void ((d.days[day - 1]?.[slot].main as DraftMain & { staple?: string }).staple = s) });
        }
      }
    }
  };
  const ways = (days: number[], keep: (way: number, dish: Dish, now: number) => boolean = () => true) => {
    for (const day of days) {
      for (const slot of MAIN_SLOTS) {
        const m = state.days[day - 1]?.[slot].main;
        if (!m || !isBatchMain(m)) continue;
        const dish = lib.dish(state.batches.find((b) => b.id === m.batch)?.dish ?? "");
        if (!dish) continue;
        (dish.ways ?? []).forEach((_, i) => {
          const w = i + 1;
          if (w === m.way || !keep(w, dish, m.way)) return;
          add(`way:${day}:${slot}:${w}`, { meal: key(day, slot), apply: (d) => void ((d.days[day - 1]?.[slot].main as { way: number }).way = w) });
        });
      }
    }
  };
  const sides = (days: number[], opts: { add?: (s: Dish) => boolean; drop?: (s: Dish) => boolean; swapTo?: (s: Dish) => boolean }) => {
    for (const day of days) {
      for (const slot of MAIN_SLOTS) {
        const now = state.days[day - 1]?.[slot].sides ?? [];
        const other = state.days[day - 1]?.[slot === "lunch" ? "dinner" : "lunch"].sides ?? [];
        const fresh = (s: Dish) => !now.includes(s.id) && !other.includes(s.id);
        if (opts.add && now.length < MAX_SIDES) {
          for (const s of menu.sides) {
            if (!fresh(s) || !opts.add(s)) continue;
            add(`add:${day}:${slot}:${s.id}`, { apply: (d) => void d.days[day - 1]?.[slot].sides.push(s.id) });
          }
        }
        for (const id of now) {
          const side = lib.dish(id);
          if (!side) continue;
          if (opts.drop?.(side)) add(`drop:${day}:${slot}:${id}`, { apply: (d) => remove(d.days[day - 1]?.[slot].sides, id) });
          if (!opts.swapTo) continue;
          for (const s of menu.sides) {
            if (!fresh(s) || !opts.swapTo(s)) continue;
            add(`swap:${day}:${slot}:${id}:${s.id}`, {
              apply: (d) => {
                const list = d.days[day - 1]?.[slot].sides;
                const at = list?.indexOf(id) ?? -1;
                if (list && at >= 0) list[at] = s.id;
              },
            });
          }
        }
      }
    }
  };

  const any = () => true;
  const pulse = (d: Dish) => d.ingredients.some((l) => ["soy", "legume"].includes(foodById(l.food)?.proteinCategory ?? ""));
  const protein = (d: Dish) => d.ingredients.some((l) => l.role === "protein");
  const shopping = new Map(r.shopping.map((l) => [l.food, l]));

  for (const p of r.problems) {
    const days = p.day ? [p.day] : all;
    switch (p.rule) {
      case "sodium":
        breakfasts(days, (b, now, day) => bf(b.id, day).sodium < bf(now?.id, day).sodium);
        staples(days);
        ways(days);
        sides(days, { drop: any, swapTo: any });
        break;
      case "protein":
      case "kcal":
        breakfasts(days, (b, now, day) => bf(b.id, day)[p.rule === "kcal" ? "kcal" : "protein"] > bf(now?.id, day)[p.rule === "kcal" ? "kcal" : "protein"]);
        staples(days);
        ways(days);
        sides(days, { add: protein, swapTo: protein });
        break;
      case "vegetables":
      case "veg_variety":
        sides(days, { add: any, swapTo: any });
        ways(days);
        break;
      case "legumes": {
        const window = p.day ? all.slice(p.day - 1, p.day - 1 + Math.min(3, n)) : all;
        breakfasts(window, pulse);
        sides(window, { add: pulse, swapTo: pulse });
        staples(window);
        break;
      }
      case "one_rice":
        staples(all);
        ways(all);
        break;
      case "whole_grain":
        breakfasts(all, (b, now) => wholeGrainBreakfast(b) && !wholeGrainBreakfast(now));
        staples(all, (s) => wholeGrainStaple(lib, s));
        ways(all, (w, dish) => !!dish.ways?.[w - 1]?.staple && wholeGrainStaple(lib, dish.ways[w - 1]?.staple as string));
        break;
      case "protein_variety":
        breakfasts(all);
        sides(all, { add: protein, swapTo: protein });
        break;
      case "leftover": {
        const food = p.food ?? "";
        const line = shopping.get(food);
        const until = line?.leftover ? Math.min(n, line.leftover.spoilsDay - 1) : n;
        const open = all.filter((d) => d <= until);
        const uses = (d: Dish | undefined) => dishUses(d, food);
        breakfasts(all, (b, now) => uses(b) !== uses(now));
        staples(all, (s, now) => stapleUses(lib, s, food) !== stapleUses(lib, now, food));
        ways(all, (w, dish, now) => {
          const at = (x: number) => dish.ways?.[x - 1];
          const has = (x: number) => !!at(x)?.addOns.some((l) => l.food === food) || stapleUses(lib, at(x)?.staple, food);
          return has(w) !== has(now);
        });
        sides(open, { add: uses, drop: uses, swapTo: uses });
        sides(all, { drop: uses, swapTo: (s) => !uses(s) });
        break;
      }
      default:
        break;
    }
  }
  return [...out.values()];
}

/** The search's changes taken back one at a time: a way or staple back to the model's pick, a side dropped. */
function undos(state: PlanDraft, pickedWay: ReadonlyMap<string, { way: number }>, pickedStaple: ReadonlyMap<string, string>): Edit[] {
  const out: Edit[] = [];
  const drops: Edit[] = [];
  state.days.forEach((day, i) => {
    for (const slot of MAIN_SLOTS) {
      const at = key(i + 1, slot);
      const m = day[slot].main;
      const way = pickedWay.get(at)?.way;
      if (way !== undefined && isBatchMain(m) && m.way !== way) {
        out.push({ meal: at, apply: (d) => void ((d.days[i]?.[slot].main as { way: number }).way = way) });
      }
      const staple = pickedStaple.get(at);
      if (staple && !isBatchMain(m) && m.staple !== staple) {
        out.push({ meal: at, apply: (d) => void ((d.days[i]?.[slot].main as { staple?: string }).staple = staple) });
      }
      for (const id of day[slot].sides) drops.push({ apply: (d) => remove(d.days[i]?.[slot].sides, id) });
    }
  });
  return [...out, ...drops];
}

function remove(list: string[] | undefined, id: string) {
  if (!list) return;
  const at = list.indexOf(id);
  if (at >= 0) list.splice(at, 1);
}

// --- what is left -----------------------------------------------------------------

const NAMED = 6;

/** Each problem the fill could not fix, with the model's picks that drive it and mains that would not. */
function explain(r: DraftResult, lib: PlanLibrary, menu: Menu, ctx: DraftContext): string[] {
  const plan = r.plan;
  if (!plan) return r.problems.map((p) => p.message);
  const draft = r.draft;
  const target = ctx.targets[0];
  const portions: ReaderPortions | null = target ? readerPortions(lib, menu.mains, target) : null;
  const inPlan = new Set<string>();
  draft.days.forEach((d) => {
    for (const slot of MAIN_SLOTS) {
      const m = d[slot].main;
      inPlan.add(isBatchMain(m) ? (draft.batches.find((b) => b.id === m.batch)?.dish ?? "") : m.dish);
    }
  });
  const others = menu.mains.filter((d) => !inPlan.has(d.id));

  /** "Day 2 lunch beef_pot_roast (pot A, way 1)". */
  const pickName = (day: number, slot: MainSlot) => {
    const m = draft.days[day - 1]?.[slot].main;
    if (!m) return mealName(day, slot);
    if (isBatchMain(m)) {
      const dish = draft.batches.find((b) => b.id === m.batch)?.dish ?? "";
      return `${mealName(day, slot)} ${dish} (pot ${m.batch}, way ${m.way})`;
    }
    return `${mealName(day, slot)} ${m.dish}`;
  };
  const mainLinesAt = (day: number, slot: MainSlot) =>
    (plan.days[day - 1]?.meals[slot].lines ?? []).filter((l) => l.source === "main" || l.source === "addOn");
  const mainsOf = (day: number) => MAIN_SLOTS.map((slot) => ({ slot, lines: mainLinesAt(day, slot) }));
  const list = (xs: string[]) => xs.slice(0, NAMED).join(", ");

  return r.problems.map((p) => {
    switch (p.rule) {
      case "sodium": {
        const day = p.day ?? 1;
        const at = plan.days[day - 1];
        const bf = `breakfast ${draft.days[day - 1]?.breakfast} ${sodiumOf(at?.meals.breakfast.lines ?? [])} mg`;
        const meals = MAIN_SLOTS.map((slot) => {
          const lines = at?.meals[slot].lines ?? [];
          const main = sodiumOf(lines.filter((l) => l.source === "main" || l.source === "addOn"));
          const staple = stapleOf(draft, lib, day, slot);
          const st = sodiumOf(lines.filter((l) => l.source === "staple"));
          const sides = sodiumOf(lines.filter((l) => l.source === "side"));
          return `${pickName(day, slot)} ${main} mg${staple ? `, its staple ${staple} ${st} mg` : ""}${sides ? `, sides ${sides} mg` : ""}`;
        });
        const low = portions
          ? others.map((d) => ({ d, na: sodiumOf(portions.main(d)) })).sort((a, b) => a.na - b.na).map((x) => `${x.d.id} ${x.na} mg`)
          : [];
        return `${p.message} With the breakfast, staples and sides the program found: ${bf}; ${meals.join("; ")}. Change one of that day's picks: a way with a staple other than bread or noodles, or a main with less salt (a meal's main before its staple: ${list(low)}).`;
      }
      case "leftover": {
        const food = p.food ?? "";
        const f = foodById(food);
        const line = r.shopping.find((l) => l.food === food);
        const uses: string[] = [];
        plan.days.forEach((d) => {
          for (const slot of MAIN_SLOTS) {
            const g = gramsOf(d.meals[slot].lines.filter((l) => l.source === "main" || l.source === "addOn" || l.source === "staple"), food);
            if (g > 0) uses.push(`${pickName(d.day, slot)} ${Math.round(g)} g`);
          }
        });
        const pack = line?.buy.by === "pack" ? `${line.buy.count} × ${line.buy.packG} g` : "";
        const takers = portions ? mainsUsing(portions, others, food, lib).map((t) => `${t.id} ${t.grams}`) : [];
        const name = f ? `${shownName(f)} (${food})` : food;
        return `${name}: bought as ${pack}, ${Math.round(p.over ?? 0)} g left that no breakfast, staple or side the program can add uses up${uses.length ? `; the picks using it: ${uses.join(", ")}` : ""}. Change those picks${takers.length ? `, or pick another main that uses the rest (a meal's share: ${list(takers)})` : ""}.`;
      }
      case "whole_grain": {
        const refined: string[] = [];
        draft.days.forEach((d, i) => {
          for (const slot of MAIN_SLOTS) {
            const m = d[slot].main;
            const staple = isBatchMain(m)
              ? lib.dish(draft.batches.find((b) => b.id === m.batch)?.dish ?? "")?.ways?.[m.way - 1]?.staple
              : (m.staple ?? lib.dish(m.dish)?.ingredients.find((l) => l.role === "staple")?.food);
            if (staple && !wholeGrainStaple(lib, staple)) refined.push(`${pickName(i + 1, slot)} (${staple})`);
          }
        });
        const whole = others
          .filter((d) => d.staples.some((s) => wholeGrainStaple(lib, s)) || d.ways?.some((w) => w.staple && wholeGrainStaple(lib, w.staple)))
          .map((d) => d.id);
        return `${p.message} The program chose whole-grain breakfasts and staples wherever the picks allow; these picks come only with a refined staple: ${refined.join(", ") || "none"}. Change one of them to a main with a whole-grain staple (${list(whole)}).`;
      }
      case "kcal": {
        const day = p.day ?? 1;
        const by = MAIN_SLOTS.map((slot) => {
          const lines = (plan.days[day - 1]?.meals[slot].lines ?? []).filter((l) => l.source === "main" || l.source === "addOn" || l.source === "staple");
          const staple = lines.some((l) => l.source === "staple") ? " with its staple" : ", no staple";
          return `${pickName(day, slot)} ${Math.round(totals(lines).kcal)} kcal${staple}`;
        });
        const fuller = portions
          ? others.map((d) => ({ d, kcal: totals(portions.main(d)).kcal })).sort((a, b) => b.kcal - a.kcal).map((x) => `${x.d.id} ${Math.round(x.kcal)} kcal`)
          : [];
        return `${p.message.split(";")[0]}, after the breakfast, staples, sides and snack the program could add. The meals: ${by.join(", ")}. Change one of them to a way with a staple or a fuller main (a meal's main before its staple: ${list(fuller)}).`;
      }
      case "protein": {
        const day = p.day ?? 1;
        const by = mainsOf(day).map((m) => `${pickName(day, m.slot)} ${Math.round(totals(m.lines).protein)} g protein`);
        const strong = others
          .map((d) => {
            const ref = referenceServing(d);
            return { d, protein: ref ? totals(scaledMain(ref.ingredients, maxMainScale(d))).protein : 0 };
          })
          .sort((a, b) => b.protein - a.protein)
          .map((x) => x.d.id);
        return `${p.message} The mains are at their largest portions: ${by.join(", ")}. Change one of them to a main with more protein (${list(strong)}).`;
      }
      case "vegetables":
      case "veg_variety": {
        const veggy = others
          .map((d) => ({ d, g: d.ingredients.filter((l) => l.role === "veg").reduce((s, l) => s + l.grams, 0) }))
          .sort((a, b) => b.g - a.g)
          .map((x) => x.d.id);
        return `${p.message} That is with sides added; change a main to one with more vegetables (${list(veggy)}).`;
      }
      case "legumes": {
        const soy = others.filter((d) => d.ingredients.some((l) => ["soy", "legume"].includes(foodById(l.food)?.proteinCategory ?? ""))).map((d) => d.id);
        return `${p.message} No breakfast or side they can have brings them in; pick a bean or tofu main (${list(soy)}).`;
      }
      default:
        return p.message;
    }
  });
}

