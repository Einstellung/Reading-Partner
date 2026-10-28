// The numbers the prep's steps are called by (docs/671 时间线与语音): one rule for
// the prep page's graph, the voice's step list and prep_step, and the chat card.
//
// A step with hands-on time is a commit and gets the next number in start
// order. A waiting-only step gets no number of its own: it hangs under the
// commit it follows (through other waiting-only steps), the same-pot one first.
// A waiting-only step with no such commit before it gets a number like a commit.
//
// Which pot's rail a step belongs to is decided here too, because "the same
// pot" for a step without a pot (washing the pot between two dishes) means the
// rail it is drawn on.

/** What numbering reads of a step, in start order. */
export interface NumberedStepInput {
  id: string;
  pot: string | null;
  after: readonly string[];
  activeMin: number;
  /** Minute the step ends; picks the rail of the program's step. */
  end: number;
  /** The program's last step, not the model's. */
  program: boolean;
}

/** The rail key of steps no pot reaches. */
export const NO_RAIL = "";

/**
 * Each step's rail: its pot; a step without one takes the rail of the step
 * after it that has one, else of the step before it; the program's step takes
 * the rail of its latest-ending predecessor.
 */
export function stepRails(steps: readonly NumberedStepInput[]): Map<string, string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const order = new Map(steps.map((s, i) => [s.id, i]));
  const children = new Map<string, NumberedStepInput[]>();
  for (const s of steps) for (const a of s.after) if (byId.has(a)) children.set(a, [...(children.get(a) ?? []), s]);
  const find = (s: NumberedStepInput, seen: Set<string>): string | null => {
    if (s.pot) return s.pot;
    if (seen.has(s.id)) return null;
    seen.add(s.id);
    if (s.program) {
      const preds = s.after
        .flatMap((a) => (byId.has(a) ? [byId.get(a)!] : []))
        .filter((p) => !p.program)
        .sort((a, b) => b.end - a.end || order.get(b.id)! - order.get(a.id)!);
      for (const p of preds) {
        const r = find(p, seen);
        if (r) return r;
      }
      return null;
    }
    for (const c of (children.get(s.id) ?? []).filter((c) => !c.program)) {
      const r = find(c, seen);
      if (r) return r;
    }
    for (const a of s.after) {
      const p = byId.get(a);
      const r = p ? find(p, seen) : null;
      if (r) return r;
    }
    return null;
  };
  return new Map(steps.map((s) => [s.id, find(s, new Set()) ?? NO_RAIL]));
}

export interface StepNumber {
  /** The step's number, or null for a waiting-only step hung under a commit. */
  n: number | null;
  /** The commit a waiting-only step hangs under; null for a commit. */
  under: string | null;
}

/** Every step's number, by id; `steps` in start order. */
export function stepNumbers(steps: readonly NumberedStepInput[]): Map<string, StepNumber> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const rail = stepRails(steps);
  const rootOf = (s: NumberedStepInput): NumberedStepInput | null => {
    let cur: NumberedStepInput | undefined = s;
    for (let guard = 0; cur && cur.activeMin === 0 && guard < steps.length; guard++) {
      const here: NumberedStepInput = cur;
      const prev = here.after.find((a) => byId.has(a) && rail.get(a) === rail.get(here.id)) ?? here.after.find((a) => byId.has(a));
      cur = prev ? byId.get(prev) : undefined;
    }
    return cur && cur.activeMin > 0 ? cur : null;
  };
  const out = new Map<string, StepNumber>();
  let n = 0;
  for (const s of steps) {
    const root = s.activeMin > 0 ? null : rootOf(s);
    out.set(s.id, root ? { n: null, under: root.id } : { n: ++n, under: null });
  }
  return out;
}
