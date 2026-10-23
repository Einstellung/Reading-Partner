// Who draws the week's dish pictures, and when (docs/73 图片).
//
// Any device whose provider can draw (ai/image-generation.ts) does it, in the
// background, one dish at a time: the screen shows the ingredient strip until a
// picture lands and never waits on one. A device that cannot draw writes
// nothing at all. The moments are the photo search's (photo-sweep.ts): the
// meals screen switched on at start-up, a pull that writes the week or the
// cache, and a plan applied or the pictures asked for again on this device.
//
// Cost: one picture per dish key, ever, until the reader says the pictures are
// wrong; at most MAX_DRAWINGS_PER_ROUND a round; a claim written into the synced
// cache before the paid call, so the phone and the PC do not both draw the same
// dish. A failed call is not written down as "no picture": the round stops,
// takes back its claims on the dishes it did not draw, and this device waits
// before the next one, longer each time it fails again. Meanwhile the search
// treats this device as one that cannot draw (mealsCanDraw), so a provider that
// refuses pictures leaves the dishes to the image search as before.

import { generateImage, imageGenerationReady, type GeneratedImage } from "../../../ai/image-generation";
import { registerPullRoute, type PullMatcher } from "../../../platform/sync/pull-routes";
import type { PhotoCache } from "./dish-photos";
import { claimEntry, DRAWINGS_DIR, dishesToDraw } from "./dish-drawing";
import {
  loadMealsPhotos,
  MEALS_PHOTOS_FILE,
  releaseDrawingClaims,
  saveDrawingFile,
  savePhotoEntries,
} from "./photo-store";
import { loadMeals, MEALS_FILE } from "../plan/store";
import type { DishPhotoEntry, MealsState } from "../plan/types";

// The wait after a failed call, doubled for each failure in a row. The first
// matches the claim's lapse (DRAWING_CLAIM_MS), which keeps this device off the
// dish that long anyway.
export const DRAW_BACKOFF_MS = 15 * 60 * 1000;
export const DRAW_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

/** Everything the pass touches, so it is testable without a host. */
export interface DishDrawPorts {
  /** Whether this device's provider can draw at all. */
  canDraw(): Promise<boolean>;
  state(): Promise<MealsState>;
  photos(): Promise<PhotoCache>;
  draw(prompt: string): Promise<GeneratedImage>;
  /** Keep a picture's bytes, answering the path. */
  saveFile(bytes: Uint8Array, mediaType: string): Promise<string>;
  save(entries: Record<string, DishPhotoEntry>): Promise<unknown>;
  /** Take back the claims written at `since` on these keys. */
  release(keys: readonly string[], since: number): Promise<unknown>;
  now(): number;
  /** A picture landed: the screen re-reads the cache. */
  landed?(): void;
  /** A call failed: the search may take the dishes over. */
  failed?(): void;
}

export type DishDrawSkip = "unavailable" | "busy" | "backing-off" | "no-week" | "nothing-wanted" | "failed";

export interface DishDrawResult {
  /** Pictures drawn and kept this round. */
  drawn: number;
  /** Dishes the round set out to draw. */
  wanted: number;
  /** Why the round drew nothing, or stopped short. */
  why?: DishDrawSkip;
}

export interface DishDrawer {
  /** Draw what the week still has no picture of. Safe to call as often as anything likes. */
  sweep(): Promise<DishDrawResult>;
  /** Whether a round is going. */
  drawing(): boolean;
  /** Whether the last call this device made failed and none has worked since. */
  failing(): boolean;
}

export function backoffAfter(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(DRAW_BACKOFF_MS * 2 ** (failures - 1), DRAW_BACKOFF_MAX_MS);
}

export function createDishDrawer(ports: DishDrawPorts): DishDrawer {
  let busy = false;
  let failures = 0;
  let pausedUntil = 0;

  async function round(): Promise<DishDrawResult> {
    if (ports.now() < pausedUntil) return { drawn: 0, wanted: 0, why: "backing-off" };
    if (!(await ports.canDraw().catch(() => false))) return { drawn: 0, wanted: 0, why: "unavailable" };
    const state = await ports.state();
    if (!state.plan) return { drawn: 0, wanted: 0, why: "no-week" };
    const cache = await ports.photos();
    const wanted = dishesToDraw(state.plan, cache, ports.now(), { askedAt: state.photosAskedAt ?? 0 });
    if (!wanted.length) return { drawn: 0, wanted: 0, why: "nothing-wanted" };
    const since = ports.now();
    await ports.save(Object.fromEntries(wanted.map((d) => [d.key, claimEntry(cache[d.key], since)])));
    let drawn = 0;
    for (const [i, dish] of wanted.entries()) {
      const image = await ports.draw(dish.prompt);
      if (!image.ok) {
        // A provider that refused one dish refuses the next: the rest wait,
        // their claims taken back, and nothing says the dishes have no picture.
        await ports.release(wanted.slice(i).map((d) => d.key), since).catch(() => {});
        if (image.unavailable) return { drawn, wanted: wanted.length, why: "unavailable" };
        failures += 1;
        pausedUntil = ports.now() + backoffAfter(failures);
        ports.failed?.();
        return { drawn, wanted: wanted.length, why: "failed" };
      }
      failures = 0;
      const path = await ports.saveFile(image.bytes, image.mediaType);
      await ports.save({ [dish.key]: { drawing: path, drawnAt: ports.now() } });
      drawn += 1;
      ports.landed?.();
    }
    return { drawn, wanted: wanted.length };
  }

  async function sweep(): Promise<DishDrawResult> {
    if (busy) return { drawn: 0, wanted: 0, why: "busy" };
    // Set before the first await: two callers in the same tick must not both
    // get past this line.
    busy = true;
    try {
      return await round();
    } catch {
      return { drawn: 0, wanted: 0, why: "failed" };
    } finally {
      busy = false;
    }
  }

  return { sweep, drawing: () => busy, failing: () => failures > 0 };
}

// --- the live one -------------------------------------------------------------

const listeners = new Set<() => void>();
const failureListeners = new Set<() => void>();

/** Be told when a picture drawn on this device lands. Returns the undo. */
export function onDishDrawn(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Be told when a drawing on this device fails. Returns the undo. */
export function onDishDrawFailed(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

let live: DishDrawer | null = null;

/** This device's drawer. One, so that "one round at a time" means anything. */
export function mealsDishDrawer(): DishDrawer {
  live ??= createDishDrawer({
    canDraw: () => imageGenerationReady(),
    state: () => loadMeals(),
    photos: () => loadMealsPhotos(),
    draw: (prompt) => generateImage(prompt, { caller: "info" }),
    saveFile: (bytes, mediaType) => saveDrawingFile(bytes, mediaType),
    save: (entries) => savePhotoEntries(entries),
    release: (keys, since) => releaseDrawingClaims(keys, since),
    now: () => Date.now(),
    landed: () => {
      for (const listener of listeners) listener();
    },
    failed: () => {
      for (const listener of failureListeners) listener();
    },
  });
  return live;
}

/**
 * Whether the week's dishes are this device's to draw rather than to search:
 * its provider draws, and its last call did not fail. What the search and the
 * reader's "the pictures are wrong" ask; the drawer itself asks only whether
 * the provider draws, so that it tries again after its wait.
 */
export async function mealsCanDraw(): Promise<boolean> {
  return !mealsDishDrawer().failing() && (await imageGenerationReady());
}

/**
 * What the meals screen re-reads on (use-meals.ts): the week, the cache, and a
 * drawn picture's file, which can arrive on a later pull than the entry that
 * points at it.
 */
export const MEALS_PICTURES_PULL_ROUTE: PullMatcher = {
  id: "meals-screen-pictures",
  matches: (path) => path === MEALS_FILE || path === MEALS_PHOTOS_FILE || path.startsWith(`${DRAWINGS_DIR}/`),
};

/**
 * One round now, and one on every pull that writes the week or the cache.
 * Returns the undo, which is what a test uses.
 */
export function watchMealsForDrawings(drawer: DishDrawer): () => void {
  const off = registerPullRoute({
    id: "meals-drawings",
    matches: (path) => path === MEALS_FILE || path === MEALS_PHOTOS_FILE,
    onPulled: () => {
      void drawer.sweep();
    },
  });
  void drawer.sweep();
  return off;
}
