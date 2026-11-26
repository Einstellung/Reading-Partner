// The prep timeline (docs/671 时间线与语音): a session's steps laid out for one
// person in one kitchen. Pure: the steps, the kitchen and what has already
// happened in, minutes from the session's start out. No clock time is made
// here; the screen adds the start time once the reader has started.
//
// One pair of hands: hands-on parts never overlap. A device does one thing at
// a time, the stove as many as it has burners (the steamer is a pot with a
// rack on a burner). The waiting part of a step keeps its device busy and
// leaves the hands free for another step. Among the steps that could start,
// the one with the longest chain of steps hanging behind it goes first.
//
// The same layout gives every minute count of a session: the written steps
// once there are some, and before that one step per pot from the dish
// library's own minutes (estimateMinutes, which planner/prep.ts shows).

import { EQUIPMENT, type Dish, type Equipment } from "../dishes/types";
import type { Profile } from "../nutrition/targets";
import { COUNTER, type LaneDevice, type PrepStep } from "./steps";

/** Burners when the profile has not said (docs/671 目标用户: a frying pan and a pot). */
export const DEFAULT_BURNERS = 2;

export interface Kitchen {
  burners: number;
}

export function kitchenFor(profile: Pick<Profile, "burners"> | null | undefined): Kitchen {
  const b = profile?.burners;
  return { burners: typeof b === "number" && Number.isFinite(b) && b >= 1 ? Math.floor(b) : DEFAULT_BURNERS };
}

/** What a device's steps occupy: the steamer sits on a burner. */
export function resourceOf(device: LaneDevice): LaneDevice {
  return device === "steamer" ? "stove" : device;
}

function capacity(resource: LaneDevice, kitchen: Kitchen): number {
  if (resource === COUNTER) return Number.POSITIVE_INFINITY;
  if (resource === "stove") return Math.max(1, kitchen.burners);
  return 1;
}

/** A step whose times are already known (it has started): placed where it is, not scheduled. */
export interface Pin {
  start: number;
  handsEnd: number;
  end: number;
}

export interface Placement {
  step: string;
  start: number;
  /** End of the hands-on part; the waiting part runs from here to `end`. */
  handsEnd: number;
  end: number;
  /** The lane it is drawn in: `<device>:<slot>`, the slot 1-based (a burner, or a second counter row). */
  lane: string;
}

export interface Segment {
  step: string;
  kind: "active" | "wait";
  start: number;
  end: number;
}

export interface Lane {
  id: string;
  device: LaneDevice;
  slot: number;
  segments: Segment[];
}

export interface Timeline {
  placements: Record<string, Placement>;
  /** Step ids by start, ties in the steps' own order. */
  order: string[];
  lanes: Lane[];
  /** Start to the end of the last step. */
  totalMin: number;
  /** Minutes the hands are on a step. */
  activeMin: number;
}

export interface ScheduleOptions {
  /** Steps already under way, placed as they are. */
  pins?: ReadonlyMap<string, Pin>;
  /** A step that needs the hands starts no earlier than this (now, once started). Waiting-only steps start when ready. */
  floor?: number;
}

interface Interval {
  start: number;
  end: number;
}

const overlaps = (list: readonly Interval[], a: number, b: number) => list.some((iv) => iv.start < b && a < iv.end);

/** Each step's own minutes plus the longest chain of steps waiting on it. */
export function chainLengths(steps: readonly PrepStep[]): Map<string, number> {
  const ids = new Set(steps.map((s) => s.id));
  const next = new Map<string, string[]>();
  for (const s of steps) for (const a of s.after) if (ids.has(a)) next.set(a, [...(next.get(a) ?? []), s.id]);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const chain = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const s = byId.get(id)!;
    const tail = Math.max(0, ...(next.get(id) ?? []).map(chain));
    visiting.delete(id);
    const n = s.active + s.wait + tail;
    memo.set(id, n);
    return n;
  };
  for (const s of steps) chain(s.id);
  return memo;
}

const LANE_ORDER: readonly LaneDevice[] = [COUNTER, ...EQUIPMENT];

export function schedule(steps: readonly PrepStep[], kitchen: Kitchen, opts: ScheduleOptions = {}): Timeline {
  const pins = opts.pins ?? new Map<string, Pin>();
  const floor = opts.floor ?? 0;
  const index = new Map(steps.map((s, i) => [s.id, i]));
  const ids = new Set(steps.map((s) => s.id));
  const chain = chainLengths(steps);
  const slots = new Map<LaneDevice, Interval[][]>();
  const hands: Interval[] = [];
  const placed = new Map<string, Placement>();

  const slotList = (r: LaneDevice) => {
    let list = slots.get(r);
    if (!list) slots.set(r, (list = []));
    return list;
  };
  const freeSlot = (r: LaneDevice, a: number, b: number): number | null => {
    const list = slotList(r);
    for (let i = 0; i < list.length; i++) if (!overlaps(list[i]!, a, b)) return i;
    return list.length < capacity(r, kitchen) ? list.length : null;
  };
  const take = (s: PrepStep, start: number, handsEnd: number, end: number) => {
    const r = resourceOf(s.device);
    // A pin the reader made overlap another is drawn on the first slot.
    const slot = freeSlot(r, start, end) ?? 0;
    const list = slotList(r);
    while (list.length <= slot) list.push([]);
    if (end > start) list[slot]!.push({ start, end });
    if (handsEnd > start) hands.push({ start, end: handsEnd });
    placed.set(s.id, { step: s.id, start, handsEnd, end, lane: `${r}:${slot + 1}` });
  };

  const pinned = steps.filter((s) => pins.has(s.id)).sort((a, b) => pins.get(a.id)!.start - pins.get(b.id)!.start || index.get(a.id)! - index.get(b.id)!);
  for (const s of pinned) {
    const p = pins.get(s.id)!;
    take(s, p.start, p.handsEnd, p.end);
  }

  const floorOf = (s: PrepStep) => (s.active > 0 ? floor : 0);
  const predsEnd = (s: PrepStep): number | null => {
    let end = 0;
    for (const a of s.after) {
      if (!ids.has(a)) continue;
      const p = placed.get(a);
      if (!p) return null;
      end = Math.max(end, p.end);
    }
    return end;
  };

  let remaining = steps.filter((s) => !pins.has(s.id));
  let t = 0;
  while (remaining.length) {
    const ready = remaining
      .filter((s) => {
        const e = predsEnd(s);
        return e !== null && e <= t && floorOf(s) <= t;
      })
      .sort((a, b) => chain.get(b.id)! - chain.get(a.id)! || index.get(a.id)! - index.get(b.id)!);
    for (const s of ready) {
      if (s.active > 0 && overlaps(hands, t, t + s.active)) continue;
      if (freeSlot(resourceOf(s.device), t, t + s.active + s.wait) === null) continue;
      take(s, t, t + s.active, t + s.active + s.wait);
    }
    remaining = remaining.filter((s) => !placed.has(s.id));
    if (!remaining.length) break;
    // The next moment anything frees up or becomes ready.
    let next = Number.POSITIVE_INFINITY;
    const consider = (n: number) => {
      if (n > t && n < next) next = n;
    };
    consider(floor);
    for (const iv of hands) consider(iv.end);
    for (const lists of slots.values()) for (const list of lists) for (const iv of list) consider(iv.end);
    for (const p of placed.values()) consider(p.end);
    if (next === Number.POSITIVE_INFINITY) {
      // Nothing can ever start (a circle the reader's file brought in): the
      // rest one after another at the end, so the screen still shows them.
      let at = Math.max(t, floor, ...[...placed.values()].map((p) => p.end));
      for (const s of remaining) {
        take(s, at, at + s.active, at + s.active + s.wait);
        at += s.active + s.wait;
      }
      break;
    }
    t = next;
  }

  const placements = Object.fromEntries(placed);
  const order = steps
    .map((s) => s.id)
    .sort((a, b) => placed.get(a)!.start - placed.get(b)!.start || index.get(a)! - index.get(b)!);
  const laneMap = new Map<string, Lane>();
  for (const id of order) {
    const p = placed.get(id)!;
    const [device, slot] = p.lane.split(":") as [LaneDevice, string];
    let lane = laneMap.get(p.lane);
    if (!lane) laneMap.set(p.lane, (lane = { id: p.lane, device, slot: Number(slot), segments: [] }));
    if (p.handsEnd > p.start) lane.segments.push({ step: id, kind: "active", start: p.start, end: p.handsEnd });
    if (p.end > p.handsEnd) lane.segments.push({ step: id, kind: "wait", start: p.handsEnd, end: p.end });
  }
  const lanes = [...laneMap.values()].sort((a, b) => LANE_ORDER.indexOf(a.device) - LANE_ORDER.indexOf(b.device) || a.slot - b.slot);
  const all = [...placed.values()];
  return {
    placements,
    order,
    lanes,
    totalMin: Math.max(0, ...all.map((p) => p.end)),
    activeMin: all.reduce((sum, p) => sum + Math.max(0, p.handsEnd - p.start), 0),
  };
}

// The appliance a dish's waiting runs in, before the stove.
const APPLIANCES: readonly Equipment[] = ["pressure_cooker", "rice_cooker", "slow_cooker", "oven", "air_fryer", "microwave", "soy_milk_maker", "kettle", "toaster"];

/** The device a whole dish is laid out on when it has no written steps: its appliance, else the steamer or the stove. */
export function dishDevice(equipment: readonly Equipment[] | undefined): LaneDevice {
  const eq = equipment ?? ["stove"];
  return APPLIANCES.find((e) => eq.includes(e)) ?? (eq.includes("steamer") ? "steamer" : eq.includes("stove") ? "stove" : COUNTER);
}

type DishMinutes = Pick<Dish, "activeMin" | "totalMin"> & Partial<Pick<Dish, "equipment">>;

/** One step per dish: its hands-on minutes, then the rest of its total waiting on its device. */
export function dishSteps(dishes: readonly DishMinutes[]): PrepStep[] {
  return dishes.map((d, i) => ({
    id: String(i + 1),
    text: "",
    device: dishDevice(d.equipment),
    pot: null,
    active: d.activeMin,
    wait: Math.max(0, d.totalMin - d.activeMin),
    after: [],
  }));
}

/** Hands-on and start-to-finish minutes of dishes cooked together, before any steps are written. */
export function estimateMinutes(dishes: readonly DishMinutes[], kitchen: Kitchen = { burners: DEFAULT_BURNERS }): { activeMin: number; totalMin: number } {
  const t = schedule(dishSteps(dishes), kitchen);
  return { activeMin: t.activeMin, totalMin: t.totalMin };
}
