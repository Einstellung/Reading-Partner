// Who starts the photograph search (src/info/meals/photo-sweep.ts).
//
// The bug this closes: the phone applied a week, delegated a `meals-photos`
// run, and executed it itself — a local run is run by whoever asks for it — so
// the machine with the hidden webview was never told and the week stayed
// pictureless (pitfall 380). The pass below is the machine that can search
// deciding for itself, off the synced week.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  createPhotoSearcher,
  MEALS_PHOTOS_PULL_ROUTE,
  watchMealsForPhotos,
  type PhotoSearcher,
  type PhotoSweepPorts,
  type PhotoSweepResult,
} from "../../../src/info/meals/photo-sweep";
import type { StartedPhotoRun } from "../../../src/info/meals/photo-run";
import { dispatchPull } from "../../../src/platform/sync/pull-routes";
import type { DishPhotoEntry, MealsState } from "../../../src/info/meals/types";
import { state, week } from "./fixtures/week";

const NOW = 1_000_000;

interface Harness {
  ports: PhotoSweepPorts;
  searcher: PhotoSearcher;
  // Every run asked for, by the names it was given.
  asked: string[][];
  // Settles the run started last.
  finish: () => void;
}

function harness(
  over: {
    canSearch?: boolean;
    state?: MealsState;
    photos?: Record<string, DishPhotoEntry>;
    run?: PhotoSweepPorts["run"];
  } = {},
): Harness {
  const h: Harness = {
    asked: [],
    finish: () => {},
    ports: null as unknown as PhotoSweepPorts,
    searcher: null as unknown as PhotoSearcher,
  };
  h.ports = {
    canSearch: () => over.canSearch ?? true,
    state: async () => over.state ?? state(),
    photos: async () => over.photos ?? {},
    run:
      over.run ??
      (async (_planId, queries): Promise<StartedPhotoRun> => {
        h.asked.push(queries.map((q) => q.key));
        return {
          id: `run-${h.asked.length}`,
          done: new Promise<void>((resolve) => {
            h.finish = resolve;
          }),
        };
      }),
    bankImage: (en) => (UNBANKED.has(en) ? null : `https://themealdb/${en}.png`),
    now: () => NOW,
  };
  h.searcher = createPhotoSearcher(h.ports);
  return h;
}

// Every photograph the fixture week wants when nothing has been found yet: its
// seven made meals by searchName, then the two foods the bank below has no
// cut-out of. The bank covers the rest so the week stays under the run's cap.
const WHOLE_WEEK = [
  "dish:greek yogurt bowl",
  "dish:shrimp rice bowl",
  "dish:teriyaki salmon bowl",
  "dish:yogurt banana",
  "dish:egg toast",
  "dish:tuna pita",
  "dish:chicken sweet potato salad",
  "ingredient:salmon",
  "ingredient:bok choy",
];

const UNBANKED = new Set(["salmon", "bok choy"]);

function found(at: number): DishPhotoEntry {
  return {
    url: "https://cdn.example/a.jpg",
    thumb: "",
    pageUrl: "https://example.com/a",
    site: "example.com",
    foundAt: at,
  };
}

function everything(at: number): Record<string, DishPhotoEntry> {
  return Object.fromEntries(WHOLE_WEEK.map((key) => [key, found(at)]));
}

test("the machine that can search searches for everything the week is missing", async () => {
  const h = harness();
  const result = await h.searcher.sweep();
  expect(result.runId).toBe("run-1");
  expect(result.queries).toBe(WHOLE_WEEK.length);
  expect(h.asked).toEqual([WHOLE_WEEK]);
});

// The phone. It has no hidden webview, so it asks for nothing at all — not even
// a run it would then execute itself and answer every query with nothing.
test("a machine with no webview starts nothing, whatever the week wants", async () => {
  const h = harness({ canSearch: false });
  expect(await h.searcher.sweep()).toEqual({
    runId: null,
    queries: 0,
    why: "cannot-search",
  } satisfies PhotoSweepResult);
  expect(await h.searcher.start("week-1", [{ key: "dish:x", q: "x" }])).toBeNull();
  expect(h.asked).toEqual([]);
});

test("no week and a week with every picture already found ask for nothing", async () => {
  const empty = harness({ state: state({ plan: null }) });
  expect((await empty.searcher.sweep()).why).toBe("no-week");

  const done = harness({ photos: everything(NOW - 1) });
  expect((await done.searcher.sweep()).why).toBe("nothing-wanted");
  expect(done.asked).toEqual([]);
});

// Twenty page loads in a real browser is a couple of minutes, and both a pull
// and an Apply can land inside it.
test("one run at a time, and the lane opens again when it is over", async () => {
  const h = harness();
  expect((await h.searcher.sweep()).runId).toBe("run-1");
  expect(h.searcher.searching()).toBe(true);
  expect((await h.searcher.sweep()).why).toBe("busy");
  // An Apply on this machine takes the same lane as the pass.
  expect(await h.searcher.start(week().id, [{ key: "dish:x", q: "x" }])).toBeNull();
  expect(h.asked.length).toBe(1);

  h.finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.searcher.searching()).toBe(false);
  expect((await h.searcher.sweep()).runId).toBe("run-2");
  expect(h.asked.length).toBe(2);
});

// Two callers in the same tick: the guard is taken before the first await, so
// the second is turned away rather than both writing an ask.
test("two passes started together start one run", async () => {
  const h = harness();
  const [first, second] = await Promise.all([h.searcher.sweep(), h.searcher.sweep()]);
  expect([first.runId, second.runId].filter(Boolean).length).toBe(1);
  expect(h.asked.length).toBe(1);
});

// The reader said a picture is wrong. They said it on the phone, which cannot
// search, so what reaches this machine is the moment they asked.
test("the reader's ask makes the whole week stale again", async () => {
  const cached = everything(NOW - 10_000);
  const quiet = harness({ photos: cached });
  expect((await quiet.searcher.sweep()).why).toBe("nothing-wanted");

  const asked = harness({
    photos: cached,
    state: state({ photosAskedAt: NOW - 5_000 }),
  });
  const result = await asked.searcher.sweep();
  expect(result.queries).toBe(WHOLE_WEEK.length);
  expect(asked.asked).toEqual([WHOLE_WEEK]);

  // An ask from before the pictures were found changes nothing.
  const stale = harness({ photos: cached, state: state({ photosAskedAt: NOW - 20_000 }) });
  expect((await stale.searcher.sweep()).why).toBe("nothing-wanted");
});

test("a run that cannot be started leaves the lane open", async () => {
  const h = harness({
    run: async () => {
      throw new Error("no runner");
    },
  });
  expect((await h.searcher.sweep()).why).toBe("failed");
  expect(h.searcher.searching()).toBe(false);
});

test("a week that cannot be read is not a week with nothing to search for", async () => {
  const h = harness();
  h.ports.state = async () => {
    throw new Error("unreadable");
  };
  expect((await createPhotoSearcher(h.ports).sweep()).why).toBe("failed");
});

// What tells this machine that the week was applied on the other one.
test("a pull of the week or the cache starts a pass, and stops when the route goes", () => {
  expect(MEALS_PHOTOS_PULL_ROUTE.matches("info-meals.json")).toBe(true);
  expect(MEALS_PHOTOS_PULL_ROUTE.matches("info-meals-photos.json")).toBe(true);
  expect(MEALS_PHOTOS_PULL_ROUTE.matches("info-labs.json")).toBe(false);

  let sweeps = 0;
  const searcher: PhotoSearcher = {
    sweep: async () => {
      sweeps += 1;
      return { runId: null, queries: 0, why: "nothing-wanted" };
    },
    start: async () => null,
    searching: () => false,
  };
  const off = watchMealsForPhotos(searcher);
  // One on the way up: the app may have been closed while the other device
  // planned the week.
  expect(sweeps).toBe(1);
  dispatchPull(["info-meals.json", "library.json"]);
  expect(sweeps).toBe(2);
  dispatchPull(["info-meals-photos.json"]);
  expect(sweeps).toBe(3);
  dispatchPull(["library.json"]);
  expect(sweeps).toBe(3);
  off();
  dispatchPull(["info-meals.json"]);
  expect(sweeps).toBe(3);
});
