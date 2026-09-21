// The photograph search as a run (docs/55, docs/73 图片): what is asked for,
// who asks, and what the run leaves behind.
//
// Planning belongs to the PC. The search needs a hidden webview with a real
// browser session in it (photo-search.ts), which is one capability tag and one
// kind of machine, so the phone applies a plan and shows it at once from the
// ingredient pictures while the pictures of the dishes arrive later over the
// synced file.
//
// The ask is a file, like the ingest run's: a run record carries references and
// never content (docs/55), and this ask is a plan and a list of queries.
//
// No host in this file: the tool and the Apply write the ask, the worker reads
// it, and both halves are testable without a network.

import { appData } from "../../platform/app/appdata";
import { appRunner } from "../../legion/execute/runner";
import type { Delegated, DelegateInput } from "../../legion/execute/worker";
import { dishPhotoKey, ingredientPhotoKey, needsPhotoLookup, type PhotoCache } from "./dish-photos";
import { ingredientQuery } from "./photo-search";
import type { WeekPlan } from "./types";

/** The kind meals registers for searching out a week's photographs. */
export const MEALS_PHOTOS_KIND = "meals-photos";

/** Where the ask is kept. The subtree is registered in palace as `run-brief`. */
export const MEALS_PHOTO_ASKS_DIR = "legion/briefs";

// One search is a page load in a real browser, and they are spaced out by a
// second or two, so twenty is a couple of minutes of a machine nobody is
// watching. A week that needs more gets the rest at the next Apply.
export const MAX_PHOTO_QUERIES = 20;

/** One thing to search for: where the answer goes, and what is typed in. */
export interface PhotoQuery {
  /** The cache key, `dish:<searchName>` or `ingredient:<en>`. */
  key: string;
  /** The words the search is given. */
  q: string;
}

/** What one photograph run is asked for. Frozen when the run is created. */
export interface MealsPhotoAsk {
  /** The week these were wanted for. Kept for the line the run leaves. */
  planId: string;
  queries: PhotoQuery[];
}

/**
 * Everything a week wants a picture of and has none of: its dishes by name,
 * then the ingredients no picture bank has artwork for.
 *
 * Dishes first because they are the two large pictures on the screen, and the
 * cap falls on the ingredients. TheMealDB stays ahead of the search for an
 * ingredient: a white-background cut-out of a bok choy identifies the vegetable
 * in the shop better than a photograph of a dish it is in.
 *
 * `ignoreCache` is the reader asking for another look: every query of the week,
 * whatever is remembered about it.
 */
export function photoQueriesForPlan(
  plan: WeekPlan,
  cache: PhotoCache,
  now: number,
  opts: { bankImage: (en: string) => string | null; ignoreCache?: boolean },
): PhotoQuery[] {
  const out: PhotoQuery[] = [];
  const seen = new Set<string>();
  const want = (key: string, q: string) => {
    if (!key || !q || seen.has(key)) return;
    if (!opts.ignoreCache && !needsPhotoLookup(cache[key], now)) return;
    seen.add(key);
    out.push({ key, q });
  };
  for (const dish of plan.dishes) want(dishPhotoKey(dish.searchName ?? ""), normalize(dish.searchName));
  for (const dish of plan.dishes) {
    for (const ingredient of dish.ingredients) {
      const en = normalize(ingredient.en);
      if (!en || opts.bankImage(en)) continue;
      want(ingredientPhotoKey(en), ingredientQuery(en, ingredient.category));
    }
  }
  return out.slice(0, MAX_PHOTO_QUERIES);
}

function normalize(raw: string | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Write the ask for a run about to be delegated, answering its path. */
export async function writePhotoAsk(ask: MealsPhotoAsk): Promise<string> {
  const path = `${MEALS_PHOTO_ASKS_DIR}/meals-photos-${crypto.randomUUID()}.json`;
  await appData.mkdirp(MEALS_PHOTO_ASKS_DIR);
  await appData.writeAtomic(path, JSON.stringify(ask, null, 2));
  return path;
}

/** Read an ask back. A file with no query in it is not one. */
export function parsePhotoAsk(text: string): MealsPhotoAsk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the photograph ask is not readable JSON");
  }
  const value = parsed as Partial<MealsPhotoAsk> | null;
  const planId = typeof value?.planId === "string" ? value.planId.trim() : "";
  const queries = Array.isArray(value?.queries)
    ? value.queries
        .map((entry) => ({
          key: typeof entry?.key === "string" ? entry.key.trim() : "",
          q: typeof entry?.q === "string" ? entry.q.trim() : "",
        }))
        .filter((entry) => entry.key !== "" && entry.q !== "")
    : [];
  if (!queries.length) throw new Error("the photograph ask names nothing to search for");
  return { planId, queries };
}

export interface StartPhotoRunDeps {
  /** Where the ask is put, answering the path. AppData unless injected. */
  write?: (ask: MealsPhotoAsk) => Promise<string>;
  /** The runner. This device's own unless a test hands one in. */
  delegate?: (input: DelegateInput) => Promise<Delegated>;
}

/**
 * Write the ask, hand legion the run, and answer its id without waiting.
 *
 * The delegator is the program: nobody is owed a sentence about it. The
 * photographs appear on the screen when the file says so, and a run that failed
 * is a week drawn from its ingredients, which is what the screen shows in the
 * meantime anyway.
 *
 * Null when there is nothing to search for, which is the common case for a week
 * of dishes the reader has cooked before.
 */
export async function startPhotoRun(
  ask: MealsPhotoAsk,
  deps: StartPhotoRunDeps = {},
): Promise<string | null> {
  if (!ask.queries.length) return null;
  const write = deps.write ?? writePhotoAsk;
  const send = deps.delegate ?? ((input: DelegateInput) => appRunner().delegate(input));
  const brief = await write(ask);
  const result = await send({
    kind: MEALS_PHOTOS_KIND,
    delegator: { kind: "program", name: "meals" },
    brief,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run.id;
}

/** The one line the run leaves behind (docs/55 「无产出的 run 是失败」). */
export function photoOutputLine(found: number, asked: number): string {
  return `Searched for ${asked} ${asked === 1 ? "photograph" : "photographs"}, found ${found}.`;
}
