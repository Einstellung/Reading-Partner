// Public surface of the academic literature search (docs/24).
//
// The reader's turn wires two things from here: the research sub-agent and
// find_paper. search_papers and walk_citations are reachable only as that
// sub-agent's own tools.

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
export { buildPaperSearchTools } from "./search-tool";
export {
  resolvePaper,
  walkCitations,
  type CitationDeps,
  type ResolveResult,
  type WalkDirection,
  type WalkResult,
} from "./citations";
export {
  buildCitationTools,
  buildFindPaperTool,
  buildWalkCitationsTool,
  FIND_PAPER_PROMPT,
} from "./citation-tool";
export {
  buildResearchAgent,
  buildResearchTools,
  researchStatusLabel,
  RESEARCH_BRIEF_TOKENS,
  RESEARCH_LABEL,
  RESEARCH_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  RESEARCH_TOOL_NAME,
  RESEARCH_TURN_ROUNDS,
  type ResearchAgentDeps,
} from "./research-agent";
