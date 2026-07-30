// Citation-graph traversal: from one paper to its neighbours in either direction
// (docs/24). This is snowballing, the standard way a literature search is actually
// done — backward to what a paper cites, forward to what cites it — and for the
// reading companion the forward direction is the useful one. A popular-science
// book can only cite work published before it went to press, so walking forward
// from a seed in its endnotes lands exactly on the years the reader is asking
// about.
//
// Two libraries expose both directions for free: OpenAlex (`referenced_works`, and
// a `cites:` filter) and Semantic Scholar (`/references`, `/citations`). They are
// not interchangeable, and which one leads depends on the direction — see
// WALK_ORDER.
//
// The forward direction is always ranked and capped. A seed worth asking about has
// hundreds to hundreds of thousands of citing papers; handed back unranked that is
// not a literature review, it is noise with citations. Everything except the
// fetches themselves is pure.

import {
  bareOpenAlexId,
  fetchOpenAlexCitedBy,
  fetchOpenAlexWork,
  fetchOpenAlexWorksByIds,
  OA_MAX_OR_IDS,
} from "./openalex";
import { type FetchFn } from "./http";
import { normalizeTitle } from "./match";
import {
  candidateBlock,
  describeFailure,
  fromOpenAlex,
  fromS2,
  LIBRARY_LABELS,
  normalizeDoi,
  REFERENCE_MATERIAL_LINE,
  searchPapers,
  withDeadline,
  LIBRARY_DEADLINE_MS,
  type PaperCandidate,
  type PaperLibrary,
  type PaperSearchFailure,
} from "./paper-search";
import { fetchS2Edges, fetchS2Paper, S2_CITATIONS_PAGE, S2_REFERENCES_PAGE } from "./s2";

// --- identifiers ---

export type PaperIdKind = "doi" | "arxiv" | "pmid" | "openalex" | "s2";

export interface PaperId {
  kind: PaperIdKind;
  value: string;
}

// Recognize an identifier in a free string, so the model can pass through whatever
// the previous tool result gave it — a DOI, an arXiv id, a PMID, an OpenAlex work
// id, a landing-page URL — without being told which is which. Null means "treat
// this as a title", which is the common case when the string came out of a book's
// endnotes.
//
// Deliberately conservative: a bare number is not a PMID (it is far more likely a
// year or a page), and a bare 4+4 digit string is only read as an arXiv id in the
// exact NNNN.NNNNN shape.
export function parsePaperId(input: string): PaperId | null {
  const s = input.trim();
  if (!s) return null;

  const doi = /\b(10\.\d{4,9}\/[^\s"'<>]+)/.exec(s);
  if (doi) {
    // A trailing bracket or period usually belongs to the sentence, not the DOI.
    const value = doi[1].replace(/[.,;)\]]+$/, "");
    return { kind: "doi", value };
  }

  const arxiv = /(?:arxiv[:\s/]+|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})/i.exec(s);
  if (arxiv) return { kind: "arxiv", value: arxiv[1] };
  // An old-style arXiv id ("cond-mat/0402594") is unambiguous on its own.
  const oldArxiv = /\b([a-z-]+(?:\.[A-Z]{2})?\/\d{7})\b/.exec(s);
  if (oldArxiv) return { kind: "arxiv", value: oldArxiv[1] };
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) return { kind: "arxiv", value: s.replace(/v\d+$/, "") };

  const pmid = /(?:pmid[:\s]+|pubmed\.ncbi\.nlm\.nih\.gov\/)(\d{1,9})/i.exec(s);
  if (pmid) return { kind: "pmid", value: pmid[1] };

  const oa = bareOpenAlexId(/(?:openalex\.org\/)?\b(W\d+)\b/.exec(s)?.[1]);
  if (oa) return { kind: "openalex", value: oa };

  // S2's own ids are 40 hex characters; nothing else in a citation looks like that.
  const s2 = /\b([0-9a-f]{40})\b/i.exec(s);
  if (s2) return { kind: "s2", value: s2[1].toLowerCase() };

  return null;
}

// How each library spells an identifier in a path segment. Null when that library
// cannot resolve that kind of id at all: OpenAlex has no arXiv lookup, and S2 does
// not know OpenAlex's ids.
export function openAlexHandle(id: PaperId): string | null {
  switch (id.kind) {
    case "doi":
      return `doi:${id.value}`;
    case "pmid":
      return `pmid:${id.value}`;
    case "openalex":
      return id.value;
    default:
      return null;
  }
}

export function s2Handle(id: PaperId): string | null {
  switch (id.kind) {
    case "doi":
      return `DOI:${id.value}`;
    case "arxiv":
      return `ARXIV:${id.value}`;
    case "pmid":
      return `PMID:${id.value}`;
    case "s2":
      return id.value;
    default:
      return null;
  }
}

// The handles a resolved candidate itself offers, for a follow-up call.
export function handlesFor(c: PaperCandidate): { openAlex: string | null; s2: string | null } {
  const doi = normalizeDoi(c.doi);
  return {
    openAlex: c.openAlexId ?? (doi ? `doi:${doi}` : c.pmid ? `pmid:${c.pmid}` : null),
    s2: c.s2PaperId ?? (doi ? `DOI:${doi}` : c.arxivId ? `ARXIV:${c.arxivId}` : c.pmid ? `PMID:${c.pmid}` : null),
  };
}

// --- resolution: a citation string or a title to one paper record ---

// This is not a citation parser and must not become one. A popular-science book's
// notes are endnotes, footnotes, author-year, sometimes just a book title or a bare
// URL; reading them is fuzzy text understanding, which the model does well and a
// regex does badly. So the model reads the note and hands over a title (or the
// whole citation string), and this only has to find the paper it names — or say it
// could not.
//
// How sure the match is. "id" means an identifier was resolved directly and there
// is nothing to doubt; the other two came from a title comparison and the caller is
// told which, because a wrong paper silently substituted for the right one is the
// worst outcome this tool has.
export type MatchConfidence = "id" | "exact" | "close";

export interface ResolveResult {
  paper: PaperCandidate | null;
  confidence: MatchConfidence | null;
  // What the input was read as, when it carried an identifier.
  identifier: PaperId | null;
  // Near misses, when nothing matched well enough. Shown so the model can see the
  // tool was not simply blind, and pick one itself if the reader confirms.
  nearMisses: PaperCandidate[];
  failures: PaperSearchFailure[];
}

// A normalized title has to be at least this long before containment counts as a
// match. Without the floor, a citation string mentioning "Brains" would resolve to
// any paper titled "Brains", which is precisely the confident wrong answer the
// whole design is trying to avoid.
export const MIN_MATCH_CHARS = 16;

// Best title match among candidates, and how sure it is. Exact normalized equality
// wins outright; otherwise a candidate whose title sits inside the query (the
// citation-string case, where the query is a whole reference and the title is part
// of it) or contains it (the query was a shortened title) counts as close.
export function pickResolved(
  candidates: PaperCandidate[],
  query: string,
): { paper: PaperCandidate; confidence: MatchConfidence } | null {
  const want = normalizeTitle(query);
  if (!want) return null;
  for (const c of candidates) {
    if (normalizeTitle(c.title) === want) return { paper: c, confidence: "exact" };
  }
  for (const c of candidates) {
    const got = normalizeTitle(c.title);
    if (got.length < MIN_MATCH_CHARS) continue;
    if (want.includes(got) || (want.length >= MIN_MATCH_CHARS && got.includes(want))) {
      return { paper: c, confidence: "close" };
    }
  }
  return null;
}

export interface CitationDeps {
  fetchFn?: FetchFn;
  s2ApiKey?: string;
  deadlineMs?: number;
}

// The two libraries consulted for a resolution. Not all four: these are the two the
// citation graph runs on, and a paper neither of them has an id for cannot be
// walked however well arXiv or PubMed knows it. The model is told to fall back to
// search_papers when this misses.
const RESOLVE_LIBRARIES: PaperLibrary[] = ["openalex", "semantic-scholar"];

// How many search hits to consider when the input is a title. Small: this is a
// lookup for one known paper, not a survey.
const RESOLVE_CANDIDATES = 5;

async function attempt<T>(
  library: PaperLibrary,
  work: () => Promise<T>,
  fallback: T,
  failures: PaperSearchFailure[],
  deadlineMs: number,
): Promise<T> {
  try {
    return await withDeadline(work(), deadlineMs);
  } catch (e) {
    failures.push({ library, reason: describeFailure(library, e) });
    return fallback;
  }
}

// Resolve an identifier through both libraries at once and merge the answers, so
// the record comes back carrying both an OpenAlex id and an S2 handle — the walk
// needs whichever of the two the direction calls for, and asking now costs one
// round trip instead of a second one later.
async function resolveByIdentifier(
  id: PaperId,
  deps: CitationDeps,
): Promise<{ paper: PaperCandidate | null; failures: PaperSearchFailure[] }> {
  const failures: PaperSearchFailure[] = [];
  const deadlineMs = deps.deadlineMs ?? LIBRARY_DEADLINE_MS;
  const oaHandle = openAlexHandle(id);
  const s2h = s2Handle(id);

  const [oa, s2] = await Promise.all([
    oaHandle
      ? attempt(
          "openalex",
          async () => (await fetchOpenAlexWork(oaHandle, deps.fetchFn))?.hit ?? null,
          null,
          failures,
          deadlineMs,
        )
      : null,
    s2h
      ? attempt(
          "semantic-scholar",
          () => fetchS2Paper(s2h, deps.fetchFn, deps.s2ApiKey),
          null,
          failures,
          deadlineMs,
        )
      : null,
  ]);

  const parts = [oa ? fromOpenAlex(oa) : null, s2 ? fromS2(s2) : null].filter(
    (p): p is PaperCandidate => p !== null,
  );
  if (parts.length === 0) return { paper: null, failures };
  // Merge by hand rather than through mergeCandidates: these are two views of one
  // paper looked up by the same id, so there is nothing to deduplicate — but the
  // titles can differ enough (S2 normalizes punctuation) that a title-keyed merge
  // would keep them apart.
  const merged = { ...parts[0], libraries: [...parts[0].libraries], authors: [...parts[0].authors] };
  for (const p of parts.slice(1)) {
    for (const lib of p.libraries) if (!merged.libraries.includes(lib)) merged.libraries.push(lib);
    merged.doi ??= p.doi;
    merged.arxivId ??= p.arxivId;
    merged.pmid ??= p.pmid;
    merged.openAlexId ??= p.openAlexId;
    merged.s2PaperId ??= p.s2PaperId;
    merged.venue ??= p.venue;
    merged.url ??= p.url;
    merged.year ??= p.year;
    merged.citedByCount ??= p.citedByCount;
    if (p.abstract.length > merged.abstract.length) merged.abstract = p.abstract;
    if (p.authors.length > merged.authors.length) merged.authors = p.authors;
  }
  return { paper: merged, failures };
}

// Find the paper a citation string, title or identifier names. Best effort, and
// honest when it fails: a null paper with the near misses attached, never a guess.
export async function resolvePaper(input: string, deps: CitationDeps = {}): Promise<ResolveResult> {
  const query = input.trim();
  const identifier = parsePaperId(query);

  if (identifier) {
    const { paper, failures } = await resolveByIdentifier(identifier, deps);
    if (paper) return { paper, confidence: "id", identifier, nearMisses: [], failures };
    // An identifier neither library knows. Fall through to a title search only if
    // there is something else in the string to search on — a bare DOI has nothing.
    const rest = query.replace(identifier.value, " ").trim();
    if (normalizeTitle(rest).length < MIN_MATCH_CHARS) {
      return { paper: null, confidence: null, identifier, nearMisses: [], failures };
    }
  }

  const search = await searchPapers(
    query,
    { limit: RESOLVE_CANDIDATES, libraries: RESOLVE_LIBRARIES },
    deps,
  );
  const hit = pickResolved(search.candidates, query);
  return {
    paper: hit?.paper ?? null,
    confidence: hit?.confidence ?? null,
    identifier,
    nearMisses: hit ? [] : search.candidates.slice(0, 3),
    failures: search.failures,
  };
}

// --- the walk ---

export type WalkDirection = "references" | "citations";

export const WALK_DIRECTIONS: WalkDirection[] = ["references", "citations"];

// Which library leads, per direction. The asymmetry is not a preference; each
// direction has exactly one library that can do it properly.
export const WALK_ORDER: Record<WalkDirection, PaperLibrary[]> = {
  // Backward, S2 first: one request returns the entire bibliography, so the ranking
  // that follows is over the complete set rather than a page of it, where OpenAlex
  // needs two requests and caps an id filter at 50. OpenAlex is the fallback for
  // the case S2 cannot serve — a publisher that has elided the reference list, which
  // comes back as `data: null` (see s2.ts).
  references: ["semantic-scholar", "openalex"],
  // Forward, OpenAlex first: it is the only one of the two that filters by date and
  // sorts by citation count server-side. S2's /citations takes no sort and silently
  // ignores `year=`, so it can only ever hand back an arbitrary page — usable as a
  // fallback, but the result has to admit it is a sample.
  citations: ["openalex", "semantic-scholar"],
};

export interface WalkOptions {
  sinceYear?: number | null;
  limit?: number;
}

export const WALK_DEFAULT_LIMIT = 10;
// Ceiling on rows from one walk. Higher than the topic search's 12 because a walk
// is a survey of one paper's neighbourhood and the rows are cheaper (a shorter
// abstract each), but still a ceiling: the forward direction can reach five figures
// of edges, and the whole point of the cap plus the ranking is that a turn's context
// is spent on the papers that matter rather than on the ones that happen to come
// back first.
export const WALK_MAX_LIMIT = 25;

// Abstract per row. Shorter than the topic search's 420: a walk returns more rows,
// and here the citation count and the year carry much of the triage that an abstract
// carries in a keyword search.
export const WALK_ABSTRACT_CHARS = 240;

export interface WalkResult {
  direction: WalkDirection;
  seed: PaperCandidate;
  papers: PaperCandidate[];
  // Which library answered, or null when none had edges to give.
  library: PaperLibrary | null;
  // Size of the edge set the answering library reported, before this call's limit.
  // Already narrowed by sinceYear when the library filtered server-side.
  total: number | null;
  // True when the rows were ranked out of a page rather than out of the whole edge
  // set, which makes them a sample and not the top of anything.
  sampled: boolean;
  failures: PaperSearchFailure[];
}

// Filter and rank edges here, for the libraries that cannot do it themselves.
// Citation count descending, unknown counts last. A paper whose year the library
// did not report is dropped when a year filter is set: it cannot be confirmed to
// qualify, and quietly including it would misreport the window the reader asked for.
export function rankEdges(papers: PaperCandidate[], opts: WalkOptions = {}): PaperCandidate[] {
  const since = opts.sinceYear ?? null;
  const kept = since === null ? papers : papers.filter((p) => p.year !== null && p.year >= since);
  return [...kept]
    .sort((a, b) => (b.citedByCount ?? -1) - (a.citedByCount ?? -1))
    .slice(0, opts.limit ?? WALK_DEFAULT_LIMIT);
}

interface Edges {
  papers: PaperCandidate[];
  total: number | null;
  sampled: boolean;
}

const NO_EDGES: Edges = { papers: [], total: null, sampled: false };

// The seed's OpenAlex work id, fetching it when the seed was resolved elsewhere.
// The `cites:` filter takes nothing else.
async function openAlexWorkId(seed: PaperCandidate, deps: CitationDeps): Promise<string | null> {
  if (seed.openAlexId) return seed.openAlexId;
  const handle = handlesFor(seed).openAlex;
  if (!handle) return null;
  return (await fetchOpenAlexWork(handle, deps.fetchFn))?.hit.openAlexId ?? null;
}

async function walkOpenAlex(
  seed: PaperCandidate,
  direction: WalkDirection,
  opts: WalkOptions,
  deps: CitationDeps,
): Promise<Edges> {
  const workId = await openAlexWorkId(seed, deps);
  if (!workId) return NO_EDGES;
  const limit = opts.limit ?? WALK_DEFAULT_LIMIT;

  if (direction === "citations") {
    // Filtered, sorted and capped by OpenAlex itself, so the rows are the top of
    // the whole edge set and meta.count says how large that set is.
    const page = await fetchOpenAlexCitedBy(workId, { limit, sinceYear: opts.sinceYear }, deps.fetchFn);
    return { papers: page.hits.map(fromOpenAlex), total: page.total, sampled: false };
  }

  const work = await fetchOpenAlexWork(workId, deps.fetchFn);
  const referenced = work?.referenced ?? [];
  if (referenced.length === 0) return NO_EDGES;
  const hits = await fetchOpenAlexWorksByIds(
    referenced,
    { limit, sinceYear: opts.sinceYear },
    deps.fetchFn,
  );
  return {
    papers: rankEdges(hits.map(fromOpenAlex), opts),
    total: referenced.length,
    // A longer bibliography than one id filter holds: the rows were ranked out of
    // its first 50 references, not out of all of them.
    sampled: referenced.length > OA_MAX_OR_IDS,
  };
}

async function walkS2(
  seed: PaperCandidate,
  direction: WalkDirection,
  opts: WalkOptions,
  deps: CitationDeps,
): Promise<Edges> {
  const handle = handlesFor(seed).s2;
  if (!handle) return NO_EDGES;
  const hits = await fetchS2Edges(handle, direction, deps.fetchFn, deps.s2ApiKey);
  if (hits.length === 0) return NO_EDGES;
  const papers = hits.map(fromS2);
  const page = direction === "references" ? S2_REFERENCES_PAGE : S2_CITATIONS_PAGE;
  return {
    papers: rankEdges(papers, opts),
    total: papers.length,
    // A full page back means there were probably more behind it, so the ranking was
    // over a slice. A bibliography never reaches its page size; a citation list of
    // anything well-known always does.
    sampled: hits.length >= page,
  };
}

// Walk one step out from a seed. Tries the libraries in the order the direction
// calls for and takes the first that has edges — falling through on an empty answer
// as well as on a failure, because "no edges" from S2 is routinely just a publisher
// having elided the reference list rather than a paper that cites nothing.
export async function walkCitations(
  seed: PaperCandidate,
  direction: WalkDirection,
  opts: WalkOptions = {},
  deps: CitationDeps = {},
): Promise<WalkResult> {
  const limit = Math.min(Math.max(1, opts.limit ?? WALK_DEFAULT_LIMIT), WALK_MAX_LIMIT);
  const bounded: WalkOptions = { ...opts, limit };
  const deadlineMs = deps.deadlineMs ?? LIBRARY_DEADLINE_MS;
  const failures: PaperSearchFailure[] = [];

  for (const library of WALK_ORDER[direction]) {
    const edges = await attempt(
      library,
      () =>
        library === "openalex"
          ? walkOpenAlex(seed, direction, bounded, deps)
          : walkS2(seed, direction, bounded, deps),
      NO_EDGES,
      failures,
      deadlineMs,
    );
    if (edges.papers.length > 0) {
      return {
        direction,
        seed,
        library,
        papers: edges.papers,
        total: edges.total,
        sampled: edges.sampled,
        failures,
      };
    }
  }
  return { direction, seed, papers: [], library: null, total: null, sampled: false, failures };
}

// --- rendering ---

function seedLine(seed: PaperCandidate): string {
  const year = seed.year !== null ? ` (${seed.year})` : "";
  return `"${seed.title}"${year}`;
}

export interface WalkFormatOptions {
  canIngest: boolean;
}

export function formatWalk(result: WalkResult, opts: WalkFormatOptions): string {
  const { direction, seed, papers, total, sampled, failures, library } = result;
  const what = direction === "references" ? "cited by" : "citing";
  const parts: string[] = [];

  if (papers.length === 0) {
    if (failures.length > 0) {
      parts.push(`No library could walk the ${direction} of ${seedLine(seed)}.`);
    } else if (direction === "citations") {
      parts.push(
        `Nothing found citing ${seedLine(seed)} — either nothing cites it yet, or nothing ` +
          `does within the years asked for.`,
      );
    } else {
      parts.push(`No reference list is available for ${seedLine(seed)}.`);
    }
    if (failures.length > 0) {
      parts.push(
        "Did not answer: " +
          failures.map((f) => `${LIBRARY_LABELS[f.library]} (${f.reason})`).join("; ") +
          ". Do not report this as an absence of research.",
      );
    }
    return parts.join("\n\n");
  }

  const scope = total !== null && total > papers.length ? ` of ${total}` : "";
  const ranked =
    direction === "citations"
      ? ", most-cited first"
      : ", most-cited first (the references this paper builds on)";
  const head =
    `${papers.length}${scope} papers ${what} ${seedLine(seed)}${ranked}. ` +
    `Source: ${library ? LIBRARY_LABELS[library] : "unknown"}. ${REFERENCE_MATERIAL_LINE}`;
  parts.push(head);
  parts.push(papers.map((p, i) => candidateBlock(p, i + 1, WALK_ABSTRACT_CHARS)).join("\n\n"));

  if (sampled) {
    parts.push(
      "This is a sample, not the top of the whole set: the library could not rank " +
        "the edges itself, so these were ranked out of one page of them. Say so if the " +
        "reader is relying on the list being exhaustive.",
    );
  }
  parts.push(
    opts.canIngest
      ? "To read one of these properly, ingest its link with add_source and then read_paper it."
      : "This conversation cannot fetch a paper — give the reader the link or DOI.",
  );
  if (failures.length > 0) {
    parts.push(
      "Also tried and did not answer: " +
        failures.map((f) => `${LIBRARY_LABELS[f.library]} (${f.reason})`).join("; ") + ".",
    );
  }
  return parts.join("\n\n");
}

export function formatResolved(result: ResolveResult, query: string): string {
  const { paper, confidence, nearMisses, failures } = result;
  if (!paper) {
    // The retry is named rather than merely invited. Measured 2026-07-30, a whole
    // endnote passed through verbatim ("Herculano-Houzel, S., Collins, C. E., … PNAS
    // 104, 3562-3567 (2007).") does not resolve: the author list, journal, volume and
    // page range are all query terms, and the paper falls out of the top five. The
    // same paper resolves exactly when the title alone is passed. The tool does not
    // strip the citation down itself — that is the fuzzy reading the model is better
    // at — so the recovery has to be spelled out instead.
    const parts = [
      `No paper found for "${query}". Do not guess which paper this is. If you passed a ` +
        `whole citation, call find_paper again with just the paper's title — the authors, ` +
        `journal, volume and page numbers all count as search terms and push the right ` +
        `paper out of reach. If a title alone also fails, say you could not identify it.`,
    ];
    if (nearMisses.length > 0) {
      parts.push(
        "Closest titles seen, none of which matched well enough to call the same paper:\n" +
          nearMisses.map((p, i) => candidateBlock(p, i + 1, 0)).join("\n\n"),
      );
    }
    if (failures.length > 0) {
      parts.push(
        "Did not answer: " +
          failures.map((f) => `${LIBRARY_LABELS[f.library]} (${f.reason})`).join("; ") + ".",
      );
    }
    return parts.join("\n\n");
  }

  const parts = [
    `${confidence === "close" ? "Closest match" : "Found"}: ${REFERENCE_MATERIAL_LINE}`,
    candidateBlock(paper, 1, WALK_ABSTRACT_CHARS),
  ];
  if (confidence === "close") {
    parts.push(
      "The title is not an exact match for what was asked, so check it is the same " +
        "paper before telling the reader it is.",
    );
  }
  const h = handlesFor(paper);
  parts.push(
    (h.openAlex || h.s2
      ? "Walk its citation graph with walk_citations: pass this paper's DOI or id as `paper`."
      : "No library id was found for this paper, so its citation graph cannot be walked.") +
      " Forward (`citations`) finds work published since, which is where recent research on a " +
      "book's topic lives; backward (`references`) finds what it was built on.",
  );
  return parts.join("\n\n");
}
