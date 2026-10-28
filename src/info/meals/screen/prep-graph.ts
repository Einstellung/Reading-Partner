// The prep page's timeline drawn like `git log --graph` (docs/671 时间线与语音):
// each pot is a rail on the left, the steps are commits on it, text on the
// right. Everything the graph and the 「现在」 card draw is read here off
// timeline/view.ts; MealsTimeline.tsx only renders it.
//
// - A commit is a step the hands do something in, numbered by start. A step of
//   waiting only (letting the pressure out) has no number: it hangs under the
//   commit it follows as 「接着」.
// - A step with no pot (washing up, the program's last step) is drawn on the
//   rail of the step after it; the program's last step on the rail that ends
//   last, every other rail merging into it.
// - A rail is solid while the hands are on its pot, hatched while the pot runs
//   on its own, dotted while it waits for another pot, and ends where the pot
//   is done.
// - Stretches where the hands have nothing to do are rows of their own.
//
// Row heights follow the text, so a position on a rail is a fraction of the
// row's height past a fixed number of pixels (Pos): the node of a commit sits
// level with its first line of text, and the rails across a row map its
// minutes onto its height.

import { getLocale, t } from "../../../i18n";
import { foodById } from "../nutrition/foods";
import type { TemplateItem } from "../nutrition/solve";
import type { StepStatus } from "../timeline/run";
import { RICE_POT } from "../timeline/steps";
import type { TimelineStepView, TimelineView } from "../timeline/view";
import { clockText, minutesText, stepActions, type PrepPhase, type StepAction } from "./prep-timeline";

// --- the pots' short names -----------------------------------------------------

export interface PotName {
  /** The pot id the steps name (a batch id, or RICE_POT). */
  id: string;
  name: string;
  /** What its rail is called: 「鸡」「牛」, "Chicken". */
  short: string;
}

export interface PotSource {
  batch: string;
  name: string;
  items: readonly TemplateItem[];
}

// 「鸡胸肉（生）」 → 鸡胸肉: what is in brackets is not the name.
const BRACKETS = /[（(][^）)]*[）)]/g;

function proteinName(items: readonly TemplateItem[], zh: boolean): string | null {
  const foods = items.flatMap((it) => {
    const f = foodById(it.foodId);
    return f ? [{ f, role: it.role }] : [];
  });
  const hit = foods.find((x) => x.role === "protein") ?? foods.find((x) => x.f.category === "protein");
  if (!hit) return null;
  return (zh ? hit.f.zh : hit.f.en) || null;
}

/**
 * Each pot's rail name: the first character (Chinese) or word of its main
 * protein, else of the dish's name, as many as it takes to tell the pots
 * apart; the rice is 「米饭」's short form.
 */
export function potNames(pots: readonly PotSource[], rice: { name: string } | null): PotName[] {
  const zh = getLocale() === "zh-CN";
  const tokens = pots.map((p) => {
    const clean = (proteinName(p.items, zh) ?? p.name).replace(BRACKETS, "").trim();
    const parts = zh ? [...clean.replace(/\s+/g, "")] : clean.split(/\s+/).filter(Boolean);
    return parts.length ? parts : [p.batch];
  });
  const join = (parts: string[]) => {
    const s = parts.join(zh ? "" : " ");
    return zh ? s : s.charAt(0).toUpperCase() + s.slice(1);
  };
  const prefix = (i: number, k: number) => join(tokens[i]!.slice(0, k));
  const shorts = tokens.map((parts, i) => {
    for (let k = 1; k <= parts.length; k++) {
      const s = prefix(i, k);
      if (tokens.every((_, j) => j === i || prefix(j, k) !== s)) return s;
    }
    return join(parts);
  });
  // Two pots of the same thing: numbered.
  const out: PotName[] = pots.map((p, i) => {
    const same = shorts.filter((s) => s === shorts[i]!).length;
    const nth = shorts.slice(0, i + 1).filter((s) => s === shorts[i]!).length;
    return { id: p.batch, name: p.name, short: same > 1 ? `${shorts[i]!}${nth}` : shorts[i]! };
  });
  if (rice) out.push({ id: RICE_POT, name: rice.name, short: t("meals.timeline.riceShort") });
  return out;
}

// --- the graph -------------------------------------------------------------------

/** Pixels between rails, and the margin either side of them. */
export const RAIL_GAP = 22;
const RAIL_PAD = 6;
/** How many rail colours there are (styles.css --rail-1 … --rail-5); further rails repeat them. */
export const RAIL_TONES = 5;
/** A commit's node, level with its first line of text, and with the 「手转到」 chip above it. */
export const NODE_Y = 19;
export const NODE_Y_SWITCHED = 43;
/** The chip's middle, where the dashed arrow runs. */
export const SWITCH_Y = 18;
const NODE_MIN = 8;
const NODE_MAX = 18;
/** A stretch of free hands: about 3 px a minute, within these. */
const GAP_MIN_PX = 64;
const GAP_MAX_PX = 220;
/** Free hands this long are worth walking away for. */
const WALK_AWAY_MIN = 5;

/** `px` pixels, then fraction `f` of the rest of the row's height. */
export interface Pos {
  px: number;
  f: number;
}

export type LineKind = "hands" | "bg" | "idle";

export interface GraphRail {
  key: string;
  pot: string | null;
  short: string;
  name: string;
  /** 0-based rail colour, or null for steps that belong to no pot. */
  tone: number | null;
  x: number;
}

export interface RailLine {
  x: number;
  tone: number | null;
  kind: LineKind;
  from: Pos;
  to: Pos;
}

export interface RailMark {
  x: number;
  tone: number | null;
  /** tick: one waiting step gives way to the next; cap: the pot is done. */
  kind: "tick" | "cap";
  at: Pos;
}

export interface GraphWait {
  /** The step whose waiting this is: the commit's own, or a waiting-only step after it. */
  id: string;
  /** 「后台：压力锅 20 分，到第 26 分」, 「接着：等 15 分，到第 41 分」. */
  line: string;
  /** A waiting-only step's own sentence; null for the commit's own waiting. */
  text: string | null;
  minutes: number;
  /** Minute it is over. */
  until: number;
  state: StepStatus;
  /** A waiting-only step's taps; the commit's own waiting is tapped on the commit. */
  actions: StepAction[];
}

interface RowBase {
  key: string;
  /** Minutes from the start the row covers. */
  t0: number;
  t1: number;
  lines: RailLine[];
  marks: RailMark[];
}

export interface CommitRow extends RowBase {
  kind: "commit";
  id: string;
  n: number;
  text: string;
  tone: number | null;
  x: number;
  /** Node diameter: longer hands-on, bigger. */
  size: number;
  /** A step of no pot: a ring rather than a dot. */
  hollow: boolean;
  nodeY: number;
  /** 「手转到：牛」: the hands come from another pot's rail. */
  handsTo: string | null;
  /** The dashed arrow from the rail the hands were on (SVG, row pixels). */
  handsArrow: { x1: number; x2: number; y: number; head: string } | null;
  /** The rails merging into the node: an SVG path each, from the row's top. */
  merges: { key: string; x: number; tone: number | null; d: string }[];
  /** 「第 5 分 · 压力锅 · 动手 1 分 · 等 20 分」 before the start, 「14:05 – 14:06 · 压力锅」 after. */
  meta: string;
  waits: GraphWait[];
  /** 「<菜名>完成」 on the commit that finishes a pot. */
  potDone: string | null;
  state: StepStatus;
  /** Faded: it and its waiting are over. */
  past: boolean;
  current: boolean;
  actions: StepAction[];
}

export interface GapRow extends RowBase {
  kind: "gap";
  minutes: number;
  /** 「手空 12 分，可以走开」. */
  head: string;
  /** 「鸡 第 41 分好」 per pot running in the background. */
  ready: { key: string; tone: number | null; text: string }[];
  /** 「第 41 分回来做第 7 步（鸡）」. */
  back: string | null;
  minHeight: number;
  past: boolean;
  current: boolean;
}

export type GraphRow = CommitRow | GapRow;

export interface NowCard {
  /** 「第 47 分 · 14:47」. */
  minute: string;
  done: boolean;
  hands: { n: number | null; tone: number | null; text: string; left: string | null };
  background: { key: string; tone: number | null; short: string; text: string; quiet: boolean }[];
  next: { n: number; tone: number | null; text: string; when: string } | null;
}

export interface GraphView {
  rails: GraphRail[];
  /** Pixels the rails take, left of the text. */
  width: number;
  /** Every short name fits over its rail (「鸡」 does, "Chicken" does not). */
  labelsFit: boolean;
  rows: GraphRow[];
  /** The 「现在」 card, while a run is under way. */
  now: NowCard | null;
}

type Step = TimelineStepView;

interface RailState {
  kind: LineKind | "none";
  step: Step | null;
}

interface Commit {
  s: Step;
  n: number;
  rail: string;
  chain: Step[];
}

const OTHER = "";

export function nodeSize(activeMin: number): number {
  return Math.min(NODE_MAX, NODE_MIN + activeMin * 2.5);
}

/** A rail's colour (styles.css --rail-N); steps of no pot are drawn in the faint ink. */
export function toneVar(tone: number | null): string {
  return tone === null ? "var(--faint-foreground)" : `var(--rail-${(tone % RAIL_TONES) + 1})`;
}

/** About how wide a rail name is at 12 px: a CJK character is square, a Latin one a little over half. */
function labelWidth(s: string): number {
  return [...s].reduce((w, ch) => w + (ch.codePointAt(0)! >= 0x2e80 ? 12 : 7), 0);
}

/** The CSS length of a Pos inside its row. */
export function posCss(p: Pos): string {
  if (p.f === 0) return `${p.px}px`;
  if (p.px === 0) return `${+(p.f * 100).toFixed(3)}%`;
  return `calc(${p.px}px + (100% - ${p.px}px) * ${+p.f.toFixed(5)})`;
}

export function prepGraph(view: TimelineView, phase: PrepPhase, pots: readonly PotName[]): GraphView {
  const steps = view.steps;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const order = new Map(steps.map((s, i) => [s.id, i]));
  const children = new Map<string, Step[]>();
  for (const s of steps) for (const a of s.after) if (byId.has(a)) children.set(a, [...(children.get(a) ?? []), s]);
  const potName = new Map(pots.map((p) => [p.id, p]));
  const over = phase === "finished";
  const running = phase === "running";
  const clockAt = (m: number) => (view.startedAt === null ? null : view.startedAt + m * 60_000);
  const at = (m: number) => {
    const c = clockAt(m);
    return c === null ? t("meals.timeline.atMinute", { minute: m }) : clockText(c);
  };
  const until = (m: number) => {
    const c = clockAt(m);
    return c === null ? t("meals.timeline.untilMinute", { minute: m }) : t("meals.timeline.untilClock", { time: clockText(c) });
  };

  // Which rail each step is drawn on.
  const railOf = new Map<string, string>();
  const findRail = (s: Step, seen: Set<string>): string | null => {
    if (s.pot) return s.pot;
    if (seen.has(s.id)) return null;
    seen.add(s.id);
    if (s.program) {
      const preds = s.after
        .flatMap((a) => (byId.has(a) ? [byId.get(a)!] : []))
        .filter((p) => !p.program)
        .sort((a, b) => b.end - a.end || order.get(b.id)! - order.get(a.id)!);
      for (const p of preds) {
        const r = findRail(p, seen);
        if (r) return r;
      }
      return null;
    }
    for (const c of (children.get(s.id) ?? []).filter((c) => !c.program)) {
      const r = findRail(c, seen);
      if (r) return r;
    }
    for (const a of s.after) {
      const p = byId.get(a);
      const r = p ? findRail(p, seen) : null;
      if (r) return r;
    }
    return null;
  };
  for (const s of steps) railOf.set(s.id, findRail(s, new Set()) ?? OTHER);
  const rail = (s: Step) => railOf.get(s.id)!;

  // The rails, by the first time the hands are on each.
  const keys = [...new Set(steps.map(rail))];
  const firstHands = (k: string) => {
    const hands = steps.filter((s) => rail(s) === k && s.activeMin > 0);
    return hands.length ? Math.min(...hands.map((s) => s.start)) : Number.POSITIVE_INFINITY;
  };
  keys.sort((a, b) => firstHands(a) - firstHands(b) || keys.indexOf(a) - keys.indexOf(b));
  let tone = 0;
  const rails: GraphRail[] = keys.map((k, i) => {
    const p = potName.get(k);
    return {
      key: k,
      pot: k === OTHER ? null : k,
      short: p?.short ?? (k === OTHER ? "·" : k),
      name: p?.name ?? k,
      tone: k === OTHER ? null : tone++ % RAIL_TONES,
      x: RAIL_PAD + RAIL_GAP / 2 + i * RAIL_GAP,
    };
  });
  const railBy = new Map(rails.map((r) => [r.key, r]));
  const width = RAIL_PAD * 2 + RAIL_GAP * rails.length;

  const onRail = new Map(keys.map((k) => [k, steps.filter((s) => rail(s) === k)]));
  const own = (k: string) => onRail.get(k)!.filter((s) => !s.program);
  const firstStart = new Map(keys.map((k) => [k, Math.min(...onRail.get(k)!.map((s) => s.start))]));
  const doneAt = new Map(keys.map((k) => [k, Math.max(0, ...own(k).map((s) => s.end))]));
  const end = Math.max(0, ...steps.map((s) => s.end));
  // A pot is in use until it is done or a step on another rail it feeds starts.
  const lastUse = new Map(
    keys.map((k) => [
      k,
      Math.max(doneAt.get(k)!, ...own(k).flatMap((s) => (children.get(s.id) ?? []).filter((c) => !c.program && rail(c) !== k).map((c) => c.start))),
    ]),
  );

  const stateAt = (k: string, m: number): RailState => {
    for (const s of onRail.get(k)!) {
      if (s.start <= m && m < s.end) return { kind: m < s.handsEnd ? "hands" : "bg", step: s };
    }
    if (m < firstStart.get(k)!) return { kind: "none", step: null };
    if (m < lastUse.get(k)!) return { kind: "idle", step: null };
    return { kind: "none", step: null };
  };

  const segments = (k: string, a: number, b: number) => {
    const points = new Set([a, b]);
    for (const s of onRail.get(k)!) for (const x of [s.start, s.handsEnd, s.end]) if (x > a && x < b) points.add(x);
    for (const x of [firstStart.get(k)!, lastUse.get(k)!]) if (x > a && x < b) points.add(x);
    const xs = [...points].sort((x, y) => x - y);
    const out: { kind: LineKind | "none"; step: Step | null; from: number; to: number }[] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const st = stateAt(k, (xs[i]! + xs[i + 1]!) / 2);
      const last = out[out.length - 1];
      if (last && last.kind === st.kind && last.step === st.step) last.to = xs[i + 1]!;
      else out.push({ kind: st.kind, step: st.step, from: xs[i]!, to: xs[i + 1]! });
    }
    return out.filter((g): g is { kind: LineKind; step: Step | null; from: number; to: number } => g.kind !== "none");
  };

  // The rails across minutes a..b of a row, below `top` pixels.
  const across = (k: string, a: number, b: number, top: number) => {
    const r = railBy.get(k)!;
    const lines: RailLine[] = [];
    const marks: RailMark[] = [];
    if (b <= a) {
      const st = stateAt(k, a);
      if (st.kind !== "none") lines.push({ x: r.x, tone: r.tone, kind: st.kind, from: { px: top, f: 0 }, to: { px: top, f: 1 } });
      return { lines, marks };
    }
    const pos = (m: number): Pos => ({ px: top, f: (m - a) / (b - a) });
    const segs = segments(k, a, b);
    segs.forEach((g, i) => {
      lines.push({ x: r.x, tone: r.tone, kind: g.kind, from: pos(g.from), to: pos(g.to) });
      const next = segs[i + 1];
      if (g.kind === "bg" && next?.kind === "bg" && next.from === g.to) marks.push({ x: r.x, tone: r.tone, kind: "tick", at: pos(g.to) });
      if (g.kind === "bg" && g.to === doneAt.get(k) && g.to === lastUse.get(k) && r.pot !== null) marks.push({ x: r.x, tone: r.tone, kind: "cap", at: pos(g.to) });
    });
    return { lines, marks };
  };

  // Commits, and the waiting-only steps hung under them.
  const rootOf = (s: Step): Step | null => {
    let cur: Step | undefined = s;
    for (let guard = 0; cur && cur.activeMin === 0 && guard < steps.length; guard++) {
      const prev: string | undefined = cur.after.find((a) => byId.has(a) && rail(byId.get(a)!) === rail(cur!)) ?? cur.after.find((a) => byId.has(a));
      cur = prev ? byId.get(prev) : undefined;
    }
    return cur && cur.activeMin > 0 ? cur : null;
  };
  const rootById = new Map<string, Step>();
  for (const s of steps) {
    if (s.activeMin > 0) continue;
    const r = rootOf(s);
    if (r) rootById.set(s.id, r);
  }
  const commits: Commit[] = steps
    .filter((s) => s.activeMin > 0 || !rootById.has(s.id))
    .map((s, i) => ({ s, n: i + 1, rail: rail(s), chain: [] }));
  const commitOf = new Map(commits.map((c) => [c.s.id, c]));
  for (const s of steps) {
    const r = rootById.get(s.id);
    if (r) commitOf.get(r.id)!.chain.push(s);
  }

  // The step that finishes each pot.
  const potDoneBy = new Map<string, string>();
  for (const r of rails) {
    if (r.pot === null) continue;
    const last = [...own(r.key)].sort((a, b) => b.end - a.end || order.get(b.id)! - order.get(a.id)!)[0];
    if (!last) continue;
    const c = commitOf.get(last.id) ?? commitOf.get(rootById.get(last.id)?.id ?? "");
    if (c) potDoneBy.set(c.s.id, r.key);
  }

  const status = (s: Step): StepStatus => (over ? "done" : s.status);
  const actionsOf = (s: Step) => (over ? [] : stepActions(s, view, phase));
  const listJoin = t("meals.listJoin");

  const rows: GraphRow[] = [];
  const nextCommit = (m: number) => commits.find((c) => c.s.start >= m) ?? null;

  const gapRow = (t0: number, t1: number): GapRow => {
    const minutes = t1 - t0;
    const lines: RailLine[] = [];
    const marks: RailMark[] = [];
    const ready: GapRow["ready"] = [];
    for (const r of rails) {
      const part = across(r.key, t0, t1, 0);
      lines.push(...part.lines);
      marks.push(...part.marks);
      const bg = segments(r.key, t0, t1).filter((g) => g.kind === "bg");
      if (!bg.length) continue;
      let end = bg[bg.length - 1]!.to;
      if (end >= t1) {
        // Keeps running past the row: until its waiting is over.
        let st = stateAt(r.key, end);
        while (st.kind === "bg" && st.step) {
          end = st.step.end;
          st = stateAt(r.key, end);
        }
      }
      ready.push({ key: r.key, tone: r.tone, text: t("meals.timeline.readyAt", { pot: r.short, at: at(end) }) });
    }
    const back = nextCommit(t1);
    const minute = view.minute;
    return {
      kind: "gap",
      key: `gap:${t0}`,
      t0,
      t1,
      lines,
      marks,
      minutes,
      head: t(minutes >= WALK_AWAY_MIN ? "meals.timeline.handsFreeAway" : "meals.timeline.handsFree", { minutes }),
      ready,
      back: back ? t("meals.timeline.backAt", { at: at(back.s.start), n: back.n, pot: railBy.get(back.rail)!.short }) : null,
      minHeight: Math.min(GAP_MAX_PX, Math.max(GAP_MIN_PX, minutes * 3)),
      past: over || (running && minute >= t1),
      current: running && view.current === null && minute >= t0 && minute < t1,
    };
  };

  const commitRow = (c: Commit, prev: Commit | null): CommitRow => {
    const s = c.s;
    const r = railBy.get(c.rail)!;
    const t0 = s.start;
    const t1 = s.handsEnd;
    const switched = prev !== null && prev.rail !== c.rail;
    const nodeY = switched ? NODE_Y_SWITCHED : NODE_Y;
    const lines: RailLine[] = [];
    const marks: RailMark[] = [];
    for (const other of rails) {
      if (other.key !== c.rail) {
        const part = across(other.key, t0, t1, 0);
        lines.push(...part.lines);
        marks.push(...part.marks);
        continue;
      }
      const before = stateAt(c.rail, t0 - 1e-6);
      if (before.kind !== "none" && t0 > 0) lines.push({ x: r.x, tone: r.tone, kind: before.kind, from: { px: 0, f: 0 }, to: { px: nodeY, f: 0 } });
      const after = t1 > t0 ? "hands" : stateAt(c.rail, t0).kind;
      if (after !== "none") lines.push({ x: r.x, tone: r.tone, kind: after, from: { px: nodeY, f: 0 }, to: { px: nodeY, f: 1 } });
      // The rail the whole prep ends on closes under its last step.
      if (t1 === end) marks.push({ x: r.x, tone: r.tone, kind: "cap", at: { px: nodeY, f: 1 } });
    }
    const mergeKeys = s.program
      ? rails.filter((x) => x.key !== c.rail).map((x) => x.key)
      : [...new Set(s.after.flatMap((a) => (byId.has(a) ? [rail(byId.get(a)!)] : [])).filter((k) => k !== c.rail))];
    const merges = rails
      .filter((x) => mergeKeys.includes(x.key))
      .map((x) => ({ key: x.key, x: x.x, tone: x.tone, d: `M${x.x} 0 C${x.x} ${nodeY * 0.75} ${r.x} ${nodeY * 0.35} ${r.x} ${nodeY}` }));
    let handsArrow: CommitRow["handsArrow"] = null;
    if (switched) {
      const from = railBy.get(prev!.rail)!.x;
      const dir = r.x > from ? 1 : -1;
      const y = SWITCH_Y;
      handsArrow = { x1: from, x2: r.x - dir * 4, y, head: `M${r.x - dir * 8} ${y - 3.5} L${r.x - dir * 2} ${y} L${r.x - dir * 8} ${y + 3.5}` };
    }
    const metaParts =
      view.startedAt === null
        ? [at(s.start), s.deviceLabel, minutesText(s)]
        : [`${clockText(clockAt(s.start)!)} – ${clockText(clockAt(s.handsEnd)!)}`, s.deviceLabel];
    if (merges.length) {
      const from = rails.filter((x) => mergeKeys.includes(x.key)).map((x) => x.short);
      metaParts.push(t("meals.timeline.mergeInto", { from: from.join(listJoin), to: r.short }));
    }
    const waits: GraphWait[] = [];
    if (s.end > s.handsEnd) {
      const minutes = s.end - s.handsEnd;
      waits.push({ id: s.id, line: t("meals.timeline.background", { device: s.deviceLabel, minutes, until: until(s.end) }), text: null, minutes, until: s.end, state: status(s), actions: [] });
    }
    for (const w of c.chain) {
      const minutes = w.end - w.start;
      waits.push({ id: w.id, line: t("meals.timeline.thenWait", { minutes, until: until(w.end) }), text: w.text, minutes, until: w.end, state: status(w), actions: actionsOf(w) });
    }
    const doneKey = potDoneBy.get(s.id);
    return {
      kind: "commit",
      key: s.id,
      t0,
      t1,
      lines,
      marks,
      id: s.id,
      n: c.n,
      text: s.text,
      tone: r.tone,
      x: r.x,
      size: nodeSize(s.activeMin),
      hollow: s.pot === null,
      nodeY,
      handsTo: switched ? r.short : null,
      handsArrow,
      merges,
      meta: metaParts.filter(Boolean).join(" · "),
      waits,
      potDone: doneKey ? t("meals.timeline.potDone", { pot: railBy.get(doneKey)!.name }) : null,
      state: status(s),
      past: over || (s.status === "done" && c.chain.every((w) => w.status === "done")),
      current: running && s.id === view.current,
      actions: actionsOf(s),
    };
  };

  let prevEnd = 0;
  let prev: Commit | null = null;
  for (const c of commits) {
    if (c.s.start > prevEnd) rows.push(gapRow(prevEnd, c.s.start));
    rows.push(commitRow(c, prev));
    prevEnd = Math.max(prevEnd, c.s.handsEnd);
    prev = c;
  }
  if (prevEnd < view.totalMin) rows.push(gapRow(prevEnd, view.totalMin));

  const labelsFit = rails.every((r) => labelWidth(r.short) <= RAIL_GAP - 2);
  return { rails, width, labelsFit, rows, now: running ? nowCard() : null };

  function nowCard(): NowCard {
    const m = view.minute;
    const clock = clockAt(m);
    const minute = [t("meals.timeline.atMinute", { minute: m }), clock === null ? null : clockText(clock)].filter(Boolean).join(" · ");
    const done = steps.every((s) => s.status === "done");
    const cur = view.current ? (commitOf.get(view.current) ?? null) : null;
    const todo = commits.filter((c) => c !== cur && c.s.status === "todo");
    const next = cur ? (todo.find((c) => c.s.start >= cur.s.start) ?? null) : (todo[0] ?? null);
    const curLeft = cur ? cur.s.handsEnd - m : 0;
    const hands: NowCard["hands"] = cur
      ? { n: cur.n, tone: railBy.get(cur.rail)!.tone, text: cur.s.text, left: curLeft > 0 ? t("meals.timeline.leftMin", { minutes: curLeft }) : null }
      : { n: null, tone: null, text: t("meals.timeline.handsFreeNow"), left: null };
    const background: NowCard["background"] = [];
    for (const r of rails) {
      if (cur && cur.rail === r.key) continue;
      const st = stateAt(r.key, m);
      const line = (text: string, quiet: boolean) => background.push({ key: r.key, tone: r.tone, short: r.short, text, quiet });
      if (st.kind === "bg" && st.step) line(t("meals.timeline.potRunning", { device: st.step.deviceLabel, minutes: Math.max(1, st.step.end - m) }), false);
      else if (st.kind === "idle" || st.kind === "hands") {
        const back = commits.find((c) => c.rail === r.key && c.s.status !== "done" && c !== cur);
        line(back ? t("meals.timeline.potIdle", { at: at(back.s.start) }) : t("meals.timeline.potReady"), true);
      } else if (m < firstStart.get(r.key)!) line(t("meals.timeline.potLater", { at: at(firstStart.get(r.key)!) }), true);
      else if (r.pot !== null) line(t("meals.timeline.potReady"), true);
    }
    let when = "";
    if (next) {
      const minutes = next.s.start - m;
      when = (cur && next.s.start <= cur.s.handsEnd) || minutes <= 0 ? t("meals.timeline.nextRightAfter") : t("meals.timeline.nextIn", { minutes });
    }
    return {
      minute,
      done,
      hands,
      background,
      next: next ? { n: next.n, tone: railBy.get(next.rail)!.tone, text: next.s.text, when } : null,
    };
  }
}
