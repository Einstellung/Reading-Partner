// What a kind of background work can say about its own runs, beyond the run
// record (docs/55): the door's background_status tool (tool.ts) prints the
// generic entry for every run and asks the kind's describer, when one is
// registered, for the headline and the details. A domain registers its
// describer at startup the way it registers its worker; legion knows nothing
// else about the work, and a kind with no describer still gets the generic
// entry.

import type { DeviceClaim } from "../claim";
import type { Run } from "../run";

/** What a run is about, for its headline and for the tool's `about` filter. */
export interface RunAbout {
  /** One line naming the work ("topic search \"Proteins\": retry #1 of the first look"). */
  title: string;
  /** Ids and names the `about` filter matches, case-insensitively. */
  subjects: string[];
  /** A run that ended done without doing the work: why. */
  skipped?: string | null;
}

/** One run as the tool sees it, handed to a describer's detail. */
export interface RunView {
  run: Run;
  now: number;
  /** This device executes (or executed) the run, so its local files are the run's own. */
  here: boolean;
  /** The claim of the device executing it, as this device last synced it; null when unknown or not claimed. */
  claimant: DeviceClaim | null;
  /** The claims this device sees, its own included. */
  claims: readonly DeviceClaim[];
  /** This device's id. */
  deviceId: string;
  /** "4 min ago", "2 h 5 min ago": never hand the model a timestamp to subtract. */
  ago(at: number): string;
  /** "today 10:42", "yesterday 23:10", "2026-10-15 09:00", local time. */
  when(at: number): string;
}

export interface RunDescriber {
  kind: string;
  about(run: Run): Promise<RunAbout>;
  /** Detail lines, computed by the program; never raw logs or fetched text. */
  detail?(view: RunView): Promise<string[]>;
}

const describers = new Map<string, RunDescriber>();

/** Hand legion a kind's describer. Registering a kind again replaces it. Returns the unregister. */
export function registerRunDescriber(describer: RunDescriber): () => void {
  describers.set(describer.kind, describer);
  return () => {
    if (describers.get(describer.kind) === describer) describers.delete(describer.kind);
  };
}

export function describerFor(kind: string): RunDescriber | null {
  return describers.get(kind) ?? null;
}
