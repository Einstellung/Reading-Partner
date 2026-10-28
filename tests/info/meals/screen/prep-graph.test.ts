// The prep timeline as a commit graph (screen/prep-graph.ts): rails per pot,
// commits for hands-on steps, waiting-only steps hung under them, merges, the
// hands moving between pots, the free stretches, and the 「现在」 card, on a real
// session's steps (prep-graph-fixture.ts) and on the chili pot.
// Run: scripts/t.sh tests/info/meals/screen/prep-graph.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import {
  nodeSize,
  posCss,
  potNames,
  prepGraph,
  toneVar,
  type CommitRow,
  type GapRow,
  type GraphView,
} from "../../../../src/info/meals/screen/prep-graph";
import { clockText } from "../../../../src/info/meals/screen/prep-timeline";
import { timelineView } from "../../../../src/info/meals/timeline/view";
import { onPlan, POTS_KITCHEN, POTS_NAMES, POTS_STEPS, POTS_T0, potsAt } from "./prep-graph-fixture";
import { at, CHILI_STEPS, runOnStep2, T0 } from "./prep-timeline-fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});
afterEach(() => setLocale(before));

const potsView = (minute: number | null) =>
  timelineView({
    steps: POTS_STEPS,
    kitchen: POTS_KITCHEN,
    boxes: true,
    run: minute === null ? null : onPlan(minute),
    now: minute === null ? POTS_T0 : potsAt(minute),
  });
const planned = () => prepGraph(potsView(null), "before", POTS_NAMES);
const runningAt = (minute: number) => prepGraph(potsView(minute), "running", POTS_NAMES);

const commits = (g: GraphView) => g.rows.filter((r): r is CommitRow => r.kind === "commit");
const gaps = (g: GraphView) => g.rows.filter((r): r is GapRow => r.kind === "gap");
const commit = (g: GraphView, id: string) => commits(g).find((c) => c.id === id)!;
const railX = (g: GraphView, pot: string) => g.rails.find((r) => r.pot === pot)!.x;

test("the real session: one rail per pot in the order the hands first touch them, a commit per hands-on step", () => {
  const g = planned();
  expect(g.rails.map((r) => r.short)).toEqual(["鸡", "牛", "饭"]);
  expect(g.rails.map((r) => r.tone)).toEqual([0, 1, 2]);
  expect(g.labelsFit).toBe(true);
  const own = commits(g).filter((c) => c.id !== "pack");
  // The two steps of letting the pressure out are not numbered.
  expect(own).toHaveLength(15);
  expect(own.map((c) => c.id)).not.toContain("7");
  expect(own.map((c) => c.id)).not.toContain("15");
  expect(commits(g).map((c) => c.n)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  const last = commits(g)[commits(g).length - 1]!;
  expect([last.id, last.n]).toEqual(["pack", 16]);
});

test("a waiting-only step hangs under the commit before it: step 3 runs to minute 26, then the pressure comes down to 41", () => {
  const three = commit(planned(), "3");
  expect(three.waits.map((w) => [w.id, w.until, w.text === null])).toEqual([
    ["3", 26, true],
    ["7", 41, false],
  ]);
  expect(three.waits[0]!.line).toBe("后台：电压力锅 20 分，到第 26 分");
  expect(three.waits[1]!.line).toBe("接着：等 15 分，到第 41 分");
  expect(three.waits[1]!.text).toContain("泄压");
  expect(three.meta).toBe("第 5 分 · 电压力锅 · 动手 1 分 · 等 20 分");
});

test("washing the pot has no pot of its own: drawn on the beef rail, a ring, the chicken rail merging into it", () => {
  const g = planned();
  const wash = commit(g, "11");
  expect(wash.x).toBe(railX(g, "beef"));
  expect(wash.hollow).toBe(true);
  expect(wash.merges.map((m) => m.x)).toEqual([railX(g, "chicken")]);
  expect(wash.meta).toContain("汇入 鸡 → 牛");
  expect(wash.handsTo).toBe("牛");
  expect(wash.handsArrow).toMatchObject({ x1: railX(g, "chicken") });
  // Above the node the beef rail has been waiting for the pot since minute 10.
  expect(wash.lines.find((l) => l.x === wash.x && l.to.f === 0)!.kind).toBe("idle");
});

test("the hands move between pots: a chip on the commit that takes them to another rail, none while they stay", () => {
  const g = planned();
  expect(commits(g).flatMap((c) => (c.handsTo ? [[c.id, c.handsTo]] : []))).toEqual([
    ["4", "牛"],
    ["5", "饭"],
    ["8", "鸡"],
    ["11", "牛"],
  ]);
});

test("free hands are rows of their own: 14 to 41 and 56 to 121, with what is running and when to come back", () => {
  const g = planned();
  expect(gaps(g).map((r) => [r.t0, r.t1])).toEqual([
    [14, 41],
    [56, 121],
    [123, 135],
  ]);
  const covers = (a: number, b: number) => gaps(g).some((r) => r.t0 <= a && r.t1 >= b);
  expect(covers(14, 26)).toBe(true);
  expect(covers(56, 106)).toBe(true);
  const first = gaps(g)[0]!;
  expect(first.head).toBe("手空 27 分，可以走开");
  expect(first.ready.map((r) => r.text)).toEqual(["鸡 第 41 分好", "饭 第 74 分好"]);
  expect(first.back).toBe("第 41 分回来做第 7 步（鸡）");
  expect(first.minHeight).toBe(81);
  expect(gaps(g)[1]!.minHeight).toBe(195);
});

test("after step 14 the beef pot runs on its own to minute 106, then lets its pressure out, the rice done at 74", () => {
  const g = planned();
  const fourteen = commit(g, "14");
  expect(fourteen.x).toBe(railX(g, "beef"));
  expect(fourteen.waits.map((w) => w.until)).toEqual([106, 121]);
  const gap = gaps(g)[1]!;
  const beef = gap.lines.filter((l) => l.x === railX(g, "beef"));
  expect(beef.map((l) => l.kind)).toEqual(["bg", "bg"]);
  expect(beef[0]!.to.f).toBeCloseTo((106 - 56) / 65, 5);
  expect(gap.marks.map((m) => [m.kind, m.x])).toEqual([
    ["tick", railX(g, "beef")],
    ["cap", railX(g, "rice")],
  ]);
});

test("a pot's last step says it is done; the packing step merges every other rail into the last one", () => {
  const g = planned();
  expect(commits(g).flatMap((c) => (c.potDone ? [[c.id, c.potDone]] : []))).toEqual([
    ["6", "糙米饭完成"],
    ["10", "墨西哥番茄手撕鸡完成"],
    ["17", "干香料炖牛肉（rendang 风味）完成"],
  ]);
  const pack = commit(g, "pack");
  expect(pack.x).toBe(railX(g, "beef"));
  expect(pack.merges.map((m) => m.x)).toEqual([railX(g, "chicken"), railX(g, "rice")]);
  expect(pack.meta).toContain("汇入 鸡、饭 → 牛");
  expect(pack.marks.map((m) => [m.kind, m.x, m.at.f])).toEqual([["cap", railX(g, "beef"), 1]]);
});

test("bigger dots for longer hands, held to a size that fits between rails", () => {
  expect(nodeSize(1)).toBe(10.5);
  expect(nodeSize(4)).toBe(18);
  expect(nodeSize(10)).toBe(18);
  expect(commit(planned(), "12").size).toBeGreaterThan(commit(planned(), "13").size);
});

test("before the start nothing is current, past or tappable, and there is no card", () => {
  const g = planned();
  expect(g.now).toBeNull();
  expect(g.rows.every((r) => !r.current && !r.past)).toBe(true);
  expect(commits(g).every((c) => c.actions.length === 0 && c.waits.every((w) => w.actions.length === 0))).toBe(true);
});

test("minute 8: cutting the beef, the chicken under pressure in the background, the rice to come", () => {
  const g = runningAt(8);
  const current = commits(g).filter((c) => c.current);
  expect(current.map((c) => c.id)).toEqual(["4"]);
  expect(current[0]!.actions).toEqual(["done", "late"]);
  expect(current[0]!.meta).toBe(`${clockText(POTS_T0 + 6 * 60_000)} – ${clockText(POTS_T0 + 10 * 60_000)} · 案台`);
  // Step 3 waits under pressure: its Done and Running late are on its commit.
  expect(commit(g, "3").actions).toEqual(["done", "late"]);
  expect(commit(g, "3").waits[0]!.line).toBe(`后台：电压力锅 20 分，到 ${clockText(POTS_T0 + 26 * 60_000)}`);
  expect(commit(g, "1").past).toBe(true);
  const card = g.now!;
  expect(card.minute).toBe(`第 8 分 · ${clockText(POTS_T0 + 8 * 60_000)}`);
  expect(card.hands).toMatchObject({ n: 4, left: "还剩 2 分" });
  expect(card.background.map((b) => [b.short, b.text, b.quiet])).toEqual([
    ["鸡", "电压力锅还剩 18 分", false],
    ["饭", `${clockText(POTS_T0 + 10 * 60_000)}开始`, true],
  ]);
  expect(card.next).toMatchObject({ n: 5, when: "接着" });
});

test("minute 30: hands free, the chicken letting its pressure out with Done and Running late on the hung step", () => {
  const g = runningAt(30);
  expect(commits(g).some((c) => c.current)).toBe(false);
  const gap = gaps(g).find((r) => r.current)!;
  expect([gap.t0, gap.t1]).toEqual([14, 41]);
  const release = commit(g, "3").waits.find((w) => w.id === "7")!;
  expect(release.state).toBe("waiting");
  expect(release.actions).toEqual(["done", "late"]);
  const card = g.now!;
  expect(card.hands).toEqual({ n: null, tone: null, text: "手空，可以走开", left: null });
  expect(card.background.map((b) => [b.short, b.text])).toEqual([
    ["鸡", "电压力锅还剩 11 分"],
    ["牛", `停着，${clockText(POTS_T0 + 46 * 60_000)}接着做`],
    ["饭", "电饭煲还剩 44 分"],
  ]);
  expect(card.next).toMatchObject({ n: 7, when: "11 分后" });
});

test("minute 70: the beef under pressure, the chicken done, the next hands at minute 121", () => {
  const g = runningAt(70);
  expect(gaps(g).find((r) => r.current)!.t0).toBe(56);
  expect(commits(g).filter((c) => c.n <= 13).every((c) => c.past || c.waits.some((w) => w.state !== "done"))).toBe(true);
  const card = g.now!;
  expect(card.background.map((b) => [b.short, b.text])).toEqual([
    ["鸡", "好了"],
    ["牛", "电压力锅还剩 36 分"],
    ["饭", "电饭煲还剩 4 分"],
  ]);
  expect(card.next).toMatchObject({ n: 14, when: "51 分后" });
});

test("once over every row is past and nothing can be tapped", () => {
  const g = prepGraph(potsView(70), "finished", POTS_NAMES);
  expect(g.now).toBeNull();
  expect(g.rows.every((r) => r.past && !r.current)).toBe(true);
  expect(commits(g).every((c) => c.actions.length === 0 && c.state === "done" && c.waits.every((w) => w.actions.length === 0))).toBe(true);
});

test("the chili pot in English: one rail plus the wash-up's own, minutes before the start and the card's words", () => {
  setLocale("en");
  const names = [{ id: "chili", name: "Chili", short: "Chicken" }];
  const plan = prepGraph(timelineView({ steps: CHILI_STEPS, kitchen: { burners: 2 }, boxes: true, run: null, now: T0 }), "before", names);
  expect(plan.labelsFit).toBe(false);
  expect(plan.rails.map((r) => [r.pot, r.tone])).toEqual([
    ["chili", 0],
    [null, null],
  ]);
  expect(commits(plan).find((c) => c.id === "3")!.meta).toBe("min 20 · Stove · 5 min hands-on · wait 30 min");
  const v = timelineView({ steps: CHILI_STEPS, kitchen: { burners: 2 }, boxes: true, run: runOnStep2(), now: at(15) });
  const g = prepGraph(v, "running", names);
  expect(commits(g).find((c) => c.current)!.id).toBe("2");
  expect(g.now!.hands.left).toBe("4 min left");
  expect(g.now!.next!.when).toBe("right after");
});

test("rail names: the main protein's first character, more when two pots share it; the rice by its short name", () => {
  const chicken = { foodId: "chicken_breast", role: "protein" as const };
  const egg = { foodId: "egg", role: "protein" as const };
  const beef = { foodId: "beef_shank_raw", role: "protein" as const };
  const names = potNames(
    [
      { batch: "a", name: "墨西哥番茄手撕鸡", items: [chicken] },
      { batch: "b", name: "番茄炒蛋", items: [egg] },
      { batch: "c", name: "干香料炖牛肉", items: [beef] },
      { batch: "d", name: "凉拌豆腐", items: [] },
    ],
    { name: "糙米饭" },
  );
  expect(names.map((n) => n.short)).toEqual(["鸡胸", "鸡蛋", "牛", "凉", "饭"]);
  setLocale("en");
  expect(potNames([{ batch: "a", name: "Shredded chicken", items: [chicken] }, { batch: "b", name: "Beef rendang", items: [beef] }], null).map((n) => n.short)).toEqual([
    "Chicken",
    "Beef",
  ]);
});

test("rail colours come from the stylesheet's tokens, and a Pos is written as CSS", () => {
  expect(toneVar(0)).toBe("var(--rail-1)");
  expect(toneVar(6)).toBe("var(--rail-2)");
  expect(toneVar(null)).toBe("var(--faint-foreground)");
  expect(posCss({ px: 19, f: 0 })).toBe("19px");
  expect(posCss({ px: 0, f: 0.5 })).toBe("50%");
  expect(posCss({ px: 19, f: 1 })).toBe("calc(19px + (100% - 19px) * 1)");
});
