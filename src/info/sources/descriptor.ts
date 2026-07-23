// Source descriptor (docs/17): a source is declarative data, not code. A
// descriptor names how to discover a source's items (discovery) and where the
// body text comes from (fulltext); the generic engine (engine.ts) executes it.
// Builtin sources use the same format (no special-case code path). This module
// is the type + runtime validator + the small path helpers the engine shares;
// it is pure (no DOM/fs) so it and the engine are unit-testable in bun.

// A readable-article extraction: (page HTML, its URL) -> body. Wired to
// Readability/defuddle in readable.ts; injected into the engine so the collect
// logic stays DOM-free and testable. (Was defined in qbitai.ts.)
export type ExtractReadable = (
  html: string,
  url: string,
) => { title: string; contentHtml: string; textContent: string } | null;

// A field path into a JSON row: one dot-path, or several candidates tried in
// order (the first non-empty wins) so undocumented APIs with key variants
// (publishedAt / published_at) resolve without brittle per-source code.
export type FieldPath = string | string[];

// --- discovery: how to get the item list ----------------------------------

// Native feed. One parser eats RSS 2.0 / Atom / RDF; `format` is an optional
// hint, the parser auto-detects otherwise.
export interface FeedDiscovery {
  kind: "feed";
  url: string;
  format?: "rss" | "atom" | "rdf";
}

// SSR site with no feed: fetch a list page and pull article links out of its
// HTML by regex, then fetch each page (fulltext must be "fetch-page").
export interface ListpageDiscovery {
  kind: "listpage";
  url: string;
  // Regex (source string) matched against href values; the whole match is the
  // link. e.g. "/article/\\d+\\.html".
  linkPattern: string;
  // Origin used to resolve relative links; defaults to the list url's origin.
  base?: string;
}

// A public JSON list endpoint. Covers two shapes: a list whose rows carry only
// summaries + an id for a detail endpoint (jiqizhixin), and a list whose rows
// already carry the full body (wp-json content.rendered, xinzhiyuan).
export interface JsonApiDiscovery {
  kind: "json-api";
  listUrl: string;
  // Dot-path to the array of rows inside the response; empty/omitted = the
  // response is itself the array.
  itemsPath?: string;
  fields: {
    id: FieldPath;
    title: FieldPath;
    // Article url; if omitted/empty, built from urlTemplate with {id}.
    url?: FieldPath;
    publishedAt?: FieldPath;
    summary?: FieldPath;
    // Full body already present in the row (wp-json content.rendered).
    content?: FieldPath;
  };
  // "https://host/articles/{id}" — used when a row has no url field.
  urlTemplate?: string;
  headers?: Record<string, string>;
}

// A short-item live stream (jin10). Reserved for M-info-3; the engine rejects
// it for now so the format can carry stream sources without executing them.
export interface StreamDiscovery {
  kind: "stream";
  url: string;
  headers?: Record<string, string>;
}

export type Discovery =
  | FeedDiscovery
  | ListpageDiscovery
  | JsonApiDiscovery
  | StreamDiscovery;

// --- fulltext: where the body comes from -----------------------------------

// The body is already in the discovery result: a feed field (content:encoded /
// summary / description / content), or a json-api row's content field.
export interface FulltextFeedField {
  mode: "feed-field";
  // Which feed field holds the body. Ignored for json-api (uses fields.content).
  field?: "content:encoded" | "content" | "summary" | "description";
  // Paid posts arrive truncated with a CTA (Substack "Read more"); when the body
  // contains this marker the item is flagged summary-only for triage.
  truncationMarker?: string;
}

// Fetch the article page and run the readable extractor over it.
export interface FulltextFetchPage {
  mode: "fetch-page";
}

// Fetch a per-item detail endpoint and read the body from a JSON path.
export interface FulltextDetailEndpoint {
  mode: "detail-endpoint";
  // "https://host/articles/{id}.json"
  urlTemplate: string;
  contentPath: FieldPath;
  titlePath?: FieldPath;
  publishedAtPath?: FieldPath;
  headers?: Record<string, string>;
}

// Discovery-layer only: title + summary, no body (arXiv, HN, Bloomberg RSS).
// Triage handles these at summary level; the user opens the origin externally.
export interface FulltextNone {
  mode: "none";
}

export type Fulltext =
  | FulltextFeedField
  | FulltextFetchPage
  | FulltextDetailEndpoint
  | FulltextNone;

// --- the descriptor --------------------------------------------------------

export interface SourceDescriptor {
  id: string;
  // Display name shown on cards/tags.
  name: string;
  // The lane/line this source belongs to (free string: "AI", "robotics", ...).
  line: string;
  discovery: Discovery;
  fulltext: Fulltext;
  // Metered-paywall site: never fetch the article page, even as a fallback when
  // the feed body is short (IEEE Spectrum, MIT TR). The feed body is all we use.
  noFetchPage?: boolean;
  // Request identity overrides (default UA lives in sources.ts).
  userAgent?: string;
  // Max items pulled per run (each fetch-page/detail item is a request).
  limit?: number;
  enabled: boolean;
  // True for factory presets; user-added sources omit it.
  builtin?: boolean;
}

// --- path helpers (shared with the engine) ---------------------------------

// Read a dot-path ("content.rendered") out of a JSON value. Returns undefined
// on any missing link. No array indexing — rows are handled by the engine.
export function dotPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// First non-empty string reachable by any of the candidate paths. Tolerant:
// non-string leaves (numbers, ids) are coerced; missing paths are skipped.
export function pickString(obj: unknown, paths: FieldPath | undefined): string {
  if (paths == null) return "";
  const list = Array.isArray(paths) ? paths : [paths];
  for (const p of list) {
    const v = dotPath(obj, p);
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

// --- validation ------------------------------------------------------------

export type ValidateOutcome =
  | { ok: true; descriptor: SourceDescriptor }
  | { ok: false; error: string };

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function fieldOk(v: unknown): boolean {
  if (isStr(v)) return true;
  return Array.isArray(v) && v.length > 0 && v.every((x) => isStr(x));
}

function validateDiscovery(d: unknown): string | null {
  if (!d || typeof d !== "object") return "discovery must be an object";
  const kind = (d as { kind?: unknown }).kind;
  const o = d as Record<string, unknown>;
  switch (kind) {
    case "feed":
      return isStr(o.url) ? null : "feed discovery needs a url";
    case "listpage":
      if (!isStr(o.url)) return "listpage discovery needs a url";
      return isStr(o.linkPattern) ? null : "listpage discovery needs a linkPattern";
    case "json-api": {
      if (!isStr(o.listUrl)) return "json-api discovery needs a listUrl";
      const f = o.fields as Record<string, unknown> | undefined;
      if (!f || typeof f !== "object") return "json-api discovery needs fields";
      if (!fieldOk(f.id)) return "json-api fields.id is required";
      if (!fieldOk(f.title)) return "json-api fields.title is required";
      return null;
    }
    case "stream":
      return isStr(o.url) ? null : "stream discovery needs a url";
    default:
      return `unknown discovery.kind: ${String(kind)}`;
  }
}

function validateFulltext(f: unknown): string | null {
  if (!f || typeof f !== "object") return "fulltext must be an object";
  const mode = (f as { mode?: unknown }).mode;
  const o = f as Record<string, unknown>;
  switch (mode) {
    case "feed-field":
    case "fetch-page":
    case "none":
      return null;
    case "detail-endpoint":
      if (!isStr(o.urlTemplate)) return "detail-endpoint needs a urlTemplate";
      return fieldOk(o.contentPath) ? null : "detail-endpoint needs a contentPath";
    default:
      return `unknown fulltext.mode: ${String(mode)}`;
  }
}

// Validate an untrusted descriptor (loaded from disk / produced by the AI probe)
// before the engine runs it. Structural only; it does not test the network.
export function validateDescriptor(raw: unknown): ValidateOutcome {
  if (!raw || typeof raw !== "object") return { ok: false, error: "descriptor must be an object" };
  const o = raw as Record<string, unknown>;
  if (!isStr(o.id)) return { ok: false, error: "id is required" };
  if (!isStr(o.name)) return { ok: false, error: "name is required" };
  if (typeof o.line !== "string") return { ok: false, error: "line is required" };
  if (typeof o.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
  const dErr = validateDiscovery(o.discovery);
  if (dErr) return { ok: false, error: dErr };
  const fErr = validateFulltext(o.fulltext);
  if (fErr) return { ok: false, error: fErr };
  // A listpage/fetch-page pairing is the only one that makes sense for SSR
  // sites; a listpage with any other fulltext can't retrieve bodies.
  const dk = (o.discovery as { kind?: unknown }).kind;
  const fm = (o.fulltext as { mode?: unknown }).mode;
  if (dk === "listpage" && fm !== "fetch-page") {
    return { ok: false, error: "listpage discovery requires fetch-page fulltext" };
  }
  return { ok: true, descriptor: raw as SourceDescriptor };
}
