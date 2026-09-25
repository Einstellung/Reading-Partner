// What one pass of the sync engine (engine.ts) knows about its own failures,
// and the bounded pool its data-channel transfers run in. Both are what make a
// pass per-item rather than all-or-nothing (docs/pitfall/52).

// A run of failures this long means the link is down, not that one file is
// awkward. The rest of the pass would only spend its retry budget failing the
// same way, so it is left for the next pass. It is consulted before a transfer
// is dispatched, so a pool that trips it still has whatever it had on the wire:
// the guard exists to save a device from grinding through hundreds of items on
// a dead link, not to make the last few requests exact.
export const MAX_CONSECUTIVE_FAILURES = 3;

// Run `task` over every item with at most `limit` of them in flight.
//
// `task` must not reject. A rejection would take the whole Promise.all with it
// and leave its siblings running unobserved, which is precisely the
// all-or-nothing behaviour a pass must not have (docs/pitfall/52) — so every
// caller keeps the try/catch its serial loop had, inside the task.
//
// `stop` is asked before each dispatch and never mid-task: nothing here can
// call back a request that is already on the wire, so a pool that stops costs
// at most the tasks it had already started.
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  stop: () => boolean,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !stop()) {
      await task(items[next++]);
    }
  };
  const width = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: width }, () => worker()));
}

// Cap on the failure text kept for the UI: it is shown on one line in Settings,
// and Drive's error bodies run long.
const MESSAGE_LIMIT = 160;

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// What failed in one pass, and whether to keep going. Every line the user reads
// about a partial pass is composed here, so it names the file rather than the
// URL: "download annotations-<hash>.json failed: …" is diagnosable, the Drive
// media URL alone is not.
export class PassFailures {
  count = 0;
  private first: string | null = null;
  private streak = 0;
  private auth: unknown = null;

  record(what: string, e: unknown): void {
    this.count += 1;
    this.streak += 1;
    if (this.first === null) {
      const detail = messageOf(e);
      const line = `${what} failed: ${detail}`;
      this.first = line.length > MESSAGE_LIMIT ? `${line.slice(0, MESSAGE_LIMIT - 1)}…` : line;
    }
  }

  // A dead token is not one awkward file: every request left in the pass would
  // only spend itself learning the same thing, which on the data channel is two
  // hundred more requests into the same wall. The serial loops throw it on the
  // spot; a pool cannot, because it has siblings on the wire that nothing can
  // call back — so it is kept here, dispatch stops at once, the in-flight tasks
  // are left to settle, and rethrowAuthFailure() puts the pass exactly where
  // the serial `throw` used to put it. Siblings that fail the same way after it
  // are dropped rather than recorded: they are one condition, not several
  // faults, and the pass reports the auth error itself either way.
  recordAuth(e: unknown): void {
    if (this.auth === null) this.auth = e;
  }

  rethrowAuthFailure(): void {
    if (this.auth !== null) throw this.auth;
  }

  succeeded(): void {
    this.streak = 0;
  }

  halted(): boolean {
    return this.auth !== null || this.streak >= MAX_CONSECUTIVE_FAILURES;
  }

  message(): string | null {
    if (this.count === 0) return null;
    if (this.count === 1) return this.first;
    return `${this.count} items failed; first: ${this.first}`;
  }
}
