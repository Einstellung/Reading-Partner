// Sanitizing a book's CSS. The book's stylesheet reaches the page (docs/63):
// its <style> blocks, its linked sheets and its style attributes are kept, laid
// over the app's own baseline inside the page card's shadow root. What is not
// kept is anything that reaches out of the book — the network, the app's own
// page, script — or out of the card.
//
// Dropped whole: @import (a fetch), @charset and @namespace (meaningless once
// the sheet is inline), @page and @keyframes (paper does not animate, and the
// page box is ours). Dropped per declaration: behavior, bindings, expression()
// and anything spelling a script scheme; a url() that is not an entry of the
// archive; and the positions that escape a clipping box — fixed and sticky are
// written back as relative, so the box the rule was sizing keeps its size.
//
// The output is the input of the next pass: sanitizeCss(sanitizeCss(x)) equals
// sanitizeCss(x) byte for byte, which the sanitized document's own idempotence
// test depends on (docs/pitfall/126). Every rule and declaration is written
// back from its parsed parts in one canonical spelling.
//
// This is a block parser, not a CSS parser: it knows strings, comments,
// braces, and the ";" between declarations, and nothing about what a value
// means. That is enough to decide what to keep, and it is what keeps the test
// for "does this rule escape" a string test rather than a grammar.

/** How a url() reference is answered: the entry it resolves to, or null to drop it. */
export type CssUrlResolver = (raw: string) => string | null;

export interface CssSanitizeOptions {
  /** Resolves a url() to what should be written in its place. */
  resolveUrl: CssUrlResolver;
  /** Family names the sheet's own @font-face rules declare; filled in by sanitizeCss. */
  fontFaces?: ReadonlySet<string>;
  /** Inside an @font-face block, where font-family names the face rather than choosing one. */
  inFontFace?: boolean;
}

// The faces shipped with the app (public/fonts, styles.css). A book's
// font-family is rewritten onto these: a named family the book does not embed
// resolves to whatever a device has, and a generic one to the device's
// default, and either way the same book would paginate differently on two
// devices (docs/63, docs/pitfall/268). Monospace stays generic — code is set
// in whatever the device has, and the pages it lands on may differ by a line.
export const SHIPPED_FAMILIES = ["Noto Serif", "Noto Serif CJK SC"] as const;
export const SHIPPED_FONT_STACK = '"Noto Serif", "Noto Serif CJK SC", serif';

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-rounded", "math", "emoji", "fangsong",
]);
const MONO_FAMILIES = new Set(["monospace", "ui-monospace"]);
const KEYWORDS = new Set(["inherit", "initial", "unset", "revert"]);

function unquote(name: string): string {
  const t = name.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/**
 * A font-family value with every family the pages cannot count on removed:
 * the book's own embedded faces and the shipped ones stay, monospace stays
 * generic, everything else becomes the shipped stack. Null when nothing is
 * left to say.
 */
function fontFamilyValue(value: string, faces: ReadonlySet<string> | undefined): string | null {
  const important = /!important$/i.test(value);
  const raw = value.replace(/\s*!important$/i, "");
  if (KEYWORDS.has(raw.trim().toLowerCase())) return value;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  let shipped = false;
  for (const part of splitOutside(raw, ",")) {
    const name = unquote(part);
    if (name === "") continue;
    const lower = name.toLowerCase();
    if (MONO_FAMILIES.has(lower)) {
      push(lower);
      continue;
    }
    if ((SHIPPED_FAMILIES as readonly string[]).includes(name) || faces?.has(name)) {
      push(`"${name}"`);
      continue;
    }
    if (!GENERIC_FAMILIES.has(lower) && !faces?.has(name)) {
      // A named family the book does not carry: replaced by the shipped stack.
      shipped = true;
      continue;
    }
    shipped = true;
  }
  if (shipped || out.some((s) => s.startsWith('"'))) {
    for (const name of SHIPPED_FAMILIES) push(`"${name}"`);
    push("serif");
  }
  if (out.length === 0) return null;
  return out.join(", ") + (important ? " !important" : "");
}

const FONT_FACE_NAME = /@font-face\s*\{[^}]*?font-family\s*:\s*("([^"]+)"|'([^']+)'|([^;}]+))/gi;

/** The family names a sheet declares with @font-face. */
export function declaredFontFaces(css: string): Set<string> {
  const faces = new Set<string>();
  for (const m of css.matchAll(FONT_FACE_NAME)) faces.add((m[2] ?? m[3] ?? m[4] ?? "").trim());
  return faces;
}

const DROP_AT_RULES = new Set([
  "import", "charset", "namespace", "page", "keyframes", "-webkit-keyframes", "-moz-keyframes",
  "viewport", "-ms-viewport", "counter-style", "property", "layer",
]);
const NESTED_AT_RULES = new Set(["media", "supports", "container"]);
const DROP_PROPERTIES = new Set([
  "behavior", "-moz-binding", "-webkit-binding", "binding", "filter", "-ms-filter", "zoom",
  "content-visibility", "pointer-events", "cursor",
]);
const ESCAPING_POSITIONS = new Set(["fixed", "sticky", "-webkit-sticky"]);

// --- lexing --------------------------------------------------------------

function stripComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index just past the string starting at `i` (which is a quote). */
function skipString(css: string, i: number): number {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length) {
    if (css[j] === "\\") {
      j += 2;
      continue;
    }
    if (css[j] === quote) return j + 1;
    if (css[j] === "\n") return j; // an unterminated string ends at the line
    j++;
  }
  return css.length;
}

/** The matching "}" for the "{" at `open`, or the end of the text. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i = skipString(css, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return css.length;
}

/** Split on a separator outside strings and parentheses. */
function splitOutside(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = skipString(text, i);
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(text.slice(start));
  return out;
}

// --- declarations -----------------------------------------------------------

const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)/gi;
const SCRIPT_VALUE = /expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|-moz-binding|behavior\s*:/i;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** One declaration, sanitized: the canonical "prop: value" or null to drop it. */
function sanitizeDeclaration(raw: string, opts: CssSanitizeOptions): string | null {
  const colon = raw.indexOf(":");
  if (colon < 0) return null;
  const prop = raw.slice(0, colon).trim().toLowerCase();
  let value = collapse(raw.slice(colon + 1));
  if (prop === "" || value === "") return null;
  if (!/^-?[a-z][a-z0-9-]*$/.test(prop)) return null;
  if (DROP_PROPERTIES.has(prop)) return null;
  if (SCRIPT_VALUE.test(value)) return null;
  if (prop === "position" && ESCAPING_POSITIONS.has(value.toLowerCase().replace(/\s*!important$/, ""))) {
    value = value.toLowerCase().includes("!important") ? "relative !important" : "relative";
  }
  if (prop === "font-family" && !opts.inFontFace) {
    const families = fontFamilyValue(value, opts.fontFaces);
    if (families === null) return null;
    value = families;
  }
  // The shorthand carries a family list at its end; one naming a face the
  // pages cannot count on is dropped whole rather than half-rewritten.
  if (prop === "font" && /[,"']/.test(value)) return null;
  if (prop === "font") {
    value = value.replace(/\b(serif|sans-serif|system-ui|cursive|fantasy)\s*$/i, SHIPPED_FONT_STACK);
  }
  let dropped = false;
  value = value.replace(URL_TOKEN, (_m, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
    const target = (dq ?? sq ?? bare ?? "").trim();
    // A scheme is a fetch, whatever the resolver would say about the name.
    const resolved = target === "" || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) ? null : opts.resolveUrl(target);
    if (resolved === null) {
      dropped = true;
      return "";
    }
    return `url("${resolved.replace(/["\\]/g, "")}")`;
  });
  if (dropped) return null;
  return `${prop}: ${value}`;
}

/** A declaration list (a style attribute, a rule body), sanitized. */
export function sanitizeDeclarations(body: string, opts: CssSanitizeOptions): string {
  const kept: string[] = [];
  for (const part of splitOutside(stripComments(body), ";")) {
    const decl = sanitizeDeclaration(part, opts);
    if (decl !== null) kept.push(decl);
  }
  return kept.join("; ");
}

// --- rules -----------------------------------------------------------------

function atRuleName(prelude: string): string {
  const m = /^@([a-zA-Z-]+)/.exec(prelude);
  return m ? m[1].toLowerCase() : "";
}

function sanitizeBlock(css: string, opts: CssSanitizeOptions): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    const semi = css.indexOf(";", i);
    // A statement at-rule (no block) ends at ";" — @import, @charset, @namespace.
    if (open < 0 || (semi >= 0 && semi < open && collapse(css.slice(i, semi)).startsWith("@"))) {
      const end = semi >= 0 ? semi : css.length;
      i = end + 1;
      if (open < 0) break;
      continue;
    }
    const prelude = collapse(css.slice(i, open));
    const close = matchBrace(css, open);
    const body = css.slice(open + 1, close);
    i = close + 1;
    if (prelude === "") continue;
    if (prelude.startsWith("@")) {
      const name = atRuleName(prelude);
      if (DROP_AT_RULES.has(name)) continue;
      if (NESTED_AT_RULES.has(name)) {
        const inner = sanitizeBlock(body, opts);
        if (inner.length > 0) out.push(`${prelude} { ${inner.join(" ")} }`);
        continue;
      }
      if (name === "font-face") {
        const decls = sanitizeDeclarations(body, { ...opts, inFontFace: true });
        // A face with no src it may load is a face that loads nothing.
        if (/(^|; )src: /.test(decls)) out.push(`@font-face { ${decls} }`);
        continue;
      }
      continue; // any other at-rule: unknown, therefore out
    }
    if (/[<>]/.test(prelude) && /</.test(prelude)) continue; // markup where a selector goes
    const decls = sanitizeDeclarations(body, opts);
    if (decls !== "") out.push(`${prelude} { ${decls} }`);
  }
  return out;
}

/** A whole stylesheet, sanitized and written back in canonical form. */
export function sanitizeCss(css: string, opts: CssSanitizeOptions): string {
  const clean = stripComments(css);
  const withFaces = opts.fontFaces ? opts : { ...opts, fontFaces: declaredFontFaces(clean) };
  return sanitizeBlock(clean, withFaces).join("\n");
}

/**
 * The url() targets of an already-sanitized sheet, for the resource list: the
 * strings the resolver wrote back.
 */
export function cssUrls(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(URL_TOKEN)) out.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
  return out;
}

/** Rewrite every url() of a sanitized sheet through `map` (a blob URL, say). */
export function rewriteCssUrls(css: string, map: (target: string) => string | null): string {
  return css.replace(URL_TOKEN, (m, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
    const target = (dq ?? sq ?? bare ?? "").trim();
    const mapped = map(target);
    return mapped === null ? m : `url("${mapped.replace(/["\\]/g, "")}")`;
  });
}
