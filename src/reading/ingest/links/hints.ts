// What a link looks like, said to the model as a hint on its candidate line
// (docs/86 「工具」). A hint is not a rule: the model weighs it against what the
// post or page says about the link. The words are the program's, worked out
// from the URL alone, plus where the link was found.
//
// The kinds are the ones the rule-based fan-out used to follow or skip
// (docs/84 「实现」): a file on Drive, a PDF, a GitHub repository, a site some
// adapter reads, an ordinary page; and the shapes that are rarely what a post is
// about, a homepage, a sign-in page, a product page, a video, a link back into X.

export type HintKind =
  | "site"
  | "drive"
  | "pdf"
  | "github"
  | "page"
  | "drive-page"
  | "github-page"
  | "homepage"
  | "sign-in"
  | "product"
  | "video"
  | "x"
  | "tco"
  | "not-web";

export interface LinkHint {
  kind: HintKind;
  /** The word on the candidate line: "github repo", "homepage", "site:arxiv". */
  label: string;
  /** Why a link of this kind is usually not the content, in a clause. */
  reason?: string;
}

/** Where on a post or page a link was found. */
export type LinkOrigin = "body" | "card" | "self-reply" | "quoted" | "article" | "page";

export const ORIGIN_LABEL: Record<LinkOrigin, string> = {
  body: "body",
  card: "card",
  "self-reply": "author's reply",
  quoted: "quoted post",
  article: "in Article",
  page: "page",
};

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
const X_HOSTS = /^(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)$/i;

const hint = (kind: HintKind, label: string, reason?: string): LinkHint =>
  reason === undefined ? { kind, label } : { kind, label, reason };

/**
 * The hint for a link (already expanded). `siteOf` names the site adapter that
 * reads it, when one does (workshop/bindery's registry): the domain that
 * registered the adapter knows the site better than these rules.
 */
export function classifyOutbound(raw: string, siteOf: (url: string) => string | null): LinkHint {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return hint("not-web", "not a web link", "not a web link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return hint("not-web", "not a web link", "not a web link");
  }
  const host = url.hostname.toLowerCase();
  if (X_HOSTS.test(host)) return hint("x", "X link", "a link to another page on X");
  if (host === "t.co") return hint("tco", "unresolved t.co", "a t.co link that did not resolve");
  const site = siteOf(url.toString());
  if (site !== null) return hint("site", `site:${site}`);

  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter((s) => s !== "");
  if (SIGN_IN.test(path)) return hint("sign-in", "sign-in page", "a sign-in page");
  if (host === "drive.google.com" || host === "docs.google.com") {
    return /\/d\/[\w-]+/.test(path) || url.searchParams.has("id")
      ? hint("drive", "Drive file")
      : hint("drive-page", "Drive page, not a file", "a Google Drive page that is not a file");
  }
  if (/\.pdf$/i.test(path)) return hint("pdf", "PDF");
  if (host === "github.com" || host === "www.github.com") {
    return segments.length >= 2 && !GITHUB_NOT_REPO.has(segments[0].toLowerCase())
      ? hint("github", "github repo")
      : hint("github-page", "GitHub page, not a repo", "a GitHub page that is not a repository");
  }
  if (VIDEO_HOSTS.test(host)) return hint("video", "video", "a video, kept as a link only");
  if (segments.length === 0) return hint("homepage", "homepage", "a site's homepage");
  if (segments.length === 1 && PRODUCT.has(segments[0].toLowerCase())) {
    return hint("product", "product page", "a product page");
  }
  return hint("page", "web page");
}
