// The photograph run: what a week asks for (src/info/dinner/photo-run.ts) and
// what the worker does with it (src/info/dinner/photo-worker.ts).
// Run: scripts/t.sh tests/info/dinner

import { expect, test } from "bun:test";
import {
  DINNER_PHOTOS_KIND,
  MAX_PHOTO_QUERIES,
  parsePhotoAsk,
  photoOutputLine,
  photoQueriesForPlan,
  startPhotoRun,
  type DinnerPhotoAsk,
} from "../../../src/info/dinner/photo-run";
import { dinnerPhotosWorker } from "../../../src/info/dinner/photo-worker";
import type { WebviewPage } from "../../../src/info/extract/webview-page";
import type { Dish, DishPhotoEntry, Ingredient, WeekPlan } from "../../../src/info/dinner/types";
import type { Run } from "../../../src/legion/run/types";
import type { WorkerContext } from "../../../src/legion/execute/worker";

function ingredient(en: string, category: Ingredient["category"] = "produce"): Ingredient {
  return { name: en, en, qty: "1", category, keeps: "d3-5" };
}

function dish(over: Partial<Dish> = {}): Dish {
  return {
    id: "dish-a",
    name: "Mapo tofu",
    searchName: "mapo tofu",
    oneLine: "",
    base: "",
    fresh: "",
    keepsADay: false,
    handsOnMinutes: 10,
    ingredients: [ingredient("kale"), ingredient("firm tofu", "protein")],
    ...over,
  };
}

function week(dishes: Dish[]): WeekPlan {
  return {
    id: "week-2026-09-21",
    startDate: "2026-09-21",
    days: [],
    dishes,
    createdAt: 0,
    revision: 1,
  };
}

const NOW = 1_000_000;
const noBank = () => null;

test("a week asks for its dishes first, then the ingredients no bank has", () => {
  const queries = photoQueriesForPlan(week([dish()]), {}, NOW, {
    bankImage: (en) => (en === "firm tofu" ? "https://themealdb/tofu.png" : null),
  });
  expect(queries).toEqual([
    { key: "dish:mapo tofu", q: "mapo tofu" },
    { key: "ingredient:kale", q: "kale vegetable" },
  ]);
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
    "ingredient:kale": { none: true, checkedAt: NOW - 1000 },
  };
  expect(photoQueriesForPlan(week([dish()]), cache, NOW, { bankImage: noBank })).toEqual([
    { key: "ingredient:firm tofu", q: "firm tofu food" },
  ]);
  expect(
    photoQueriesForPlan(week([dish()]), cache, NOW, { bankImage: noBank, ignoreCache: true }).length,
  ).toBe(3);
});

test("a name is asked for once however many nights eat it, and a run is capped", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    dish({ id: `dish-${i}`, searchName: `dish ${i}`, ingredients: [ingredient("kale")] }),
  );
  const queries = photoQueriesForPlan(week(many), {}, NOW, { bankImage: noBank });
  expect(queries.length).toBe(MAX_PHOTO_QUERIES);
  expect(queries.filter((q) => q.key === "ingredient:kale").length).toBeLessThan(2);
});

test("a dish with no search name and an ingredient with no English name ask nothing", () => {
  const queries = photoQueriesForPlan(
    week([dish({ searchName: "", ingredients: [ingredient(""), ingredient("kale")] })]),
    {},
    NOW,
    { bankImage: noBank },
  );
  expect(queries).toEqual([{ key: "ingredient:kale", q: "kale vegetable" }]);
});

test("the ask is written, handed to legion, and read back", async () => {
  const ask: DinnerPhotoAsk = {
    planId: "week-2026-09-21",
    queries: [{ key: "dish:mapo tofu", q: "mapo tofu" }],
  };
  let sent: { kind: string; brief: string; delegator: unknown } | null = null;
  const id = await startPhotoRun(ask, {
    write: async () => "legion/briefs/dinner-photos-1.json",
    delegate: async (input) => {
      sent = { kind: input.kind, brief: input.brief, delegator: input.delegator };
      return { ok: true, run: { id: "run-1" } as Run, existing: false };
    },
  });
  expect(id).toBe("run-1");
  expect(sent!.kind).toBe(DINNER_PHOTOS_KIND);
  expect(sent!.brief).toBe("legion/briefs/dinner-photos-1.json");
  // Nobody is owed a sentence about it: the pictures appear, that is all.
  expect(sent!.delegator).toEqual({ kind: "program", name: "dinner" });

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
  const worker = dinnerPhotosWorker({
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
  const worker = dinnerPhotosWorker({
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

test("a cancelled run stops between two searches", async () => {
  let n = 0;
  const worker = dinnerPhotosWorker({
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
