// The quality gate (docs/85): a manuscript with nothing to read in it does not
// become a document. An empty body, a body too short to be the thing that was
// asked for, or the text a site shows instead of its content (a sign-in wall, a
// page that is only a JavaScript shell) is turned back with a reason, and no
// EPUB is built, so the shelf never gets a book that opens onto
// "JavaScript is not available".
//
// A fetched page is also inspected before anything is cut out of it
// (`inspectFetchedPage`): a 200 can be a bot challenge, a consent wall, a
// script shell or an error page, so what was read is judged by what it holds,
// not by its status code.

import { MIN_BODY_CHARS } from "../extract/readable-select";
import { manuscriptText, type Manuscript } from "./manuscript";

export type RejectionReason =
  | "empty"
  | "too-short"
  | "login-wall"
  | "no-adapter"
  /** The site did not serve what a site adapter asked it for. */
  | "unreachable"
  /** A bot challenge or an access-denied page stands where the content should be. */
  | "blocked"
  /** A page that is only scripts: almost no visible text without running them. */
  | "js-shell"
  /** Not what a text route can read: a PDF's raw bytes decoded as text. */
  | "wrong-content"
  /** A page that answered 200 but says it is not there (a soft 404). */
  | "error-page"
  /** More bytes than the reader takes in. */
  | "too-large"
  /** The site rate-limited the request, or its host is cooling down from one. */
  | "rate-limited";

/** Why material did not become a document. `message` is an English clause. */
export interface Rejection {
  ok: false;
  reason: RejectionReason;
  message: string;
  /** The HTTP status the site answered with, when that is why. */
  status?: number;
}

export function rejection(reason: RejectionReason, message: string, status?: number): Rejection {
  return status === undefined ? { ok: false, reason, message } : { ok: false, reason, message, status };
}

export function isRejection(value: unknown): value is Rejection {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

/**
 * What a site shows in place of its content. Matched against the body text,
 * and only when the body is short: a long article that quotes one of these
 * sentences is still an article.
 */
export const WALL_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  // x.com and twitter.com without a session or without script.
  { pattern: /javascript is not available/i, label: "JavaScript is not available" },
  // Cloudflare's interstitial and the many sites that copy its wording.
  {
    pattern: /enable javascript and cookies to continue/i,
    label: "Enable JavaScript and cookies to continue",
  },
  // A single-page app's <noscript>, create-react-app's wording and its kin.
  {
    pattern: /you need to enable javascript to (?:run|use|view) this/i,
    label: "You need to enable JavaScript",
  },
  { pattern: /please (?:enable|turn on) javascript/i, label: "Please enable JavaScript" },
  {
    pattern: /(?:sign|log) ?in to (?:continue|view|see|read)/i,
    label: "Sign in to continue",
  },
];

/** Above this many characters the wall patterns are not consulted. */
export const WALL_MAX_CHARS = 1500;

/**
 * Markers only a bot challenge or a block page carries, matched in the raw HTML
 * at any length: a Cloudflare challenge's options object and form, DataDome's
 * and PerimeterX's captchas, Imperva's incident line, Anubis's challenge. A
 * protected site's ordinary pages load Cloudflare's challenge script too, so
 * the script's path is not one of them.
 */
export const BLOCK_MARKERS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /window\._cf_chl_opt\b|\bcf-browser-verification\b|id=["']challenge-form["']/i, label: "a Cloudflare challenge" },
  { pattern: /<title>\s*(?:just a moment\.\.\.|attention required! \| cloudflare)\s*<\/title>/i, label: "a Cloudflare challenge" },
  { pattern: /captcha-delivery\.com/i, label: "a DataDome captcha" },
  { pattern: /id=["']px-captcha["']/i, label: "a PerimeterX captcha" },
  { pattern: /incapsula incident id/i, label: "an Imperva block page" },
  { pattern: /\banubis_challenge\b|making sure you(?:'|&#39;|’)re not a bot/i, label: "an Anubis challenge" },
];

/** A consent page served in place of the content: its form posts to the consent host. */
const CONSENT_FORM = /<form\b[^>]*action=["']https:\/\/consent\.(?:google|youtube|yahoo)\.com/i;

/**
 * What a bot check, a consent wall or an error page says, matched in the
 * visible text only when it is short (WALL_MAX_CHARS), like the wall patterns:
 * an article about captchas is still an article.
 */
export const SHORT_PAGE_PATTERNS: readonly { pattern: RegExp; reason: RejectionReason; label: string }[] = [
  {
    pattern: /verify(?:ing)? (?:that )?you are (?:a )?human|checking (?:if the site connection is secure|your browser)|are you a robot|unusual traffic from your (?:computer|network)/i,
    reason: "blocked",
    label: "a bot check",
  },
  { pattern: /^\s*access denied\b|you don(?:'|’)t have permission to access/im, reason: "blocked", label: "an access-denied page" },
  {
    pattern: /we value your privacy|before you continue to|accept all cookies|manage (?:cookie|privacy) (?:preferences|settings)/i,
    reason: "login-wall",
    label: "a cookie consent wall",
  },
  {
    pattern: /\b404\b[^\n]{0,20}not found|page (?:not found|cannot be found)|this page (?:doesn(?:'|’)t|does not) exist/i,
    reason: "error-page",
    label: "an error page",
  },
];

/** A page with fewer visible characters than this holds nothing to read. */
export const MIN_VISIBLE_CHARS = 50;

/** A PDF's raw bytes read as text: two of three of its syntax tokens, at any length. */
export function looksLikeRawPdf(text: string): boolean {
  const head = text.slice(0, 200_000);
  return [/%PDF-\d/, /\bendobj\b/, /\/FlateDecode\b/].filter((p) => p.test(head)).length >= 2;
}

/**
 * A fetched page judged by its structure, before anything is cut out of it:
 * raw PDF bytes; a block page's markers at any length; a consent form; scripts
 * around a body with almost no visible text (a script shell). Null when it may
 * be read. `toText` turns HTML into visible text (extract/sanitize.ts
 * htmlToText, which drops scripts and styles).
 */
export function inspectFetchedPage(html: string, toText: (html: string) => string): Rejection | null {
  if (looksLikeRawPdf(html)) return rejection("wrong-content", "the page is a PDF's raw bytes read as text");
  const marker = BLOCK_MARKERS.find((m) => m.pattern.test(html));
  if (marker) return rejection("blocked", `the page is ${marker.label}, not the content`);
  if (CONSENT_FORM.test(html)) return rejection("login-wall", "the page is a cookie consent wall, not the content");
  const body = /<body\b[\s\S]*/i.exec(html)?.[0] ?? html.replace(/<head\b[\s\S]*?<\/head>/i, "");
  const visible = toText(body).trim();
  // A short page without scripts is left to the extractor and the gate's length floor.
  if (visible.length >= MIN_VISIBLE_CHARS || !/<script\b/i.test(html)) return null;
  return rejection("js-shell", `the page is a script shell with ${visible.length} characters of visible text`);
}

/**
 * The article cut out of a scraped page, when it is short, judged by what it
 * says: a bot check, a consent wall or an error page that the extractor took
 * for the article. The cut-out text, not the whole page, so a real short
 * article under a cookie banner still reads. Null when it may be read.
 */
export function inspectArticleText(text: string): Rejection | null {
  const t = text.trim();
  if (t.length > WALL_MAX_CHARS) return null;
  const page = SHORT_PAGE_PATTERNS.find((p) => p.pattern.test(t));
  return page ? rejection(page.reason, `the page is ${page.label}, not the content`) : null;
}

/** What the gate is told by the adapter that made the manuscript. */
export interface GateOptions {
  /** The shortest body that counts as content. MIN_BODY_CHARS when absent. */
  minChars?: number;
}

/** Null when the manuscript may be built, else why not. */
export function gateManuscript(m: Manuscript, opts: GateOptions = {}): Rejection | null {
  const text = manuscriptText(m).trim();
  if (text === "") return rejection("empty", "the page has no body text");
  if (looksLikeRawPdf(text)) return rejection("wrong-content", "the text is a PDF's raw bytes, not its text layer");
  if (text.length <= WALL_MAX_CHARS) {
    const wall = WALL_PATTERNS.find((w) => w.pattern.test(text));
    if (wall) {
      return rejection(
        "login-wall",
        `the page is a sign-in or script wall ("${wall.label}"), not the content`,
      );
    }
  }
  const min = opts.minChars ?? MIN_BODY_CHARS;
  if (text.length < min) {
    return rejection(
      "too-short",
      `the body is only ${text.length} characters, fewer than the ${min} a document needs`,
    );
  }
  return null;
}
