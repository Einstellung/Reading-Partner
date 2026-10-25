// Writing the week's recipes before anyone opens them (docs/73 做法页).
//
// The page shows the stored steps at once; a recipe still missing when the
// page opens is written there, with the reader watching. So every device
// writes, in the background, the recipes of the meals still ahead, one at a
// time, on the everyday tier. The moments are the drawings' (dish-draw-sweep.ts):
// the meals screen switched on at start-up, a pull that writes the week, and a
// week written on this device (meals/live.ts).
//
// What it writes is exactly what the page would ask for: the same view of the
// day and the same request builder, so the key is the page's and the stored
// entry is the one the page reads. The call goes through writeRecipeOnce, so a
// page opened on a meal being written waits on this call, and a meal the page
// is already writing is not written a second time.
//
// Cost: one call per recipe key, ever; at most MAX_RECIPES_PER_ROUND a round,
// soonest meal first, so a new week is spread over a few rounds with the next
// meals done first. Past days are not written: the screen no longer shows
// them. A failed call is not written down as anything: the round stops and
// this device waits before the next one, longer each time it fails again.

import type { Locale } from "../../../i18n/locale";
import { registerPullRoute } from "../../../platform/sync/pull-routes";
import type { Region } from "../nutrition/targets";
import { MEALS_FILE } from "../plan/store";
import type { MealsState } from "../plan/types";
import { dayViewOn } from "../screen/view";
import { recipeRequest, type RecipeRequest } from "./recipe";

export const MAX_RECIPES_PER_ROUND = 6;

// The wait after a failed call, doubled for each failure in a row.
export const RECIPE_BACKOFF_MS = 15 * 60 * 1000;
export const RECIPE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

export function recipeBackoffAfter(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(RECIPE_BACKOFF_MS * 2 ** (failures - 1), RECIPE_BACKOFF_MAX_MS);
}

/**
 * The recipes the week still lacks, soonest first: the requests the page
 * would make for every made meal from `today` on, in the order the days are
 * eaten, without the keys already stored. One request per key.
 */
export function recipesToWrite(
  state: MealsState,
  opts: {
    today: string;
    region: Region;
    language: Locale;
    stored: ReadonlySet<string>;
    limit?: number;
  },
): RecipeRequest[] {
  const profile = state.charter?.profile;
  if (!state.plan || !profile) return [];
  const dates = state.plan.days.map((d) => d.date).filter((d) => d >= opts.today).sort();
  const seen = new Set(opts.stored);
  const out: RecipeRequest[] = [];
  for (const date of dates) {
    const day = dayViewOn(state, date, opts.today, opts.region);
    for (const view of day?.meals ?? []) {
      const request = recipeRequest(view, profile, opts.language);
      if (!request || seen.has(request.key)) continue;
      seen.add(request.key);
      out.push(request);
    }
  }
  return out.slice(0, opts.limit ?? MAX_RECIPES_PER_ROUND);
}

/** Everything the sweep touches, so it is testable without a host. */
export interface RecipeSweepPorts {
  state(): Promise<MealsState>;
  /** The language a recipe asked for now is written in. */
  language(): Promise<Locale>;
  region(): Region;
  /** The keys stored right now, synced from the other device included. */
  stored(): Promise<ReadonlySet<string>>;
  /** Write and keep one recipe, or throw. */
  write(request: RecipeRequest): Promise<unknown>;
  /** The host's local date. */
  today(): string;
  now(): number;
}

export type RecipeSweepSkip = "busy" | "backing-off" | "no-week" | "nothing-wanted" | "failed";

export interface RecipeSweepResult {
  /** Recipes written this round. */
  written: number;
  /** Recipes the round set out to write. */
  wanted: number;
  /** Why the round wrote nothing, or stopped short. */
  why?: RecipeSweepSkip;
}

export interface RecipeWriter {
  /** Write what the week still lacks. Safe to call as often as anything likes. */
  sweep(): Promise<RecipeSweepResult>;
  /** Whether a round is going. */
  writing(): boolean;
}

export function createRecipeWriter(ports: RecipeSweepPorts): RecipeWriter {
  let busy = false;
  // Asked again while a round ran: the week may have changed under it.
  let again = false;
  let failures = 0;
  let pausedUntil = 0;

  async function round(): Promise<RecipeSweepResult> {
    if (ports.now() < pausedUntil) return { written: 0, wanted: 0, why: "backing-off" };
    const state = await ports.state();
    if (!state.plan) return { written: 0, wanted: 0, why: "no-week" };
    const wanted = recipesToWrite(state, {
      today: ports.today(),
      region: ports.region(),
      language: await ports.language(),
      stored: await ports.stored(),
    });
    if (!wanted.length) return { written: 0, wanted: 0, why: "nothing-wanted" };
    let written = 0;
    for (const request of wanted) {
      // The other device may have written it since the round began.
      if ((await ports.stored()).has(request.key)) continue;
      try {
        await ports.write(request);
      } catch {
        failures += 1;
        pausedUntil = ports.now() + recipeBackoffAfter(failures);
        return { written, wanted: wanted.length, why: "failed" };
      }
      failures = 0;
      written += 1;
    }
    return { written, wanted: wanted.length };
  }

  async function sweep(): Promise<RecipeSweepResult> {
    if (busy) {
      again = true;
      return { written: 0, wanted: 0, why: "busy" };
    }
    // Set before the first await: two callers in the same tick must not both
    // get past this line.
    busy = true;
    try {
      let result: RecipeSweepResult;
      do {
        again = false;
        result = await round();
      } while (again && result.why !== "failed" && result.why !== "backing-off");
      return result;
    } catch {
      return { written: 0, wanted: 0, why: "failed" };
    } finally {
      busy = false;
      again = false;
    }
  }

  return { sweep, writing: () => busy };
}

/**
 * One round now, and one on every pull that writes the week. Returns the
 * undo, which is what a test uses.
 */
export function watchMealsForRecipes(writer: RecipeWriter): () => void {
  const off = registerPullRoute({
    id: "meals-recipes",
    matches: (path) => path === MEALS_FILE,
    onPulled: () => {
      void writer.sweep();
    },
  });
  void writer.sweep();
  return off;
}
