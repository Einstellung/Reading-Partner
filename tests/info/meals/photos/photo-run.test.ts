// The photograph run: what a week asks for (src/info/meals/photos/photo-run.ts) and
// what the worker does with it (src/info/meals/photos/photo-worker.ts).
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  MEALS_PHOTOS_KIND,
  MAX_PHOTO_QUERIES,
  parsePhotoAsk,
  photoOutputLine,
  photoQueriesForPlan,
  startPhotoRun,
  type MealsPhotoAsk,
} from "../../../../src/info/meals/photos/photo-run";
import { mealsPhotosWorker } from "../../../../src/info/meals/photos/photo-worker";
import type { WebviewPage } from "../../../../src/info/extract/webview-page";
import type { DishPhotoEntry, Meal, WeekPlan } from "../../../../src/info/meals/plan/types";
import type { Run } from "../../../../src/legion/run/types";
import type { WorkerContext } from "../../../../src/legion/execute/worker";

// Tofu (en "firm tofu", protein aisle) and bok choy (en "bok choy", produce).
function meal(over: Partial<Meal> = {}): Meal {
  return {
    mode: "make",
    name: "麻婆豆腐饭",
    searchName: "mapo tofu",
    flavour: "spicy-sichuan",
    minutes: 10,
    items: [
      { foodId: "bok_choy", role: "fixed", grams: 150 },
      { foodId: "firm_tofu", role: "protein" },
    ],
    ...over,
  };
}

const SKIP: Meal = { mode: "skip" };

function week(meals: Meal[]): WeekPlan {
  return {
    id: "week-2026-09-21",
    startDate: "2026-09-21",
    days: meals.map((m, i) => ({
      date: `2026-09-${String(21 + (i % 7)).padStart(2, "0")}`,
      breakfast: SKIP,
      lunch: SKIP,
      dinner: m,
      snack: SKIP,
    })),
    createdAt: 0,
    revision: 1,
  };
}

const NOW = 1_000_000;
const noBank = () => null;

test("a week asks for its meals by searchName first, then the foods no bank has", () => {
  const queries = photoQueriesForPlan(week([meal()]), {}, NOW, {
    bankImage: (en) => (en === "firm tofu" ? "https://themealdb/tofu.png" : null),
  });
  expect(queries).toEqual([
    { key: "dish:mapo tofu", q: "mapo tofu" },
    { key: "ingredient:bok choy", q: "bok choy vegetable" },
  ]);
});

test("only made meals ask: a delivery with a searchName asks nothing", () => {
  const queries = photoQueriesForPlan(
    week([{ mode: "delivery", place: "downstairs", searchName: "pizza" }]),
    {},
    NOW,
    { bankImage: noBank },
  );
  expect(queries).toEqual([]);
});

test("what the cache already answered is not asked again, and the reader can ask anyway", () => {
  const cache: Record<string, DishPhotoEntry> = {
    "dish:mapo tofu": {
      url: "https://cdn/a.jpg",
      thumb: "",
      pageUrl: "https://example.com/a",
      site: "example.com",
      foundAt: 1,
    },
    "ingredient:bok choy": { none: true, checkedAt: NOW - 1000 },
  };
  expect(photoQueriesForPlan(week([meal()]), cache, NOW, { bankImage: noBank })).toEqual([
    { key: "ingredient:firm tofu", q: "firm tofu food" },
  ]);
  // The reader said a picture is wrong: everything answered before that moment
  // is asked again, wherever the searching happens.
  expect(
    photoQueriesForPlan(week([meal()]), cache, NOW, { bankImage: noBank, askedAt: NOW }).length,
  ).toBe(3);
  // An answer written since they asked stands: the dish was found before it and
  // is asked again, the bok choy was looked for after it and is not.
  expect(
    photoQueriesForPlan(week([meal()]), cache, NOW, { bankImage: noBank, askedAt: 2 }).map(
      (q) => q.key,
    ),
  ).toEqual(["dish:mapo tofu", "ingredient:firm tofu"]);
});

test("a name is asked for once however many days eat it, and a run is capped", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    meal({ searchName: `dish ${i}`, items: [{ foodId: "bok_choy", role: "fixed", grams: 150 }] }),
  );
  const queries = photoQueriesForPlan(week(many), {}, NOW, { bankImage: noBank });
  expect(queries.length).toBe(MAX_PHOTO_QUERIES);
  expect(queries.filter((q) => q.key === "ingredient:bok choy").length).toBeLessThan(2);
});

test("a meal with no searchName and a food with no English name ask nothing", () => {
  const queries = photoQueriesForPlan(
    week([
      meal({
        searchName: "",
        items: [
          // Frozen mixed veg has no English name in the food table.
          { foodId: "frozen_mixed_veg", role: "fixed", grams: 150 },
          { foodId: "bok_choy", role: "fixed", grams: 150 },
          { foodId: "no_such_food", role: "protein" },
        ],
      }),
    ]),
    {},
    NOW,
    { bankImage: noBank },
  );
  expect(queries).toEqual([{ key: "ingredient:bok choy", q: "bok choy vegetable" }]);
});

test("the ask is written, handed to legion, and read back", async () => {
  const ask: MealsPhotoAsk = {
    planId: "week-2026-09-21",
    queries: [{ key: "dish:mapo tofu", q: "mapo tofu" }],
  };
  let sent: { kind: string; brief: string; delegator: unknown } | null = null;
  const started = await startPhotoRun(ask, {
    write: async () => "legion/briefs/meals-photos-1.json",
    delegate: async (input) => {
      sent = { kind: input.kind, brief: input.brief, delegator: input.delegator };
      return {
        ok: true,
        run: { id: "run-1" } as Run,
        existing: false,
        done: Promise.resolve({ id: "run-1" } as Run),
      };
    },
  });
  expect(started?.id).toBe("run-1");
  // The run is local, so what comes back settles when the searching is over —
  // which is what keeps a second run from being started on top of it.
  expect(await started!.done).toEqual({ id: "run-1" } as Run);
  expect(sent!.kind).toBe(MEALS_PHOTOS_KIND);
  expect(sent!.brief).toBe("legion/briefs/meals-photos-1.json");
  // Nobody is owed a sentence about it: the pictures appear, that is all.
  expect(sent!.delegator).toEqual({ kind: "program", name: "meals" });

  expect(await startPhotoRun({ planId: "w", queries: [] }, { write: async () => "x" })).toBeNull();
  expect(parsePhotoAsk(JSON.stringify(ask))).toEqual(ask);
  expect(() => parsePhotoAsk("{")).toThrow();
  expect(() => parsePhotoAsk('{"planId":"w","queries":[]}')).toThrow();
});

test("the line the run leaves says what was asked and what was found", () => {
  expect(photoOutputLine(2, 3)).toBe("Searched for 3 photographs, found 2.");
  expect(photoOutputLine(0, 1)).toBe("Searched for 1 photograph, found 0.");
});

// --- the worker ---------------------------------------------------------------

function page(over: Partial<WebviewPage> = {}): WebviewPage {
  return {
    status: "ok",
    requestedUrl: "https://www.bing.com/images/search",
    finalUrl: null,
    title: null,
    html: null,
    result: null,
    elapsedMs: 1,
    detail: null,
    ...over,
  };
}

const RESULT = [
  JSON.stringify({
    murl: "https://cdn.example/mapo.jpg",
    turl: "https://ts3.mm.bing.net/th?id=1",
    purl: "https://www.example.com/mapo",
    t: "Mapo tofu",
  }),
];

function ctx(): WorkerContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    run: { id: "run-1" } as Run,
    report: async (text: string) => {
      lines.push(text);
    },
    reportTool: async () => {},
    delegate: async () => ({ ok: false, reason: "no children" }),
  };
}

const ASK = JSON.stringify({
  planId: "week-2026-09-21",
  queries: [
    { key: "dish:mapo tofu", q: "mapo tofu" },
    { key: "ingredient:kale", q: "kale vegetable" },
  ],
});

test("each search is written as it lands, and the run says how it went", async () => {
  const written: Record<string, DishPhotoEntry>[] = [];
  const asked: string[] = [];
  const worker = mealsPhotosWorker({
    canSearch: () => true,
    readAsk: async () => ASK,
    fetchPage: async (url, opts) => {
      asked.push(url);
      expect(opts.script).toContain("a.iusc");
      return page({ result: asked.length === 1 ? RESULT : [] });
    },
    savePhotos: async (entries) => {
      written.push(entries);
    },
    writeOutput: async (_id, text) => `out:${text}`,
    now: () => NOW,
    wait: async () => {},
  });
  const c = ctx();
  const out = await worker("brief", c).done;
  expect(asked.length).toBe(2);
  expect(asked[0]).toContain("q=mapo+tofu");
  expect(written[0]).toEqual({
    "dish:mapo tofu": {
      url: "https://cdn.example/mapo.jpg",
      thumb: "https://ts3.mm.bing.net/th?id=1",
      pageUrl: "https://www.example.com/mapo",
      site: "example.com",
      foundAt: NOW,
    },
  });
  // A search that answered with nothing is remembered as nothing.
  expect(written[1]).toEqual({ "ingredient:kale": { none: true, checkedAt: NOW } });
  expect(out?.progress).toBe("Searched for 2 photographs, found 1.");
  expect(c.lines[0]).toContain("mapo tofu");
});

// A page that does not come back is not a fact about the dish: the rest of the
// queries wait for the next run rather than being written down as misses.
test("a blocked page fails the run and writes nothing after it", async () => {
  const written: Record<string, DishPhotoEntry>[] = [];
  const worker = mealsPhotosWorker({
    canSearch: () => true,
    readAsk: async () => ASK,
    fetchPage: async () => page({ status: "blocked" }),
    savePhotos: async (entries) => {
      written.push(entries);
    },
    writeOutput: async () => "out",
    now: () => NOW,
    wait: async () => {},
  });
  await expect(worker("brief", ctx()).done).rejects.toThrow("blocked");
  expect(written).toEqual([]);
});

// The phone. Nothing should hand it this run (photo-sweep.ts), and if anything
// did, it must not write twenty misses into a cache the PC shares.
test("a machine with no webview refuses the run before it reads the ask", async () => {
  let read = 0;
  const worker = mealsPhotosWorker({
    canSearch: () => false,
    readAsk: async () => {
      read += 1;
      return ASK;
    },
    fetchPage: async () => page({ result: RESULT }),
    savePhotos: async () => {
      throw new Error("nothing may be written");
    },
    writeOutput: async () => "out",
    now: () => NOW,
    wait: async () => {},
  });
  await expect(worker("brief", ctx()).done).rejects.toThrow("hidden webview");
  expect(read).toBe(0);
});

test("a cancelled run stops between two searches", async () => {
  let n = 0;
  const worker = mealsPhotosWorker({
    canSearch: () => true,
    readAsk: async () => ASK,
    fetchPage: async () => {
      n += 1;
      handle.cancel();
      return page({ result: RESULT });
    },
    savePhotos: async () => {},
    writeOutput: async () => "out",
    now: () => NOW,
    wait: async () => {},
  });
  const handle = worker("brief", ctx());
  await expect(handle.done).rejects.toThrow();
  expect(n).toBe(1);
});
