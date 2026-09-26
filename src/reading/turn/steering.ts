// What the reader said while the answer was still being written (docs/72).
//
// Talking mid-answer is not the stop button: the line goes into the turn's
// queue and the model is handed it at the end of the round in flight. Between
// the two moments the line is on screen and nowhere else — not in the model's
// context, not in the thread file — which is what the queued mark on its row
// says, and what this object keeps track of.
//
// Two things the session needs from it and cannot get from the turn:
//
//   - which rows the queued mark comes off, the moment the model is handed
//     them. The turn reports ids it minted; the session drew rows keyed by the
//     moment the reader pressed Enter. This is the map between them.
//   - what never reached the model, when the turn ends without draining the
//     queue (the stop button, an error, an answer that landed first). The turn
//     does not know — the queue is the harness's — so the difference is kept
//     here: everything said, minus everything reported injected.
//
// Order is preserved: the enqueues are chained rather than raced, so two lines
// typed in a hurry reach the model in the order they were typed.

import type { SteerPort } from "../../legion/execute/contract";

/** One line the reader said mid-turn, keyed by the row it is drawn as. */
export interface PendingSteer {
  ts: number;
  text: string;
}

export interface Steering {
  /** Queue one line. `ts` is the row's, and what the session is told back. */
  say(ts: number, text: string): void;
  /** The turn has a run to queue into. Anything said before it goes now. */
  open(port: SteerPort): void;
  /** The turn reported these ids drained into the model's context. */
  injected(ids: readonly string[]): void;
  /** What the model was never handed, oldest first. */
  outstanding(): PendingSteer[];
}

export function createSteering(onInjected: (lines: PendingSteer[]) => void): Steering {
  // Everything said, in the order it was said. Nothing is removed: an injected
  // line is marked, not forgotten, so a second report of the same id is a
  // no-op rather than a second delivery.
  const said = new Map<number, PendingSteer>();
  const injectedTs = new Set<number>();
  // The turn's id for a line, once its enqueue came back.
  const tsById = new Map<string, number>();
  // Reported injected before its enqueue resolved. Not expected — the drain is
  // a round boundary away — but the two are separate promises, and a line
  // silently left marked queued forever is the cost of assuming otherwise.
  const early = new Set<string>();

  let port: SteerPort | null = null;
  // Enqueues run one after another so the model reads them in typing order.
  let chain: Promise<unknown> = Promise.resolve();
  let unsent: number[] = [];

  const land = (ts: number): void => {
    if (injectedTs.has(ts)) return;
    const line = said.get(ts);
    if (!line) return;
    injectedTs.add(ts);
    onInjected([line]);
  };

  const send = (ts: number): void => {
    const line = said.get(ts);
    if (!line || !port) return;
    const at = port;
    chain = chain.then(async () => {
      const outcome = await at(line.text);
      // A refusal leaves the line outstanding, which is exactly what it is:
      // the turn ended before it could take it, and the session opens the next
      // turn with it.
      if (!outcome.ok) return;
      tsById.set(outcome.id, ts);
      if (early.delete(outcome.id)) land(ts);
    });
  };

  return {
    say(ts, text) {
      if (said.has(ts)) return;
      said.set(ts, { ts, text });
      if (port) send(ts);
      else unsent.push(ts);
    },

    open(next) {
      port = next;
      const waiting = unsent;
      unsent = [];
      for (const ts of waiting) send(ts);
    },

    injected(ids) {
      for (const id of ids) {
        const ts = tsById.get(id);
        if (ts === undefined) early.add(id);
        else land(ts);
      }
    },

    outstanding() {
      return [...said.values()].filter((line) => !injectedTs.has(line.ts));
    },
  };
}
