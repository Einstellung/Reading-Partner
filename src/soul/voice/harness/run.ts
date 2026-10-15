// The life of one bench run, apart from what the script does (docs/platform/
// 560). A run must leave the device as it found it whichever way it ends, so
// the next run starts from a call that is not there: one run at a time, a
// deadline that aborts it, and a hang-up that waits for the stack to come down.

import type { VoiceCallHost } from "./trace";

/** One run at a time; the run's signal aborts on cancel or on its deadline. */
export class RunGate {
  private current: { id: string; ctl: AbortController; timer: ReturnType<typeof setTimeout> | null } | null = null;

  get busy(): string | null {
    return this.current?.id ?? null;
  }

  /** Claims the gate, or throws naming the run that holds it. */
  begin(id: string, deadlineMs?: number): AbortSignal {
    if (this.current) throw new Error(`A harness run is already going (${this.current.id}); cancel it or wait.`);
    const ctl = new AbortController();
    const timer = deadlineMs
      ? setTimeout(() => ctl.abort(`The run hit its ${Math.round(deadlineMs / 1000)} s deadline.`), deadlineMs)
      : null;
    this.current = { id, ctl, timer };
    return ctl.signal;
  }

  /** Aborts the run `id` if it is the one going. */
  cancel(id: string, reason: string): boolean {
    if (this.current?.id !== id) return false;
    this.current.ctl.abort(reason);
    return true;
  }

  /** Frees the gate; a run that is not the holder cannot free it. */
  end(id: string): void {
    if (this.current?.id !== id) return;
    if (this.current.timer) clearTimeout(this.current.timer);
    this.current = null;
  }
}

/**
 * Hangs up and gives the stack time to come down. `stop` on a page with no
 * call is a no-op, so this is safe both at the end of a run and, to clear what
 * an earlier run left, at the start of the next.
 */
export async function hangUp(host: VoiceCallHost, sleep: (ms: number) => Promise<void>, settleMs = 1500): Promise<void> {
  host.stop();
  await sleep(settleMs);
}

/**
 * What the run reports when it ends: `done`, or `failed` with the reason. The
 * teardown has run by the time this is built; the caller reports it last.
 */
export function endState(failure: unknown): { state: "done" } | { state: "failed"; message: string } {
  if (!failure) return { state: "done" };
  return { state: "failed", message: failure instanceof Error ? failure.message : String(failure) };
}
