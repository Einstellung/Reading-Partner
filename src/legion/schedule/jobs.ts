// Work every device does for itself once a night, on the schedule's clock.
//
// A schedule (schedule.ts) is one machine's hour and ends in a wake bell for
// the soul. A nightly job is the other shape: every device owes it for its own
// disk, nobody is elected and nothing is rung — the tick calls it. The
// housekeeper is the first (src/housekeeper, docs/80).
//
// The anchors are the schedule's: the most recent time of day gone by, caught
// up once after a sleep, armed and not run the first time a device meets the
// job. What this device last ran is kept in the same fired.json, under a
// `job:` key so a job and a schedule can share an id without sharing a stamp.

import { lastAnchor, type ScheduleAt } from "./schedule";

export interface NightlyJob {
  id: string;
  at: ScheduleAt;
  /** Called once per anchor. A rejection is logged and waits for the next anchor. */
  run(): Promise<void>;
}

export interface DueJob {
  job: NightlyJob;
  anchor: number;
  /** `run` — call it and write the anchor down; `arm` — only write it down. */
  action: "run" | "arm";
}

const jobs = new Map<string, NightlyJob>();

/** Register a nightly job. The same id again replaces it. Returns the undo. */
export function registerNightlyJob(job: NightlyJob): () => void {
  jobs.set(job.id, job);
  return () => {
    if (jobs.get(job.id) === job) jobs.delete(job.id);
  };
}

export function registeredNightlyJobs(): NightlyJob[] {
  return [...jobs.values()];
}

/** The key a job's last anchor is written down under in fired.json. */
export function jobFiredKey(id: string): string {
  return `job:${id}`;
}

/** What this device owes its nightly jobs, now. Pure. */
export function dueJobs(
  list: readonly NightlyJob[],
  lastFiredAt: Readonly<Record<string, number>>,
  now: number,
): DueJob[] {
  const out: DueJob[] = [];
  for (const job of list) {
    const anchor = lastAnchor(job.at, now);
    if (anchor === null) continue;
    const fired = lastFiredAt[jobFiredKey(job.id)];
    if (fired === undefined) out.push({ job, anchor, action: "arm" });
    else if (fired !== anchor) out.push({ job, anchor, action: "run" });
  }
  return out;
}
