// Who starts the photograph search, and when (docs/73 图片).
//
// The search runs in a hidden webview, which one machine in the house has. The
// week is written on whichever machine the reader is holding, which is usually
// the phone. Those are not the same machine, and a `local` run is executed by
// whoever delegates it — so the trigger cannot be a run sent from the phone
// (pitfall 380). It is this: the machine that can search reads the synced week
// and the synced cache, works out what is still missing, and searches for it.
//
// Three moments, all of them the same pass:
//
//   - the app starts and the meals screen is switched on;
//   - a sync pull writes the week or the cache, which is the plan the reader
//     applied on the phone arriving here;
//   - a plan is applied on this machine, which goes through `start` below so
//     that it cannot race the pass above.
//
// One run at a time. Twenty page loads in a real browser is a couple of
// minutes; two passes overlapping would search the same names twice and write
// each other's answers back.

import { hasWebviewFetch } from "../../../platform/app/platform";
import { registerPullRoute, type PullMatcher } from "../../../platform/sync/pull-routes";
import type { PhotoCache } from "./dish-photos";
import { ingredientImageUrl } from "./images";
import {
  photoQueriesForPlan,
  startPhotoRun,
  type PhotoQuery,
  type StartedPhotoRun,
} from "./photo-run";
import { loadMealsPhotos, MEALS_PHOTOS_FILE } from "./photo-store";
import { loadMeals, MEALS_FILE } from "../plan/store";
import type { MealsState } from "../plan/types";

// The week and the cache, arriving from the other device. Nothing here holds
// either file in memory — both stores read from disk on every call — so this
// route is not a cache to drop; it is the only thing that tells the searching
// machine that there is something new to look for.
export const MEALS_PHOTOS_PULL_ROUTE: PullMatcher = {
  id: "meals",
  matches: (path) => path === MEALS_FILE || path === MEALS_PHOTOS_FILE,
};

/** Everything the pass touches, so it is testable without a host. */
export interface PhotoSweepPorts {
  /** Whether this machine has the hidden webview the search needs. */
  canSearch(): boolean;
  /** The week, the way it is on disk right now. */
  state(): Promise<MealsState>;
  /** The photographs found so far, by cache key. */
  photos(): Promise<PhotoCache>;
  /** Start the run. Null when there was nothing to start. */
  run(planId: string, queries: readonly PhotoQuery[]): Promise<StartedPhotoRun | null>;
  /** Whether a picture bank already has artwork for an ingredient. */
  bankImage(en: string): string | null;
  now(): number;
}

/** Why a pass started nothing. */
export type PhotoSweepSkip =
  | "cannot-search"
  | "busy"
  | "no-week"
  | "nothing-wanted"
  | "failed";

export interface PhotoSweepResult {
  /** The run started, or null when none was. */
  runId: string | null;
  /** How many names it is searching for. Zero when nothing was started. */
  queries: number;
  /** Absent when a run was started. */
  why?: PhotoSweepSkip;
}

export interface PhotoSearcher {
  /**
   * Work out what the week is still missing and search for it. Safe to call
   * from anywhere and as often as anything likes: it answers `busy` while a
   * run is going and `cannot-search` on a machine that has no webview.
   */
  sweep(): Promise<PhotoSweepResult>;
  /**
   * Search for exactly these queries. What an Apply on this machine uses, so
   * that it takes the same one-at-a-time lane as the pass. The run's id, or
   * null when this machine cannot search or is already searching.
   */
  start(planId: string, queries: readonly PhotoQuery[]): Promise<string | null>;
  /** Whether a run started here is still going. */
  searching(): boolean;
}

export function createPhotoSearcher(ports: PhotoSweepPorts): PhotoSearcher {
  let busy = false;

  async function start(planId: string, queries: readonly PhotoQuery[]): Promise<string | null> {
    if (!ports.canSearch() || busy || queries.length === 0) return null;
    // Set before the first await: two callers in the same tick must not both
    // get past this line.
    busy = true;
    let started: StartedPhotoRun | null = null;
    try {
      started = await ports.run(planId, queries);
    } catch {
      // A run that could not be written is a week drawn from its ingredients,
      // which is what the screen shows anyway. The next pass tries again.
      started = null;
    }
    if (!started) {
      busy = false;
      return null;
    }
    // Held until the searching is over, not until it was handed off: the run is
    // local, so it is this process doing the page loads.
    void Promise.resolve(started.done).then(
      () => {
        busy = false;
      },
      () => {
        busy = false;
      },
    );
    return started.id;
  }

  async function sweep(): Promise<PhotoSweepResult> {
    if (!ports.canSearch()) return { runId: null, queries: 0, why: "cannot-search" };
    if (busy) return { runId: null, queries: 0, why: "busy" };
    let queries: PhotoQuery[];
    let planId: string;
    try {
      const state = await ports.state();
      if (!state.plan) return { runId: null, queries: 0, why: "no-week" };
      planId = state.plan.id;
      queries = photoQueriesForPlan(state.plan, await ports.photos(), ports.now(), {
        bankImage: ports.bankImage,
        askedAt: state.photosAskedAt ?? 0,
      });
    } catch {
      return { runId: null, queries: 0, why: "failed" };
    }
    if (queries.length === 0) return { runId: null, queries: 0, why: "nothing-wanted" };
    // A week wanting more than one run's worth (MAX_PHOTO_QUERIES) gets the
    // rest at the next pass — the next pull, the next Apply, the next start.
    const runId = await start(planId, queries);
    if (!runId) return { runId: null, queries: 0, why: busy ? "busy" : "failed" };
    return { runId, queries: queries.length };
  }

  return { sweep, start, searching: () => busy };
}

// --- the live one -------------------------------------------------------------

let live: PhotoSearcher | null = null;

/** This machine's searcher. One, so that "one run at a time" means anything. */
export function mealsPhotoSearcher(): PhotoSearcher {
  live ??= createPhotoSearcher({
    canSearch: hasWebviewFetch,
    state: () => loadMeals(),
    photos: () => loadMealsPhotos(),
    run: (planId, queries) => startPhotoRun({ planId, queries: [...queries] }),
    bankImage: (en) => ingredientImageUrl(en),
    now: () => Date.now(),
  });
  return live;
}

/**
 * One pass now, and one on every pull that writes the week or the cache.
 * Returns the undo, which is what a test uses; nothing else gives it up.
 */
export function watchMealsForPhotos(searcher: PhotoSearcher): () => void {
  const off = registerPullRoute({
    ...MEALS_PHOTOS_PULL_ROUTE,
    onPulled: () => {
      void searcher.sweep();
    },
  });
  void searcher.sweep();
  return off;
}

let housekeeping = false;

/**
 * Start looking after the week's photographs on this machine.
 *
 * Called when the meals screen is switched on, from the shell's bootstrap.
 * Idempotent, and never stopped: it costs a route and a read of two files, and
 * the app outlives every screen that could have turned it off.
 */
export function startMealsPhotoHousekeeping(): void {
  if (housekeeping) return;
  housekeeping = true;
  watchMealsForPhotos(mealsPhotoSearcher());
}
