// A study's graph expansion on file (docs/info/92 「数据」): the positives it
// walked from, the negatives it steered away from, and each stream it read —
// recommendations, and every walked positive's citations and references — with
// the arXiv papers that stream kept. One file per round in the run directory,
// local and never synced (`graph-read.json`, `graph-read-2.json`), rewritten
// after every stream so a resumed run reads only the streams not on file and a
// retry reads again the ones that did not come back.

import type { StateFs } from "./run-state";

export const GRAPH_READ_FILE = "graph-read.json";
export const GRAPH_READ_2_FILE = "graph-read-2.json";

export type GraphRound = 1 | 2;

/** Why a paper is a positive: a seed, the reader's latest label, or a first-round score standing in for both. */
export type GraphWhy = "seed" | "pinned" | "yes" | "provisional";
export type GraphStreamKind = "rec" | "cites" | "refs";
export type GraphLibrary = "s2" | "openalex";
export type GraphOutcome = "ok" | "empty" | "hub" | "not_found" | "rate_limited" | "cooling_down" | "failed";

// Types, not interfaces: they go to disk as JSON.
export type GraphPositive = {
  /** The pool key, `arxiv:<id>`. */
  key: string;
  title: string;
  why: GraphWhy;
  s2: string | null;
  openAlex: string | null;
  citationCount: number | null;
  /** Its citations and references were walked (the first MAX_WALKED positives). */
  walked: boolean;
};

export type GraphPaper = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string;
  citationCount: number | null;
};

export type GraphStream = {
  /** "rec", "cites:<positive key>" or "refs:<positive key>". */
  id: string;
  kind: GraphStreamKind;
  /** The positive keys it started from. */
  from: string[];
  /** The library that answered; null when none did. */
  library: GraphLibrary | null;
  outcome: GraphOutcome;
  /** Papers the library returned, before the window and the arXiv filter. */
  total: number;
  papers: GraphPaper[];
  /** When it was read, ISO. */
  at: string;
};

export type GraphRead = {
  version: 1;
  positives: GraphPositive[];
  /** Pool keys. */
  negatives: string[];
  streams: GraphStream[];
  /** Papers found with a DOI and no arXiv id: kept out of the pool, counted. */
  doiOnly: { count: number; titles: string[] };
};

/** The outcomes a retry reads again; the rest are an answer. */
export const RETRIED_OUTCOMES: readonly GraphOutcome[] = ["rate_limited", "cooling_down", "failed"];

/** How many DOI-only titles the file keeps. */
export const DOI_ONLY_TITLES = 5;

export function graphReadFile(round: GraphRound): string {
  return round === 1 ? GRAPH_READ_FILE : GRAPH_READ_2_FILE;
}

/** A stream's id: "rec", or the walk's kind and the positive it walked from. */
export function graphStreamId(kind: GraphStreamKind, positiveKey?: string): string {
  if (kind === "rec") return "rec";
  if (!positiveKey) throw new Error(`a ${kind} stream needs the positive it walks from`);
  return `${kind}:${positiveKey}`;
}

export function emptyGraphRead(positives: GraphPositive[], negatives: string[]): GraphRead {
  return { version: 1, positives, negatives, streams: [], doiOnly: { count: 0, titles: [] } };
}

/** The read with this stream on file, in place of any earlier one with its id. */
export function withStream(read: GraphRead, stream: GraphStream): GraphRead {
  const at = read.streams.findIndex((s) => s.id === stream.id);
  const streams = at < 0 ? [...read.streams, stream] : read.streams.map((s, i) => (i === at ? stream : s));
  return { ...read, streams };
}

/** The read with more DOI-only papers counted, the first few titles kept. */
export function withDoiOnly(read: GraphRead, titles: string[]): GraphRead {
  return {
    ...read,
    doiOnly: {
      count: read.doiOnly.count + titles.length,
      titles: [...read.doiOnly.titles, ...titles].slice(0, DOI_ONLY_TITLES),
    },
  };
}

const WHYS: readonly string[] = ["seed", "pinned", "yes", "provisional"];
const KINDS: readonly string[] = ["rec", "cites", "refs"];
const LIBRARIES: readonly string[] = ["s2", "openalex"];
const OUTCOMES: readonly string[] = ["ok", "empty", "hub", "not_found", "rate_limited", "cooling_down", "failed"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isString) : []);

function readPositive(v: unknown): GraphPositive | null {
  if (!isObject(v) || !isString(v.key) || !isString(v.title) || !WHYS.includes(v.why as string)) return null;
  return {
    key: v.key,
    title: v.title,
    why: v.why as GraphWhy,
    s2: isString(v.s2) ? v.s2 : null,
    openAlex: isString(v.openAlex) ? v.openAlex : null,
    citationCount: isCount(v.citationCount) ? v.citationCount : null,
    walked: v.walked === true,
  };
}

function readPaper(v: unknown): GraphPaper | null {
  if (!isObject(v) || !isString(v.arxivId) || !v.arxivId || !isString(v.title)) return null;
  return {
    arxivId: v.arxivId,
    title: v.title,
    abstract: isString(v.abstract) ? v.abstract : "",
    authors: strings(v.authors),
    publishedAt: isString(v.publishedAt) ? v.publishedAt : "",
    citationCount: isCount(v.citationCount) ? v.citationCount : null,
  };
}

function readStream(v: unknown): GraphStream | null {
  if (!isObject(v) || !isString(v.id) || !KINDS.includes(v.kind as string) || !OUTCOMES.includes(v.outcome as string)) {
    return null;
  }
  if (!Array.isArray(v.papers)) return null;
  return {
    id: v.id,
    kind: v.kind as GraphStreamKind,
    from: strings(v.from),
    library: LIBRARIES.includes(v.library as string) ? (v.library as GraphLibrary) : null,
    outcome: v.outcome as GraphOutcome,
    total: typeof v.total === "number" && Number.isFinite(v.total) ? v.total : 0,
    papers: v.papers.map(readPaper).filter((p): p is GraphPaper => p !== null),
    at: isString(v.at) ? v.at : "",
  };
}

/**
 * The file's text as a read, or null when it is not one (another version, not
 * JSON): the run then reads the graph again. A stream or positive that does not
 * read is dropped, so its stream is read again rather than trusted half-written.
 */
export function parseGraphRead(text: string): GraphRead | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.positives) || !Array.isArray(raw.streams)) return null;
  const doiOnly = isObject(raw.doiOnly) ? raw.doiOnly : {};
  // A stream id once: the last one written wins.
  const streams = new Map<string, GraphStream>();
  for (const s of raw.streams.map(readStream)) {
    if (!s) continue;
    streams.delete(s.id);
    streams.set(s.id, s);
  }
  return {
    version: 1,
    positives: raw.positives.map(readPositive).filter((p): p is GraphPositive => p !== null),
    negatives: strings(raw.negatives),
    streams: [...streams.values()],
    doiOnly: {
      count: typeof doiOnly.count === "number" && Number.isFinite(doiOnly.count) ? doiOnly.count : 0,
      titles: strings(doiOnly.titles).slice(0, DOI_ONLY_TITLES),
    },
  };
}

export async function saveGraphRead(fs: StateFs, dir: string, read: GraphRead, round: GraphRound = 1): Promise<void> {
  await fs.writeAtomic(`${dir}/${graphReadFile(round)}`, JSON.stringify(read));
}

export async function loadGraphRead(fs: StateFs, dir: string, round: GraphRound = 1): Promise<GraphRead | null> {
  const path = `${dir}/${graphReadFile(round)}`;
  if (!(await fs.exists(path))) return null;
  try {
    return parseGraphRead(await fs.readText(path));
  } catch {
    return null;
  }
}
