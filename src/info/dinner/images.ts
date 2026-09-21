// Pictures for the dinner screen (docs/73 图片).
//
// The reader cannot tell one vegetable from another, so every line of the
// shopping list wants a photograph. The pictures are TheMealDB's ingredient
// artwork, addressed by name: no key, no API call, no picture stored here.
// Four things TheMealDB has no artwork for fall back to Spoonacular's image
// CDN at slugs measured once and written down — Spoonacular's API is never
// called, and its slugs cannot be derived from a name
// (docs/research/食材与菜品图片源调研.md).
//
// The name that resolves is the English common name on the ingredient, and the
// mapping from it to TheMealDB's spelling is this file's table. Never the model
// and never the network: a URL through the model is a fact through the model,
// and a lookup over the network is a shopping list that needs a connection.
//
// Three things on the test list get no picture on purpose rather than a wrong
// one: winter melon and farro, which neither source has, and king oyster
// mushroom, for which TheMealDB only has plain oyster mushrooms. They fall out
// of the table by not being in it.

import { proxyImageUrl } from "../../platform/app/image-proxy";
import { MEALDB_INGREDIENTS } from "./mealdb-ingredients";

// Small is what a 40px line square and a thumbnail strip need: 14–57KB against
// 517KB for the full size, and a week's list is forty of them.
const MEALDB_BASE = "https://www.themealdb.com/images/ingredients";

// 250x250, 7–24KB. The four slugs below are the only ones this app ever uses.
const SPOONACULAR_BASE = "https://img.spoonacular.com/ingredients_250x250";

/**
 * English common names that are not TheMealDB's spelling, and what they are
 * there. American against British, the Chinese market's names against the
 * English ones, and a few singulars the plural rule below cannot reach.
 *
 * Every value is checked against MEALDB_INGREDIENTS by the tests, so a target
 * that gets renamed out of the list fails a test rather than a load.
 */
const ALIASES: Readonly<Record<string, string>> = {
  arugula: "Rocket",
  "baby bok choy": "Pak Choi",
  "bell pepper": "Red Pepper",
  "bok choy": "Pak Choi",
  "chinese kale": "Chinese Broccoli",
  cilantro: "Coriander",
  courgette: "Courgettes",
  eggplant: "Aubergine",
  "firm tofu": "Tofu",
  "gai lan": "Chinese Broccoli",
  garbanzo: "Chickpeas",
  "garbanzo bean": "Chickpeas",
  "green onion": "Spring Onions",
  "greek yoghurt": "Greek Yogurt",
  "ground beef": "Minced Beef",
  "napa cabbage": "Napa Cabbage",
  "pork mince": "Minced Pork",
  prawn: "Prawns",
  scallion: "Spring Onions",
  shallot: "Shallots",
  shiitake: "Shiitake Mushrooms",
  "shiitake mushroom": "Shiitake Mushrooms",
  shrimp: "Prawns",
  "spring onion": "Spring Onions",
  "sweet potato": "Sweet Potatoes",
  "tinned tomatoes": "Canned Tomatoes",
  yoghurt: "Yogurt",
  zucchini: "Courgettes",
};

/**
 * What TheMealDB has no artwork for and Spoonacular does, at the slug that was
 * measured. Spoonacular's slugs are not derivable — `lentils.jpg` is a 404 and
 * `lentils-brown.jpg` is not — so nothing here is ever guessed at runtime.
 */
const SPOONACULAR_SLUGS: Readonly<Record<string, string>> = {
  "choy sum": "choy-sum",
  edamame: "edamame",
  enoki: "enoki-mushrooms",
  "enoki mushroom": "enoki-mushrooms",
  "lotus root": "lotus-root",
  "yu choy": "choy-sum",
};

// TheMealDB's names, by their lower-case spelling. Built once.
const BY_LOWER: ReadonlyMap<string, string> = new Map(
  MEALDB_INGREDIENTS.map((name) => [name.toLowerCase(), name]),
);

/**
 * The spellings one written name could be looked up as: itself, and the other
 * side of its plural. The list is inconsistent about number — "Chickpeas" and
 * "Courgettes" are plural, "Kale" and "Tofu" are not — so a name is tried both
 * ways rather than the table carrying two rows for each.
 */
function candidates(raw: string): string[] {
  const n = raw.toLowerCase().trim().replace(/\s+/g, " ");
  if (!n) return [];
  const out = [n];
  if (n.endsWith("ies")) out.push(`${n.slice(0, -3)}y`);
  if (n.endsWith("es")) out.push(n.slice(0, -2));
  if (n.endsWith("s")) out.push(n.slice(0, -1));
  else {
    out.push(`${n}s`);
    if (/(o|s|x|ch|sh)$/.test(n)) out.push(`${n}es`);
    if (n.endsWith("y")) out.push(`${n.slice(0, -1)}ies`);
  }
  return [...new Set(out)];
}

/**
 * The photograph of one ingredient, by its English common name, or null when
 * neither source has one.
 *
 * The chain is the alias table, then TheMealDB's own list, then the four
 * Spoonacular constants, then nothing — and nothing is a real answer: the
 * screen draws the aisle's glyph, which is also where a picture that fails to
 * load ends up. An approximate photograph is worse than a glyph, because a
 * glyph does not claim to be the thing.
 */
export function ingredientImageUrl(en: string): string | null {
  const forms = candidates(en ?? "");
  for (const form of forms) {
    const alias = ALIASES[form];
    if (alias) return mealdbUrl(alias);
  }
  for (const form of forms) {
    const exact = BY_LOWER.get(form);
    if (exact) return mealdbUrl(exact);
  }
  for (const form of forms) {
    const slug = SPOONACULAR_SLUGS[form];
    if (slug) return `${SPOONACULAR_BASE}/${slug}.jpg`;
  }
  return null;
}

function mealdbUrl(name: string): string {
  return `${MEALDB_BASE}/${encodeURIComponent(name)}-small.png`;
}

/** Exported for the tests that hold the alias targets to TheMealDB's list. */
export const MEALDB_ALIASES = ALIASES;

/**
 * What an <img> src should be for a picture a dish or an ingredient holds.
 *
 * An external https picture cannot load in the webview as it stands: the CSP
 * img-src has no https and COEP drops every cross-origin subresource, so it
 * goes through the `img:` scheme (platform/app/image-proxy, docs/pitfall/30).
 * Both photograph hosts are external https, so both go through it. An
 * app-relative path is served by the app itself and is left alone. Null for an
 * empty one, so the caller draws its fallback rather than an <img> with no
 * source.
 *
 * `pageUrl` is the page the picture sits on, which the proxy sends as Referer
 * (docs/pitfall/30). Only the web image search fills it in: its results are
 * arbitrary CDNs and some of them refuse a bare request. TheMealDB,
 * Spoonacular and Openverse pass nothing, and nothing is sent.
 *
 * `toProxy` is injected so the decision is testable without a webview; outside
 * Tauri the live one answers null and the plain https URL is used, which is
 * what `bun dev` renders.
 */
export function imageSrc(
  url: string | undefined | null,
  pageUrl?: string | null,
  toProxy: (u: string, page?: string | null) => string | null = proxyImageUrl,
): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return toProxy(raw, (pageUrl ?? "").trim() || null) ?? raw;
  // A data: URI is already inline, and anything else is the app's own path.
  return raw;
}
