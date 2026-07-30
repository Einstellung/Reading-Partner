// Public surface of the academic literature search (docs/24).

export {
  searchPapers,
  LIBRARIES,
  LIBRARY_LABELS,
  type PaperCandidate,
  type PaperLibrary,
  type PaperSearchFn,
  type PaperSearchOptions,
  type PaperSearchResult,
} from "./paper-search";
export { buildPaperSearchTools, SEARCH_PAPERS_PROMPT } from "./search-tool";
export {
  resolvePaper,
  walkCitations,
  type CitationDeps,
  type ResolveResult,
  type WalkDirection,
  type WalkResult,
} from "./citations";
export { buildCitationTools, SEARCH_CITATIONS_PROMPT } from "./citation-tool";
