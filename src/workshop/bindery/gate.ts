// The quality gate (docs/85): a manuscript with nothing to read in it does not
// become a document. An empty body, a body too short to be the thing that was
// asked for, or the text a site shows instead of its content (a sign-in wall, a
// page that is only a JavaScript shell) is turned back with a reason, and no
// EPUB is built, so the shelf never gets a book that opens onto
// "JavaScript is not available".

import { MIN_BODY_CHARS } from "../extract/readable-select";
import { manuscriptText, type Manuscript } from "./manuscript";

export type RejectionReason =
  | "empty"
  | "too-short"
  | "login-wall"
  | "no-adapter"
  /** The site did not serve what a site adapter asked it for. */
  | "unreachable";

/** Why material did not become a document. `message` is an English clause. */
export interface Rejection {
  ok: false;
  reason: RejectionReason;
  message: string;
}

export function rejection(reason: RejectionReason, message: string): Rejection {
  return { ok: false, reason, message };
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

/** What the gate is told by the adapter that made the manuscript. */
export interface GateOptions {
  /** The shortest body that counts as content. MIN_BODY_CHARS when absent. */
  minChars?: number;
}

/** Null when the manuscript may be built, else why not. */
export function gateManuscript(m: Manuscript, opts: GateOptions = {}): Rejection | null {
  const text = manuscriptText(m).trim();
  if (text === "") return rejection("empty", "the page has no body text");
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
