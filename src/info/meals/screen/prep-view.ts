// The prep page (docs/671 备餐页), derived from the stored plan: its draft is
// checked and solved again for the profile as it is now (planner/to-week.ts),
// and the storage plan (planner/storage.ts) is what the containers, the boxes,
// the fridge and the evenings are worded from. Nothing here is stored; the
// one write the page makes is Done (apply.ts markPrepDone).
//
// Built: 1 what is cooked, 2 have ready and the containers, 4 packing, 5 into
// the fridge, 6 breakfast and the evenings, 7 Done. Not built: 3 the timeline
// and the voice (docs/671 时间线与语音).

import { getLocale, t } from "../../../i18n";
import { mealAtSession } from "../planner/prep";
import type { Dish } from "../dishes/types";
import { foodById, type Food } from "../nutrition/foods";
import { mealEnergy, type TemplateItem } from "../nutrition/solve";
import type { Region } from "../nutrition/targets";
import type { IngredientCategory, Meal, MealsState } from "../plan/types";
import { targetsOf } from "../plan/solve-week";
import { addDays } from "../plan/week";
import { PREP_DAY, type MealAt, type PlanDraft } from "../planner/draft";
import type { PlanLibrary } from "../planner/library";
import { buyFor, type PackLine } from "../planner/packs";
import type { PlanLine, SolvedPlan } from "../planner/solve";
import { storageText, timeText, type StorageText } from "../planner/storage";
import { checkPlannerRecord } from "../planner/to-week";
import { packItem } from "../planner/trip";
import { planPrep, prepTimeText, prepTitle } from "./batch-cook";

export interface PrepPotView {
  batch: string;
  name: string;
  /** The dish's one-line summary. */
  method: string;
  /** 「电压力锅 · 动手 15 分 · 共约 40 分」. */
  how: string;
  cuisine: string;
  /** The stored meal its picture is looked up by (the first meal that eats it), or null. */
  meal: Meal | null;
  /** The dish's ingredients, for the cut-out strip when it has no picture. */
  items: TemplateItem[];
  /** The meals that eat it, in order; `now` is the one eaten as it is cooked. */
  meals: { text: string; now: boolean }[];
  /** 「每份 520 kcal · 蛋白 38 g」. */
  portion: string;
}

export interface PrepShopRow {
  key: string;
  name: string;
  en: string;
  category: IngredientCategory;
  /** The pots it goes into. */
  dishes: string;
  /** Packs, pieces or 「on hand」: never grams to weigh (docs/671 给用户看的量). */
  qty: string;
  note: string;
}

export type ShopGroup = "protein" | "veg" | "dry" | "seasoning";

export const SHOP_GROUPS: readonly ShopGroup[] = ["protein", "veg", "dry", "seasoning"];

export interface PrepView {
  session: string;
  date: string;
  title: string;
  minutes: string;
  done: boolean;
  pots: PrepPotView[];
  /** The rice-cooker batch cooked at the session: the narrower card. */
  rice: StorageText["rice"];
  shop: { group: ShopGroup; label: string; rows: PrepShopRow[] }[];
  containers: StorageText["containers"];
  boxes: StorageText["boxes"];
  fridgeLede: string;
  places: StorageText["places"];
  nights: StorageText["nights"];
}

const zh = () => getLocale() === "zh-CN";
const dishName = (d: Dish | undefined, id: string) => (d ? (zh() ? d.name : d.nameEn) : id);

/** The solved lines of a lunch or dinner, the prep day's dinner at day 0. */
function linesAt(plan: SolvedPlan, m: MealAt): PlanLine[] {
  if (m.day === PREP_DAY) return m.slot === "dinner" ? (plan.prepDinner?.lines ?? []) : [];
  return plan.days[m.day - 1]?.meals[m.slot].lines ?? [];
}

/** Which group of the have-ready list a food goes in. */
export function shopGroup(food: Food, role: PlanLine["role"]): ShopGroup {
  if (role === "seasoning" || role === "oil") return "seasoning";
  if (food.category === "produce") return "veg";
  const p = food.proteinCategory;
  if (p === "meat" || p === "poultry" || p === "seafood" || p === "egg") return "protein";
  if (p === "soy" && food.keeps !== "pantry" && !food.boughtDry) return "protein";
  return "dry";
}

const itemRole = (role: PlanLine["role"]): TemplateItem["role"] => (role === "protein" || role === "staple" ? role : "fixed");

function potView(draft: PlanDraft, lib: PlanLibrary, solved: SolvedPlan, state: MealsState, start: string, batchId: string): PrepPotView | null {
  const b = draft.batches.find((x) => x.id === batchId);
  const session = draft.sessions.find((s) => s.id === b?.session);
  if (!b || !session) return null;
  const dish = lib.dish(b.dish);
  const nowSlot = mealAtSession(session.part);
  const meals = [...b.meals].sort((x, y) => x.day - y.day || (x.slot === y.slot ? 0 : x.slot === "lunch" ? -1 : 1));
  const first = meals[0];
  const stored = first ? state.plan?.days.find((d) => d.date === addDays(start, first.day - 1))?.[first.slot] ?? null : null;
  const main = first ? linesAt(solved, first).filter((l) => l.source === "main") : [];
  const n = mealEnergy(main.map((l) => ({ foodId: l.food, grams: l.grams })));
  const equipment = (dish?.equipment ?? []).map((e) => t(`meals.equipment.${e}`)).join(t("meals.listJoin"));
  return {
    batch: b.id,
    name: dishName(dish, b.dish),
    method: dish ? (zh() ? dish.summary : dish.summaryEn) : "",
    how: [equipment, ...(dish ? [prepTimeText({ activeMin: dish.activeMin, totalMin: dish.totalMin })] : [])].filter(Boolean).join(" · "),
    cuisine: dish ? t(`meals.cuisine.${dish.cuisine}`) : "",
    meal: stored && stored.mode === "make" ? stored : null,
    items: (dish?.ingredients ?? []).map((l) => ({ foodId: l.food, role: itemRole(l.role) })),
    meals: meals.map((m) => ({ text: timeText(m), now: m.day === session.day && m.slot === nowSlot })),
    portion: t("meals.prep.portion", { kcal: Math.round(n.kcal), protein: Math.round(n.protein) }),
  };
}

/** Every pot's ingredients at the session, added up per food and grouped; the batch rice with them. */
function shopRows(draft: PlanDraft, lib: PlanLibrary, solved: SolvedPlan, shopping: readonly PackLine[], rice: { food: string; grams: number; staple: string } | null, people: number, start: string) {
  const need = new Map<string, { grams: number; role: PlanLine["role"]; dishes: string[] }>();
  const add = (food: string, grams: number, role: PlanLine["role"], dish: string) => {
    const had = need.get(food) ?? { grams: 0, role, dishes: [] };
    had.grams += grams;
    if (!had.dishes.includes(dish)) had.dishes.push(dish);
    need.set(food, had);
  };
  for (const b of draft.batches) {
    const name = dishName(lib.dish(b.dish), b.dish);
    for (const m of b.meals) for (const l of linesAt(solved, m)) if (l.source === "main") add(l.food, l.grams * people, l.role, name);
  }
  if (rice) add(rice.food, rice.grams, "staple", dishName(lib.dish(rice.staple), rice.staple));
  const groups = new Map<ShopGroup, PrepShopRow[]>();
  for (const [id, n] of need) {
    const food = foodById(id);
    if (!food) continue;
    const bought = shopping.find((l) => l.food === id);
    const line: PackLine = { food: id, grams: n.grams, buy: buyFor(food, n.grams), firstDay: 1, lastDay: 1, freeze: false, frozen: !!bought?.frozen, leftover: null };
    const item = packItem(line, start);
    if (!item) continue;
    const group = shopGroup(food, n.role);
    const row: PrepShopRow = {
      key: id,
      name: item.name,
      en: item.en,
      category: item.category,
      dishes: t("meals.prep.forDishes", { dishes: n.dishes.join(t("meals.listJoin")) }),
      qty: item.qty,
      note: line.frozen ? t("meals.prep.fromFreezer") : "",
    };
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return SHOP_GROUPS.flatMap((group) => {
    const rows = groups.get(group);
    return rows?.length ? [{ group, label: t(`meals.prep.group.${group}`), rows }] : [];
  });
}

/**
 * The prep page for a session of the stored plan, or null when the plan has
 * no prep, its draft no longer solves, or the session is not this plan's (a
 * newer plan replaced it).
 */
export function prepView(state: MealsState, session: string | null, today: string, region: Region): PrepView | null {
  const plan = state.plan;
  const charter = state.charter;
  const targets = targetsOf(charter, region);
  const prep = planPrep(state, today);
  if (!plan?.planner || !charter || !targets || !prep) return null;
  if (session && session !== prep.session) return null;
  const check = checkPlannerRecord(plan, charter.profile, targets);
  const solved = check?.result.plan;
  const storage = check?.result.storage;
  if (!check || !solved || !storage) return null;
  const { draft, lib } = check;
  const start = plan.planner.start;
  const text = storageText(storage, lib);
  const pots = draft.batches.filter((b) => b.session === prep.session).flatMap((b) => potView(draft, lib, solved, state, start, b.id) ?? []);
  return {
    session: prep.session,
    date: prep.date,
    title: prepTitle(prep.date),
    minutes: prepTimeText(prep),
    done: prep.done,
    pots,
    rice: text.rice,
    shop: shopRows(draft, lib, solved, check.result.shopping, storage.rice, charter.profile.people ?? 1, start),
    containers: text.containers,
    boxes: text.boxes,
    fridgeLede: text.fridgeLede,
    places: text.places,
    nights: text.nights,
  };
}
