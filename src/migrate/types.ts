// The 0.12 data migration: shapes shared by the steps and the report they
// hand back.
//
// This whole directory is temporary. It ships through 0.12 and is deleted
// wholesale at 0.13, so it stands on its own — nothing outside it imports it
// except the button that runs it, and it keeps no state of its own on disk.
//
// No stored version and no applied-state, deliberately. Every step inspects the
// data, decides whether it is still in the old shape and transforms it, so
// running the engine twice is a no-op and running it on half-migrated data
// finishes the job. A stored "already migrated" flag would sync to a device
// whose own local files were never migrated, and that device would then skip
// them forever.

// The few filesystem operations the engine needs, over AppData-relative paths
// with forward slashes. Narrower than AppDataFs so the whole engine runs
// headless in tests, and structurally a superset of ObservationFs so the
// observation store can be handed the same object.
export interface MigrationFs {
  // The file's text, or null when there is none.
  read(path: string): Promise<string | null>;
  // Replaces the file, creating the directory if it is missing.
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  // File names directly under a directory; "" is the app data root. [] when the
  // directory does not exist.
  listDir(path: string): Promise<string[]>;
  // Directory names directly under a directory. Separate from listDir because
  // the engine has to find the memory-<topicId>/ directories, and a listing that
  // mixed the two would make "is this a topic" a guess about the name.
  listSubdirs(path: string): Promise<string[]>;
}

// One thing a step refused to touch, and why. A refusal is reported rather than
// guessed at: the store is the reader's own memory and a wrong repair is worse
// than a visible gap.
export interface Refusal {
  what: string;
  why: string;
}

// How many concrete ids a step lists. A human reads this report against numbers
// they measured by hand, so a sample has to be long enough to spot-check and
// short enough to read.
export const SAMPLE_LIMIT = 12;

export interface StepReport {
  id: string;
  title: string;
  // Candidates the step looked at — anchors, messages, bodies, ids; what one is
  // is named by the step's title.
  scanned: number;
  // What it changed, or would have changed on a dry run.
  changed: number;
  // Candidates already in the new shape.
  skipped: number;
  unrepaired: Refusal[];
  // Numbers a step wants read against a measurement, keyed by what they count.
  counts: Record<string, number>;
  // A bounded sample of what changed, as concrete ids.
  samples: string[];
  // Set when a step made no change because it could not proceed safely; the
  // whole step is then a no-op, not a partial one.
  aborted?: string;
}

export interface MigrationReport {
  dryRun: boolean;
  // Where the files this run was about to touch were copied, before the first
  // write. Null on a dry run and on a real run that had nothing to change.
  backupDir: string | null;
  steps: StepReport[];
  // Every path the run wrote and removed, in the order it happened.
  written: string[];
  removed: string[];
}

export function emptyStep(id: string, title: string): StepReport {
  return { id, title, scanned: 0, changed: 0, skipped: 0, unrepaired: [], counts: {}, samples: [] };
}

export function sample(step: StepReport, text: string): void {
  if (step.samples.length < SAMPLE_LIMIT) step.samples.push(text);
}

export function refuse(step: StepReport, what: string, why: string): void {
  // Bounded like the samples, and for the same reason: 292 refusals would be a
  // wall of text nobody reads. The count is on `unrepairedTotal`.
  step.counts.unrepairedTotal = (step.counts.unrepairedTotal ?? 0) + 1;
  if (step.unrepaired.length < SAMPLE_LIMIT) step.unrepaired.push({ what, why });
}

export function totalChanges(report: MigrationReport): number {
  return report.steps.reduce((n, s) => n + s.changed, 0);
}
