// Dish photographs from a general web image search (docs/73 图片).
//
// Openverse (dish-photos.ts) knows dishes that have a name and nothing else:
// `sheet pan salmon broccoli` comes back empty, and a week of invented
// combinations is a week of grey blocks. A general image search has a picture
// for any string, which is what the reader asked for.
//
// Google's Programmable Search Engine answers that through the Custom Search
// JSON API with `searchType=image`. The app ships no key: the reader registers
// their own key and their own search engine id in Settings › Optional, and
// without them nothing here runs and Openverse stays the whole story. A free
// key allows a hundred queries a day; the per-name cache means a week of seven
// new dishes costs seven.
//
// The response shape this file reads is the documented one
// (https://developers.google.com/custom-search/v1/reference/rest/v1/Search):
// `items[].link` is "The full URL to which the search result is pointing" — the
// image itself for an image search — `items[].displayLink` is "An abridged
// version of this search result's URL", and `items[].image` carries
// `contextLink` ("A URL pointing to the webpage hosting the image"),
// `thumbnailLink`, `width` and `height`.

import type { DishPhotoLookup, FetchLike } from "./dish-photos";
import type { DishPhoto } from "./types";

const ENDPOINT = "https://www.googleapis.com/customsearch/v1";

// Same patience as the Openverse search: long enough for a slow mobile
// connection, short enough that the week's photographs are there before the
// reader has read the shopping list.
const TIMEOUT_MS = 10_000;

// Five is enough to skip a portrait or a logo without paging, and a page is
// one query either way.
const PAGE_SIZE = 5;

/** The reader's own key and search engine. Neither is any use without the other. */
export interface GoogleSearchCreds {
  apiKey: string;
  engineId: string;
}

/**
 * The credentials a settings object holds, or null when either half is
 * missing. Takes the two fields rather than Settings so this file stays
 * headless and the test needs no store.
 */
export function googleSearchCreds(
  settings: { googleSearchApiKey?: string | null; googleSearchEngineId?: string | null } | null | undefined,
): GoogleSearchCreds | null {
  const apiKey = (settings?.googleSearchApiKey ?? "").trim();
  const engineId = (settings?.googleSearchEngineId ?? "").trim();
  if (!apiKey || !engineId) return null;
  return { apiKey, engineId };
}

/** The request URL for one name. Exported so a test asserts it rather than a mock's shape. */
export function googleImageQuery(searchName: string, creds: GoogleSearchCreds): string {
  const params = new URLSearchParams({
    key: creds.apiKey,
    cx: creds.engineId,
    q: searchName,
    searchType: "image",
    num: String(PAGE_SIZE),
    safe: "active",
    imgSize: "large",
  });
  return `${ENDPOINT}?${params.toString()}`;
}

const UNANSWERED: DishPhotoLookup = { ok: false };

/**
 * The photograph for one dish name, from the reader's own search engine.
 *
 * The same three-way contract as the Openverse lookup: `{ ok: true, photo }`
 * for an answer, photograph or not, and `{ ok: false }` for no answer at all.
 * A rejected key (403) and an exhausted quota (429) are both refusals, not
 * facts about the dish, so neither is cached and both let the free path try.
 */
export async function lookupGoogleImage(
  searchName: string,
  creds: GoogleSearchCreds,
  fetchFn: FetchLike = fetch,
): Promise<DishPhotoLookup> {
  const name = (searchName ?? "").trim();
  if (!name) return UNANSWERED;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(googleImageQuery(name, creds), {
      headers: { Accept: "application/json" },
      signal: control.signal,
    });
    if (!res.ok) return UNANSWERED;
    return { ok: true, photo: pickGoogleImage(await res.json()) };
  } catch {
    return UNANSWERED;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The first usable result of a response body.
 *
 * Landscape first, because the night's card is a 16:9 box and a portrait
 * photograph is cropped to its middle. No host is skipped here: which CDNs
 * refuse a hotlink is not knowable from the response, and a picture that will
 * not load falls back to the ingredient strip and is forgotten from the cache
 * (markDishPhotoBroken), which is cheaper than a guessed blocklist.
 */
export function pickGoogleImage(body: unknown): DishPhoto | null {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return null;
  const usable = items.filter(isUsable);
  const landscape = usable.find((item) => {
    const image = item.image as Record<string, unknown>;
    const w = Number(image.width);
    const h = Number(image.height);
    return Number.isFinite(w) && Number.isFinite(h) && h > 0 && w > h;
  });
  const chosen = landscape ?? usable[0];
  if (!chosen) return null;
  const image = chosen.image as Record<string, unknown>;
  return {
    url: String(chosen.link),
    thumb: text(image.thumbnailLink),
    title: text(chosen.title),
    // The site the picture is on. There is no author and no licence in these
    // results, so the credit line names where it came from and links there.
    creator: text(chosen.displayLink),
    license: "",
    licenseUrl: "",
    foreignLandingUrl: text(image.contextLink),
    // The page the picture sits on, sent as Referer by the img: proxy: an
    // arbitrary web image may be behind a hotlink check (docs/pitfall/30).
    pageUrl: text(image.contextLink),
  };
}

type Item = Record<string, unknown>;

function isUsable(raw: unknown): raw is Item {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as Item;
  if (typeof item.link !== "string" || !/^https?:\/\//i.test(item.link)) return false;
  return !!item.image && typeof item.image === "object";
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

type Lookup = (searchName: string) => Promise<DishPhotoLookup>;

/**
 * The search first, the free index behind it.
 *
 * Google is only ahead when the reader has configured a key. Anything short of
 * a photograph falls through to Openverse: nothing found there may still be
 * found here, and a refusal — a rejected key, a spent quota, a dead network —
 * must not silence the path that needs no key.
 */
export function composeDishPhotoLookup(google: Lookup | null, openverse: Lookup): Lookup {
  if (!google) return openverse;
  return async (searchName) => {
    const answer = await google(searchName);
    if (answer.ok && answer.photo) return answer;
    return openverse(searchName);
  };
}
