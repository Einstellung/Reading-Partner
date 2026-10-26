// What the draft card draws (docs/671 对话), in the reader's language: the
// head, the pot legend, each day's rows with the prep session in its slot and
// the night-before reminders, and the short form once applied. Everything
// comes from the card's payload, which the program wrote; this only words it.
// No grams and no controls besides 「就这样」 and the two links.

import { formatDateTime, getLocale, t } from "../../i18n";
import type { DraftCardDay, DraftCardMeal, DraftCardNight, DraftCardPrepDay, MealsDraftCardData, Named } from "./cards";
import { addDays } from "./plan/week";
import { timeText } from "./planner/storage";

/** A library name in the reader's language: the Chinese one in Chinese, the English one elsewhere. */
export const pickName = (n: Named): string => (getLocale() === "zh-CN" ? n.zh : n.en);

/** A pot chip: its letter, its full label (「锅 A」) and which colour it takes, by its place in the legend. */
export interface PotChip {
  letter: string;
  label: string;
  tone: number;
}

export interface DraftTag {
  text: string;
  changed: boolean;
}

export type DraftRow =
  | { kind: "plain"; key: string; label: string; text: string; changed: boolean }
  | {
      kind: "meal";
      key: string;
      label: string;
      pot: PotChip | null;
      name: string;
      tags: DraftTag[];
      /** The staple and sides; `indent` lines them up under the name beside a chip. */
      subs: { text: string; indent: boolean }[];
      changed: boolean;
    }
  | {
      kind: "prep";
      key: string;
      label: string;
      lead: string;
      pots: PotChip[];
      /** 「糙米饭 一锅」 after the pots when the plan's rice is cooked at this session, else null. */
      rice: string | null;
      time: string;
    }
  | { kind: "night"; key: string; label: string; lines: string[] };

export interface DraftDayView {
  key: string;
  title: string;
  weekday: string;
  rows: DraftRow[];
}

export interface DraftCardView {
  kicker: string;
  /** 「第 N 版」 after a revision, else null. */
  version: string | null;
  title: string;
  note: string;
  pots: { chip: PotChip; name: string; how: string; meals: string }[];
  days: DraftDayView[];
  /** The row labels need the wide column: Chinese labels are one or two characters, every other language spells them out. */
  wideLabels: boolean;
  confirm: string;
  hint: string;
}

export interface DraftAppliedView {
  title: string;
  meta: string;
  openPlan: string;
  openShopping: string;
}

function shortWeekday(date: string): string {
  return formatDateTime(new Date(`${date}T00:00:00Z`), { weekday: "short", timeZone: "UTC" });
}

const list = (names: readonly string[]) => names.join(t("meals.listJoin"));

/** One night-before reminder, worded as the storage plan words it (storage.ts storageText). */
export function nightLine(n: DraftCardNight): string {
  if (n.kind === "soyMilk") return t("meals.store.night.soyMilk", { foods: list(n.foods), meal: timeText(n.meal) });
  return t(n.fromFrozen ? "meals.store.night.thawFish" : "meals.store.night.thaw", { food: n.food, meal: timeText(n.meal) });
}

function head(card: MealsDraftCardData): string {
  const first = card.days[0]?.date ?? card.startDate;
  const last = card.days[card.days.length - 1]?.date ?? first;
  const range = first === last ? shortWeekday(first) : t("meals.draft.range", { from: shortWeekday(first), to: shortWeekday(last) });
  return [range, t("meals.draft.days", { count: card.days.length }), ...(card.pots.length ? [t("meals.draft.pots", { count: card.pots.length })] : [])].join(" · ");
}

/** 「周日下午备餐」, or empty when the plan cooks nothing ahead. */
export function prepWhen(card: MealsDraftCardData): string {
  const s = card.session;
  if (!s) return "";
  return t("meals.draft.prepWhen", { weekday: shortWeekday(addDays(card.startDate, s.day - 1)), part: t(`meals.draft.part.${s.part}`) });
}

export function draftCardView(card: MealsDraftCardData): DraftCardView {
  const tone = new Map(card.pots.map((p, i) => [p.letter, i]));
  const chip = (letter: string): PotChip => ({ letter, label: t("meals.draft.pot", { letter }), tone: tone.get(letter) ?? 0 });

  const mealRow = (key: string, label: string, m: DraftCardMeal): DraftRow => {
    const tags: DraftTag[] = [
      ...(m.now ? [{ text: t("meals.draft.now"), changed: false }] : []),
      ...(m.pot === null ? [{ text: t("meals.draft.fresh"), changed: false }] : []),
      ...(m.changed ? [{ text: t("meals.draft.changed"), changed: true }] : []),
    ];
    const subs = [
      ...(m.staple ? [{ text: t("meals.draft.with", { staple: pickName(m.staple) }), indent: false }] : []),
      ...m.sides.map((s) => ({ text: t("meals.draft.side", { side: pickName(s) }), indent: m.pot !== null })),
    ];
    return { kind: "meal", key, label, pot: m.pot ? chip(m.pot) : null, name: pickName(m.name), tags, subs, changed: m.changed };
  };

  const prepRow = (): DraftRow | null => {
    const s = card.session;
    if (!s) return null;
    return {
      kind: "prep",
      key: "prep",
      label: t("meals.draft.row.prep"),
      lead: t("meals.draft.prepAt", { part: t(`meals.draft.part.${s.part}`) }),
      pots: s.pots.map(chip),
      rice: s.rice ? t("meals.draft.prepRice", { rice: pickName(s.rice) }) : null,
      time: t("meals.draft.prepTime", { active: s.activeMin, total: s.totalMin }),
    };
  };
  const nightRows = (nights: readonly DraftCardNight[]): DraftRow[] =>
    nights.length ? [{ kind: "night", key: "night", label: t("meals.draft.row.night"), lines: nights.map(nightLine) }] : [];

  const dayRows = (d: DraftCardDay): DraftRow[] => {
    const rows: DraftRow[] = [
      { kind: "plain", key: "breakfast", label: t("meals.draft.row.breakfast"), text: pickName(d.breakfast), changed: d.breakfastChanged },
      mealRow("lunch", t("meals.draft.row.lunch"), d.lunch),
      mealRow("dinner", t("meals.draft.row.dinner"), d.dinner),
    ];
    const s = card.session;
    const prep = prepRow();
    // Morning cooks before lunch, afternoon before dinner, evening after it.
    if (s && prep && s.day === d.day) rows.splice(s.part === "morning" ? 1 : s.part === "afternoon" ? 2 : 3, 0, prep);
    if (d.fruit.length) rows.push({ kind: "plain", key: "fruit", label: t("meals.draft.row.fruit"), text: d.fruit.join(" · "), changed: false });
    return [...rows, ...nightRows(d.nights)];
  };

  // The day before day 1: the session, the dinner eaten from it when there is one, and that night's reminders.
  const prepDayView = (p: DraftCardPrepDay): DraftDayView => {
    const prep = prepRow();
    const prepRows = prep ? [prep] : [];
    const dinner = p.dinner ? [mealRow("dinner", t("meals.draft.row.dinner"), p.dinner)] : [];
    const rows = card.session?.part === "evening" ? [...dinner, ...prepRows] : [...prepRows, ...dinner];
    return { key: "0", title: t("meals.draft.prepDay"), weekday: shortWeekday(p.date), rows: [...rows, ...nightRows(p.nights)] };
  };

  return {
    kicker: t("meals.draft.kicker"),
    version: card.version > 1 ? t("meals.draft.version", { count: card.version }) : null,
    title: head(card),
    note: t("meals.draft.note"),
    pots: card.pots.map((p) => ({
      chip: chip(p.letter),
      name: pickName(p.name),
      how: `${t(`meals.equipment.${p.equipment}`)} · ${t(`meals.cuisine.${p.cuisine}`)}`,
      meals: t("meals.draft.potMeals", { count: p.meals }),
    })),
    days: [
      ...(card.prepDay ? [prepDayView(card.prepDay)] : []),
      ...card.days.map((d) => ({
        key: String(d.day),
        title: t("meals.draft.day", { day: d.day }),
        weekday: shortWeekday(d.date),
        rows: dayRows(d),
      })),
    ],
    wideLabels: getLocale() !== "zh-CN",
    confirm: t("meals.draft.confirm"),
    hint: t("meals.draft.hint"),
  };
}

export function draftAppliedView(card: MealsDraftCardData): DraftAppliedView {
  const when = prepWhen(card);
  const meta = [
    t("meals.draft.days", { count: card.days.length }),
    ...(card.pots.length ? [t("meals.draft.pots", { count: card.pots.length })] : []),
    ...(when ? [when] : []),
  ].join(" · ");
  return { title: t("meals.draft.applied"), meta, openPlan: t("meals.draft.openPlan"), openShopping: t("meals.draft.openShopping") };
}
