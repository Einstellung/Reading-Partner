// Pictures for the dinner screen (docs/73 图片).
//
// The reader cannot tell one vegetable from another, so every line of the
// shopping list and every dish wants a photograph. Two sources, and neither of
// them is the model: a dish carries an image the plan was drafted with, and an
// ingredient resolves by name against a bank of ingredient photographs.
//
// The bank is being built separately. Until it lands ingredientImageUrl answers
// null for everything and the screen draws a category glyph instead, which is
// the same path a name the bank has never heard of takes for good.

import { proxyImageUrl } from "../../platform/app/image-proxy";

/**
 * The photograph of one ingredient, by the name the model wrote, or null when
 * the bank has none.
 *
 * Null for everything today: an ingredient image bank is being assembled in
 * parallel and is wired in here, behind this one function, so nothing else on
 * the screen changes when it arrives. Every caller already draws the fallback,
 * because a bank will never have every name.
 */
export function ingredientImageUrl(_name: string): string | null {
  return null;
}

/**
 * What an <img> src should be for a picture a dish or an ingredient holds.
 *
 * An external https picture cannot load in the webview as it stands: the CSP
 * img-src has no https and COEP drops every cross-origin subresource, so it
 * goes through the `img:` scheme (platform/app/image-proxy, docs/pitfall/30).
 * An app-relative path is served by the app itself and is left alone. Null for
 * an empty one, so the caller draws its fallback rather than an <img> with no
 * source.
 *
 * `toProxy` is injected so the decision is testable without a webview; outside
 * Tauri the live one answers null and the plain https URL is used, which is
 * what `bun dev` renders.
 */
export function imageSrc(
  url: string | undefined | null,
  toProxy: (u: string) => string | null = proxyImageUrl,
): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return toProxy(raw) ?? raw;
  // A data: URI is already inline, and anything else is the app's own path.
  return raw;
}
