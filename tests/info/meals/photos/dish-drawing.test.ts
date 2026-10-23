// The dish pictures, drawn: what the image model is told and which dishes want
// one (src/info/meals/photos/dish-drawing.ts), and the pass that draws them
// (src/info/meals/photos/dish-draw-sweep.ts).
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  DRAWING_CLAIM_MS,
  MAX_DRAWINGS_PER_ROUND,
  claimEntry,
  dishPicturePrompt,
  dishesToDraw,
  wantsDrawing,
  weekDishKeys,
  withClaimsReleased,
} from "../../../../src/info/meals/photos/dish-drawing";
import {
  backoffAfter,
  createDishDrawer,
  DRAW_BACKOFF_MS,
  type DishDrawPorts,
} from "../../../../src/info/meals/photos/dish-draw-sweep";
import type { PhotoCache } from "../../../../src/info/meals/photos/dish-photos";
import { foodById } from "../../../../src/info/meals/nutrition/foods";
import type { GeneratedImage } from "../../../../src/ai/image-generation";
import type { DishPhotoEntry, MealsState } from "../../../../src/info/meals/plan/types";
import { shrimpRice, state, week } from "../fixtures/week";

const NOW = 10_000_000;

test("the prompt is the dish as served, from the plan's own facts", () => {
  const prompt = dishPicturePrompt(shrimpRice());
  const shrimp = foodById("frozen_shrimp")?.en ?? "";
  const rice = foodById("microwave_grain_rice")?.en ?? "";
  expect(prompt).toBe(
    `A photograph of shrimp rice bowl, a home-cooked dish, served on a plate on a table. ` +
      `It is made with ${shrimp.toLowerCase()}, ${rice.toLowerCase()}. ` +
      `How it is made: 虾仁杂粮饭: assemble and eat. ` +
      `Natural light. No text, no people, no hands.`,
  );
  // The oil is not a thing to draw.
  expect(prompt).not.toContain(foodById("olive_oil")?.en?.toLowerCase() ?? "olive oil");
});

test("a dish with no foods and no method still says what it is and what must not be in it", () => {
  expect(dishPicturePrompt({ searchName: " Mapo  Tofu " })).toBe(
    "A photograph of mapo tofu, a home-cooked dish, served on a plate on a table. " +
      "Natural light. No text, no people, no hands.",
  );
});

test("a dish wants a drawing until it has one, and again after the reader asks", () => {
  expect(wantsDrawing(undefined, NOW)).toBe(true);
  // A photograph or a miss from when dishes were searched is replaced.
  expect(wantsDrawing({ url: "u", thumb: "", pageUrl: "", site: "", foundAt: 1 }, NOW)).toBe(true);
  expect(wantsDrawing({ none: true, checkedAt: NOW }, NOW)).toBe(true);
  const drawn = { drawing: "meals-pictures/a.jpg", drawnAt: 500 };
  expect(wantsDrawing(drawn, NOW)).toBe(false);
  expect(wantsDrawing(drawn, NOW, 501)).toBe(true);
  // Someone is drawing it; their claim lapses.
  expect(wantsDrawing({ drawingSince: NOW - 1000 }, NOW)).toBe(false);
  expect(wantsDrawing({ drawingSince: NOW - DRAWING_CLAIM_MS }, NOW)).toBe(true);
  expect(wantsDrawing({ ...drawn, drawingSince: NOW - 1000 }, NOW, 501)).toBe(false);
});

test("a claim on a dish drawn before keeps the old picture on it", () => {
  const drawn = { drawing: "meals-pictures/a.jpg", drawnAt: 500, src: "data:x" };
  expect(claimEntry(drawn, 9)).toEqual({ drawing: "meals-pictures/a.jpg", drawnAt: 500, drawingSince: 9 });
  expect(claimEntry(undefined, 9)).toEqual({ drawingSince: 9 });
  expect(claimEntry({ none: true, checkedAt: 1 }, 9)).toEqual({ drawingSince: 9 });
});

test("the week's made dishes are drawn once each, capped per round", () => {
  const plan = week();
  const keys = weekDishKeys(plan);
  expect(keys).toContain("drawing:shrimp rice bowl");
  expect(new Set(keys).size).toBe(keys.length);
  const wanted = dishesToDraw(plan, {}, NOW);
  expect(wanted.length).toBe(Math.min(keys.length, MAX_DRAWINGS_PER_ROUND));
  expect(wanted[0]?.prompt).toContain("A photograph of");
  const done: PhotoCache = Object.fromEntries(keys.map((k) => [k, { drawing: "p.jpg", drawnAt: 1 }]));
  expect(dishesToDraw(plan, done, NOW)).toEqual([]);
  expect(dishesToDraw(plan, done, NOW, { askedAt: 2 }).length).toBe(wanted.length);
});

// --- the pass ------------------------------------------------------------------

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0]);

function harness(opts: Partial<Omit<DishDrawPorts, "state">> & { week?: MealsState; images?: GeneratedImage[] } = {}) {
  const { week: on, images: queued, ...over } = opts;
  const cache: Record<string, DishPhotoEntry> = {};
  const prompts: string[] = [];
  const files: string[] = [];
  const writes: Record<string, DishPhotoEntry>[] = [];
  let clock = NOW;
  let landed = 0;
  let failed = 0;
  const images = queued ?? [];
  const ports: DishDrawPorts = {
    canDraw: async () => true,
    state: async () => on ?? state(),
    photos: async () => ({ ...cache }),
    draw: async (prompt) => {
      prompts.push(prompt);
      return images.shift() ?? { ok: true, bytes: JPEG, mediaType: "image/jpeg", provider: "xai", model: "m" };
    },
    saveFile: async (_bytes, mediaType) => {
      const path = `meals-pictures/${files.length}.${mediaType === "image/jpeg" ? "jpg" : "png"}`;
      files.push(path);
      return path;
    },
    save: async (entries) => {
      writes.push(entries);
      Object.assign(cache, entries);
    },
    release: async (keys, since) => {
      const next = withClaimsReleased(cache, keys, since);
      if (!next) return;
      for (const key of Object.keys(cache)) delete cache[key];
      Object.assign(cache, next);
    },
    now: () => clock,
    landed: () => {
      landed += 1;
    },
    failed: () => {
      failed += 1;
    },
    ...over,
  };
  return {
    drawer: createDishDrawer(ports),
    cache,
    prompts,
    files,
    writes,
    landed: () => landed,
    failed: () => failed,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

test("a round claims its dishes, then draws and keeps them one at a time", async () => {
  const h = harness();
  const result = await h.drawer.sweep();
  const round = Math.min(weekDishKeys(week()).length, MAX_DRAWINGS_PER_ROUND);
  expect(result).toEqual({ drawn: round, wanted: round });
  // The claims went first, in one write, before any paid call.
  expect(Object.values(h.writes[0] ?? {}).every((e) => "drawingSince" in e)).toBe(true);
  expect(h.prompts.length).toBe(round);
  expect(h.files.length).toBe(round);
  expect(h.landed()).toBe(round);
  expect(h.cache["drawing:shrimp rice bowl"] ?? h.cache[Object.keys(h.cache)[0] ?? ""]).toMatchObject({
    drawing: expect.stringMatching(/^meals-pictures\//),
  });
});

test("a device whose provider cannot draw writes nothing", async () => {
  const h = harness({ canDraw: async () => false });
  expect((await h.drawer.sweep()).why).toBe("unavailable");
  expect(h.writes).toEqual([]);
  expect(h.prompts).toEqual([]);
});

test("a failed call is not a missing picture: the round stops and waits longer each time", async () => {
  const h = harness({
    images: [
      { ok: true, bytes: JPEG, mediaType: "image/jpeg", provider: "xai", model: "m" },
      { ok: false, unavailable: false, reason: "500" },
    ],
  });
  const first = await h.drawer.sweep();
  expect(first).toMatchObject({ drawn: 1, why: "failed" });
  const drawings = Object.values(h.cache).filter((e) => "drawing" in e);
  expect(drawings.length).toBe(1);
  // Nothing was written as "this dish has no picture", and the claims on the
  // dishes not drawn were taken back, so the search can have them now.
  expect(Object.values(h.cache).some((e) => "none" in e)).toBe(false);
  expect(Object.values(h.cache).some((e) => !("drawing" in e))).toBe(false);
  expect(h.drawer.failing()).toBe(true);
  expect(h.failed()).toBe(1);

  expect((await h.drawer.sweep()).why).toBe("backing-off");
  h.tick(DRAW_BACKOFF_MS);
  const again = await h.drawer.sweep();
  expect(again.why).toBeUndefined();
  expect(again.drawn).toBeGreaterThan(0);
  expect(h.drawer.failing()).toBe(false);
  expect(backoffAfter(1)).toBe(DRAW_BACKOFF_MS);
  expect(backoffAfter(2)).toBe(2 * DRAW_BACKOFF_MS);
  expect(backoffAfter(30)).toBe(6 * 60 * 60 * 1000);
});

test("taking back claims touches only this round's, and keeps an old picture", () => {
  const cache: PhotoCache = {
    "drawing:a": { drawingSince: 5 },
    "drawing:b": { drawing: "p.jpg", drawnAt: 1, drawingSince: 5 },
    "drawing:c": { drawingSince: 9 },
    "drawing:d": { drawing: "q.jpg", drawnAt: 2 },
  };
  expect(withClaimsReleased(cache, ["drawing:a", "drawing:b", "drawing:c", "drawing:d"], 5)).toEqual({
    "drawing:b": { drawing: "p.jpg", drawnAt: 1 },
    "drawing:c": { drawingSince: 9 },
    "drawing:d": { drawing: "q.jpg", drawnAt: 2 },
  });
  expect(withClaimsReleased(cache, ["drawing:d"], 5)).toBeNull();
});

test("another device's fresh claim keeps this one off the dish", async () => {
  const h = harness();
  for (const key of weekDishKeys(week())) h.cache[key] = { drawingSince: NOW - 1000 };
  expect((await h.drawer.sweep()).why).toBe("nothing-wanted");
  expect(h.prompts).toEqual([]);
});

test("two rounds started together draw once", async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.drawer.sweep(), h.drawer.sweep()]);
  expect([a.why, b.why]).toContain("busy");
  expect(h.prompts.length).toBe(Math.min(weekDishKeys(week()).length, MAX_DRAWINGS_PER_ROUND));
});

test("no week is nothing to draw", async () => {
  const h = harness({ week: state({ plan: null }) });
  expect((await h.drawer.sweep()).why).toBe("no-week");
});
