// The two things that have to be true before a night starts, neither of which
// the state file can answer: no other run is already in flight, and the store
// under it is not still half-migrated.
//
// Pure, so both are testable. live.ts holds one gate for the process and does
// the listing; the rules are here.
//
// Both exist because of what 0.12 did on the owner's machine (docs/pitfall/210).
// runDreamIfDue is called from three entry points — start-up, foreground and the
// five-minute tick — and the state file is written at the END of a run, so four
// calls inside 35 seconds all read "not run today" and all four ran. Two of them
// wrote the same ten conclusions twice, once in each language. On the same
// launch the night read observations that still had 8 hex ids and wrote
// statements whose evidence named them; the migration renamed every one of those
// files twenty seconds later, and every statement it had written pointed at
// nothing.

// An observation entry file that the 0.12 widening has not reached yet
// (migrate/steps.ts, step 6). Anchored at both ends: a widened file is
// m-<16 hex>.md and must not match, or the gate would never open again.
const NARROW_ENTRY_FILE = /^m-[0-9a-f]{8}\.md$/;

export function hasNarrowObservationFile(names: Iterable<string>): boolean {
  for (const name of names) {
    if (NARROW_ENTRY_FILE.test(name)) return true;
  }
  return false;
}

// Whether any topic still holds a narrow entry file. One directory listing per
// topic, on the same tick that would otherwise have paid for a model call.
//
// It asks the files rather than a migration flag on purpose: the migration
// deliberately keeps no applied-state (migrate/types.ts), and a flag that synced
// from the device that ran it would say "done" on a device whose own files are
// still narrow.
export async function migrationPending(
  dirs: readonly string[],
  listDir: (dir: string) => Promise<string[]>,
): Promise<boolean> {
  for (const dir of dirs) {
    if (hasNarrowObservationFile(await listDir(dir))) return true;
  }
  return false;
}

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
