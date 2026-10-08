// Which links out of a post are followed (docs/84 「建议」): the kinds of thing a
// post recommends — a file on Drive, a PDF, a GitHub repository, a paper, an
// article — and nothing else. A homepage, a product page or a sign-in page is
// not what the post is about, and fetching one would land a brochure on the
// shelf (jiangkoumo_'s card pointed at fly.io's front page).
//
// A link some site adapter claims is followed whatever its shape: the domain
// that registered the adapter knows the site better than these rules do.

import { isXHost } from "./post";

export type OutboundVerdict =
  | { follow: true; kind: "site" | "drive" | "pdf" | "github" | "page" }
  | { follow: false; reason: string };

const SIGN_IN = /(^|\/)(log-?in|sign-?in|sign-?up|register|auth|oauth2?|sso|account)(\/|$)/i;
const PRODUCT = new Set([
  "pricing", "product", "products", "features", "download", "downloads", "app", "apps",
  "waitlist", "store", "shop", "buy", "plans", "enterprise", "contact", "careers", "jobs",
]);
const GITHUB_NOT_REPO = new Set([
  "features", "pricing", "marketplace", "login", "signup", "about", "enterprise", "topics",
  "collections", "sponsors", "orgs", "settings", "explore", "trending", "apps", "search",
  "notifications", "team", "customer-stories", "security", "solutions", "resources",
]);
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|bilibili\.com|tiktok\.com)$/i;

/** Whether to follow a link (already expanded) out of a post, and why not. */
export function classifyOutbound(
  raw: string,
  claimedBySite: (url: string) => boolean,
): OutboundVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { follow: false, reason: "not a web link" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { follow: false, reason: "not a web link" };
  }
  const host = url.hostname.toLowerCase();
  if (isXHost(host)) return { follow: false, reason: "a link to another page on X" };
  if (host === "t.co") return { follow: false, reason: "a t.co link that did not resolve" };
  if (claimedBySite(url.toString())) return { follow: true, kind: "site" };

  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter((s) => s !== "");
  if (SIGN_IN.test(path)) return { follow: false, reason: "a sign-in page" };
  if (host === "drive.google.com" || host === "docs.google.com") {
    return /\/d\/[\w-]+/.test(path) || url.searchParams.has("id")
      ? { follow: true, kind: "drive" }
      : { follow: false, reason: "a Google Drive page that is not a file" };
  }
  if (/\.pdf$/i.test(path)) return { follow: true, kind: "pdf" };
  if (host === "github.com" || host === "www.github.com") {
    return segments.length >= 2 && !GITHUB_NOT_REPO.has(segments[0].toLowerCase())
      ? { follow: true, kind: "github" }
      : { follow: false, reason: "a GitHub page that is not a repository" };
  }
  if (VIDEO_HOSTS.test(host)) return { follow: false, reason: "a video, kept as a link only" };
  if (segments.length === 0) return { follow: false, reason: "a site's homepage" };
  if (segments.length === 1 && PRODUCT.has(segments[0].toLowerCase())) {
    return { follow: false, reason: "a product page" };
  }
  return { follow: true, kind: "page" };
}

/**
 * Where a t.co link goes, read off its answer without following it: the 301's
 * Location, or the target t.co writes into the page it serves some clients.
 */
export function tcoTarget(status: number, location: string | null, body: string): string | null {
  if (status >= 300 && status < 400 && location) return location;
  const refresh = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i.exec(body);
  if (refresh) return refresh[1].replace(/&amp;/g, "&");
  const title = /<title>\s*(https?:\/\/[^<\s]+)\s*<\/title>/i.exec(body);
  return title ? title[1].replace(/&amp;/g, "&") : null;
}
