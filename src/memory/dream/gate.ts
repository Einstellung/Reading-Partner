// One of the two things that have to be true before a night starts: no other run
// is already in flight. The other — that the observation store is not still laid
// out the way the migration is about to change — is the same judgement the
// migration itself makes and lives with it (memory/observations/legacy.ts,
// migrate/pending.ts).
//
// Pure, so it is testable. live.ts holds one gate for the process.
//
// It exists because of what 0.12 did on the owner's machine
// (docs/pitfall/210). runDreamIfDue is called from three entry points —
// start-up, foreground and the five-minute tick — and the state file is written
// at the END of a run, so four calls inside 35 seconds all read "not run today"
// and all four ran. Two of them wrote the same ten conclusions twice, once in
// each language. On the same launch the night read observations that still had
// 8 hex ids and wrote statements whose evidence named them; the migration
// renamed every one of those files twenty seconds later, and every statement it
// had written pointed at nothing.

export interface DreamGate {
  // True when this caller may run, and then the caller owes a leave(). False
  // when another run is in flight or this process has already finished one for
  // `day` — and false means "not tonight", never "wait your turn": a queued
  // second run would do exactly what the four runs of 0.12 did.
  enter(day: string): boolean;
  // Ends the run enter() let through. `finished` marks the day used up in this
  // process, whatever the outcome was — a night that failed has still had its
  // look, and the day gate is one look a day. A run that stood down without
  // looking (the migration is pending) passes false, so the night can still
  // happen once the reader presses the button.
  leave(day: string, finished: boolean): void;
}

// The day is held in memory beside the state file rather than instead of it.
// The file is the waterline across restarts; this is the one thing the file
// cannot be, which is correct between a run starting and that run's write
// landing — and it still holds when the write fails outright.
export function createDreamGate(): DreamGate {
  let running = false;
  let finishedOn: string | null = null;
  return {
    enter(day) {
      // Set before any await, which is what makes this a gate at all: two
      // callers on the same tick both reach here, and only the first finds
      // `running` false.
      if (running || finishedOn === day) return false;
      running = true;
      return true;
    },
    leave(day, finished) {
      running = false;
      if (finished) finishedOn = day;
    },
  };
}
