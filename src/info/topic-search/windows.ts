// How far back a topic search run reads, per source (docs/info/88 两种 run).
// Every window the run and the builder use is named here.
//
// X and arXiv differ on the first run: X's top-sorted search with `since:`
// reads the last 30 days, while arXiv reads a year, because papers on a narrow
// topic are sparse enough that a 30-day window mostly comes back empty
// (2026-10-16: five of six first-run queries found nothing). A daily run reads
// both from the last run on.

export const DAY_MS = 86_400_000;

/** X: how far back the first run's `since:` reaches. */
export const X_FIRST_LOOK_BACK_DAYS = 30;
/** The first run's window start, epoch ms before now; also a daily run's when the search never ran. */
export const FIRST_LOOK_BACK_MS = X_FIRST_LOOK_BACK_DAYS * DAY_MS;

/** arXiv: how far back the first run's submittedDate window reaches. */
export const ARXIV_FIRST_LOOK_BACK_DAYS = 365;

/** Local date of an instant, YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A YYYY-MM-DD day moved by `n` days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The arXiv window of a run, local days, both inclusive: a year back on the
 * first run, from the run's `since` (the last run) on a daily one.
 */
export function arxivWindow(kind: "first" | "daily", since: number, today: string): { since: string; until: string } {
  return { since: kind === "first" ? addDays(today, -ARXIV_FIRST_LOOK_BACK_DAYS) : localDay(since), until: today };
}
