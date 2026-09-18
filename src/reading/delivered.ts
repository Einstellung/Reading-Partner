// A delegated run coming back while the turn that asked for it is still
// running (docs/72).
//
// The bell does not open a second turn behind the one the reader is watching:
// it puts what came back into that turn's queue as an internal steer, and the
// model is handed it at the end of the round in flight. Internal is the whole
// difference from reading/steering.ts — nobody said this, so it is drawn as no
// row and written into no thread file. What it does leave behind is a mark on
// the reply that follows it, which is how the piece after this one finds the
// answer to a run it delegated.
//
// The bell waits on the landing rather than on the enqueue: a message sitting
// in a queue nothing will drain has not been delivered, and a bell that acked
// on it would leave the run answered and the reader none the wiser. Not landed
// means not acked, and the next pass rings it again.

import type { SteerPort } from "../legion/execute/contract";

export interface Delivered {
  /**
   * Put one run's answer into the turn in flight. Resolves true once the model
   * has been handed it, false when the turn ended first or refused it.
   */
  say(runId: string, text: string): Promise<boolean>;
  /** The turn has a run to queue into. Anything said before it goes now. */
  open(port: SteerPort): void;
  /** The turn reported these ids drained into the model's context. */
  injected(ids: readonly string[]): void;
  /** The turn is over. Nothing still queued will ever land. */
  close(): void;
}

interface Pending {
  runId: string;
  text: string;
  settle: (landed: boolean) => void;
}

/**
 * `onLanded` fires the moment the model is handed one run's answer, with the
 * run's id: the session splits the row there, and the row it opens carries the
 * run as its origin.
 */
export function createDelivered(onLanded: (runId: string) => void): Delivered {
  let port: SteerPort | null = null;
  let closed = false;
  // Queued and not yet landed, by the id the turn gave the queue entry.
  const waiting = new Map<string, Pending>();
  // Said before there was a run to queue into.
  let unsent: Pending[] = [];
  // Reported landed before its enqueue resolved. The same race reading/
  // steering.ts guards: two separate promises, and the alternative is a bell
  // that waits forever on a message the model already has.
  const early = new Set<string>();
  // Enqueues run one after another, so two runs landing at once reach the
  // model in the order the bells were answered.
  let chain: Promise<unknown> = Promise.resolve();

  const land = (job: Pending): void => {
    onLanded(job.runId);
    job.settle(true);
  };

  const send = (job: Pending): void => {
    const at = port;
    if (!at) return;
    chain = chain.then(async () => {
      const outcome = await at({ text: job.text, internal: true });
      if (!outcome.ok) {
        job.settle(false);
        return;
      }
      if (early.delete(outcome.id)) {
        land(job);
        return;
      }
      // The turn settled while the enqueue was in flight.
      if (closed) {
        job.settle(false);
        return;
      }
      waiting.set(outcome.id, job);
    });
  };

  return {
    say(runId, text) {
      if (closed) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const job: Pending = { runId, text, settle: resolve };
        if (port) send(job);
        else unsent.push(job);
      });
    },

    open(next) {
      port = next;
      const waitingForPort = unsent;
      unsent = [];
      for (const job of waitingForPort) send(job);
    },

    injected(ids) {
      for (const id of ids) {
        const job = waiting.get(id);
        if (!job) {
          early.add(id);
          continue;
        }
        waiting.delete(id);
        land(job);
      }
    },

    close() {
      if (closed) return;
      closed = true;
      const lost = [...unsent, ...waiting.values()];
      unsent = [];
      waiting.clear();
      for (const job of lost) job.settle(false);
    },
  };
}
