// The virtual clock every test that drives a long-running pipeline shares: the
// watchdog, the prep pipeline and the chapter-spine pipeline all take their
// `now`/`sleep`/`setTimer` from here, so none of them waits out a real minute.

// A clock that orders concurrent waits by their virtual due time — a watchdog
// timer and a fake stream's inter-delta sleeps race on the same clock, so a
// naive "sleep advances a shared counter" fake would fire them out of order.
// Events are queued by due time; a background pump drains microtasks (one real
// macrotask tick per step, so any imminent settle/cancel lands first) and then
// fires the earliest due event. No real time passes beyond those ticks.
export function makeClock(start = 1000) {
  interface Ev {
    at: number;
    seq: number;
    fire: () => void;
    cancelled: boolean;
  }
  let now = start;
  let seq = 0;
  let pumping = false;
  const q: Ev[] = [];

  function schedule(ms: number, fire: () => void): Ev {
    const ev: Ev = { at: now + Math.max(0, ms), seq: seq++, fire, cancelled: false };
    q.push(ev);
    ensurePump();
    return ev;
  }
  function ensurePump(): void {
    if (pumping) return;
    pumping = true;
    void pump();
  }
  async function pump(): Promise<void> {
    for (let guard = 0; guard < 100000; guard++) {
      // Drain all microtasks first, so a call that is about to settle (and
      // cancel its watchdog) wins over the watchdog firing.
      await new Promise<void>((r) => setTimeout(r, 0));
      const live = q.filter((e) => !e.cancelled);
      if (live.length === 0) {
        pumping = false;
        return;
      }
      live.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const ev = live[0];
      q.splice(q.indexOf(ev), 1);
      if (ev.at > now) now = ev.at;
      ev.fire();
    }
    pumping = false;
  }

  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => schedule(ms, resolve)),
    setTimer: (ms: number, cb: () => void) => {
      const ev = schedule(ms, cb);
      return () => {
        ev.cancelled = true;
      };
    },
  };
}
