// Searching Bing Images for a photograph (docs/73 图片).
//
// The search runs in the app's hidden webview on the reader's PC, not over
// fetch: Bing answers a scripted client with a page of the right shape and the
// wrong pictures — the title says "mapo tofu" and the results are cat memes
// (坑 372). A real browser with a real session gets the real results.
//
// So this file is the two pure halves around that one call: the URL to open,
// the script that runs inside the page, and the reading of what it hands back.
// Nothing here touches the network, which is what makes the whole of the choice
// testable against a saved page.
//
// Bing's result anchors are `a.iusc`, each carrying the whole record as
// HTML-escaped JSON in an `m` attribute: `murl` is the picture, `purl` is the
// page it sits on, `turl` is Bing's own thumbnail and `t` is the page's title.

const ENDPOINT = "https://www.bing.com/images/search";

// Photographs only, which is the filter a person would click: the unfiltered
// results are half clip art and half recipe-card graphics.
const PHOTO_FILTER = "+filterui:photo-photo";

// Ten is a screenful. The choice never looks past the first row or two anyway,
// and a longer list is a longer string through the webview bridge.
export const BING_RESULT_LIMIT = 10;

/** The page one query opens. */
export function bingImageQuery(q: string): string {
  const params = new URLSearchParams({
    q: (q ?? "").trim(),
    qft: PHOTO_FILTER,
    form: "IRFLTR",
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/**
 * What runs inside the page: the `m` attribute of the first ten result anchors,
 * as strings.
 *
 * In the page rather than over the html, so the worker never carries three
 * hundred kilobytes of Bing's markup back across the bridge to find two hundred
 * bytes in it.
 */
export const BING_RESULTS_SCRIPT = `(function () {
  var out = [];
  var anchors = document.querySelectorAll("a.iusc");
  for (var i = 0; i < anchors.length && out.length < ${BING_RESULT_LIMIT}; i++) {
    var m = anchors[i].getAttribute("m");
    if (m) out.push(m);
  }
  return out;
})()`;

/** One result, as much of it as anything here uses. */
export interface BingImage {
  /** The picture itself. */
  url: string;
  /** Bing's thumbnail of it. */
  thumb: string;
  /** The page the picture sits on: the caption's link, and the proxy's Referer. */
  pageUrl: string;
  /** That page's host without `www.`, which is what the caption names. */
  site: string;
  width?: number;
  height?: number;
}

/**
 * The results of one search, from whatever the fetch came back with: the
 * script's value (an array of `m` strings, or of records already parsed), or
 * the page's html when there was no script.
 *
 * Anything else is no results rather than a throw. A search that answered with
 * a shape nobody expected is a dish without a photograph, not a failed run.
 */
export function parseBingImages(htmlOrResult: unknown): BingImage[] {
  return rawRecords(htmlOrResult)
    .map(toImage)
    .filter((image): image is BingImage => image !== null);
}

function rawRecords(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  }
  if (typeof input !== "string") return [];
  const text = input.trim();
  // The script's value may arrive as JSON text rather than as an array.
  if (text.startsWith("[")) {
    try {
      return rawRecords(JSON.parse(text));
    } catch {
      return [];
    }
  }
  return anchorAttributes(text)
    .map(asRecord)
    .filter((r): r is Record<string, unknown> => r !== null);
}

// The `m` attribute of every result anchor in a page of html. The value is
// HTML-escaped, so it holds no bare quote and the attribute ends where the
// first one does.
function anchorAttributes(html: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    if (!/\bclass="[^"]*\biusc\b[^"]*"/i.test(tag)) continue;
    const m = /\sm="([^"]*)"/i.exec(tag);
    if (m?.[1]) out.push(m[1]);
    if (out.length >= BING_RESULT_LIMIT) break;
  }
  return out;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(unescapeHtml(raw));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The five entities Bing writes into an attribute. `&amp;` last, or an
// `&amp;quot;` would come out as a quote.
function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function toImage(raw: Record<string, unknown>): BingImage | null {
  const url = text(raw.murl);
  if (!url) return null;
  const pageUrl = text(raw.purl);
  const width = size(raw.mw ?? raw.width);
  const height = size(raw.mh ?? raw.height);
  return {
    url,
    thumb: text(raw.turl),
    pageUrl,
    site: siteOf(pageUrl),
    ...(width === null ? {} : { width }),
    ...(height === null ? {} : { height }),
  };
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function size(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The host a caption names: no scheme, no `www.`, no path. */
export function siteOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).host.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/**
 * The picture a search settles on: the first usable one, or the first landscape
 * one where the results say what shape they are.
 *
 * Landscape because the night's card is a 16:9 box and a portrait photograph is
 * cropped to its middle. Anything that is not https is skipped — a data URL has
 * nothing to cache and http is blocked in the webview — and so is anything
 * vector: an SVG under a recipe name is a logo, never a photograph.
 */
export function pickPhoto(results: readonly BingImage[]): BingImage | null {
  const usable = results.filter(isUsable);
  const landscape = usable.find((r) => r.width && r.height && r.width > r.height);
  return landscape ?? usable[0] ?? null;
}

function isUsable(image: BingImage): boolean {
  if (!/^https:\/\//i.test(image.url)) return false;
  return !/\.svgz?($|[?#])/i.test(image.url);
}

/**
 * What an ingredient is searched by: its English name and one word saying what
 * kind of thing it is.
 *
 * "kale" alone finds smoothies and supplement bottles; "kale vegetable" finds
 * kale. The disambiguating word comes from the aisle it is bought in, which the
 * plan already carries, so nothing has to be asked of the model for it.
 */
export function ingredientQuery(en: string, category: string): string {
  const name = (en ?? "").trim().toLowerCase();
  if (!name) return "";
  return `${name} ${category === "produce" ? "vegetable" : "food"}`;
}
