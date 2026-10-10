// Every tool any desk can offer, for the durable runtime's process-wide tool
// registrations (docs/soul/87, "一个回合"). A registration only needs the
// tool's name, description, schema and replay; a call resolves the real tool
// through its conversation's desk (legion/durable/tools.ts), so the deps these
// factories are built with here are never used and are inert stand-ins. The
// factories and the tools they mount are the roster of
// tests/soul/tool-contract.test.ts.
//
// Built at app start, after the shell registered its places: go_to is mounted
// only when there is a place to go to.

import { buildObservationTools } from "../../../memory/observations/tools";
import { buildStatementTools } from "../../../memory/statements/tools";
import { buildProposeTopicTool } from "../../../memory/filing/propose";
import { buildDelegateTools } from "../../../soul/delegate";
import { buildPlaceTools } from "../../../soul/places";
import { buildCatalogueTools } from "../../../soul/catalogue";
import { buildConversationTools } from "../../../conversations/tools";
import { buildReadingTools } from "../../../reading/context";
import { buildReadChapterTool } from "../../../reading/lecture/tools";
import { buildFigureTools } from "../../../reading/figures/tools";
import { buildTranslateTools } from "../../../reading/translate/tool";
import { buildSourceTools as buildPrepSourceTools } from "../../../reading/prep/papers/source-tool";
import { buildClassroomTools } from "../../../reading/prep/papers/tools";
import { buildSupplementTools } from "../../../reading/ingest/remove-tool";
import { buildReadSupplementTools } from "../../../reading/ingest/read-supplement-tool";
import { buildSavedArticleTools } from "../../../reading/saved/saved-article-tools";
import { buildCitationTools } from "../../../reading/papers/citation-tool";
import { buildPaperSearchTools } from "../../../reading/papers/search-tool";
import { buildRetellTools } from "../../../reading/retell/tools";
import { buildArrangeTools } from "../../../reading/talk/tools";
import { buildSourceTools } from "../../../info/sources/source-tools";
import { buildCompanionTools } from "../../../info/briefer/companion-tools";
import { buildReadPageTool } from "../../../info/sources/read-page-tool";
import { buildTaskingTools } from "../../../info/tasking/tools";
import { buildResearchAgent } from "../../../reading/papers/research-agent";
import { subagentTool } from "../../../legion/subagent/tool";
import type { AgentTool } from "../../../legion/execute/contract";

const inert = (value: unknown): never => value as never;
const noFetch = async () => new Response("");

export function appToolCatalog(): AgentTool[] {
  const tools: AgentTool[] = [
    ...buildObservationTools(inert({ listObservations: async () => [] })),
    // statement_write mounts only on a reader message it can date (statements/tools.ts).
    ...buildStatementTools(inert({ store: {}, threadId: "catalog", message: { role: "user", text: "", ts: 1 } })),
    buildProposeTopicTool(inert({ topics: async () => [], onTopicCard: () => {}, threadId: "" })),
    ...buildDelegateTools({}),
    ...buildPlaceTools(),
    ...buildCatalogueTools(inert({})),
    ...buildConversationTools(inert({}), inert({})),
    ...buildReadingTools(
      inert({
        currentFulltext: { status: "ok", pages: [""] },
        materials: [{ label: "", fulltext: { status: "ok", pages: [""] }, annotations: [{ page: 1, text: "", comment: "" }] }],
      }),
    ),
    buildReadChapterTool(inert({ chapters: [], pages: async () => [] })),
    ...buildFigureTools(inert({ figures: [{ id: "1", caption: "" }], modelSupportsImages: true })),
    ...buildTranslateTools(inert({ find: async () => null, busy: async () => false, start: async () => ({ ok: false }) })),
    ...buildPrepSourceTools(inert({ start: async () => ({ runId: "" }) })),
    ...buildClassroomTools(() => []),
    ...buildSupplementTools(inert({ list: async () => [], remove: async () => {} })),
    ...buildReadSupplementTools(inert({ list: async () => [], fulltext: async () => null })),
    ...buildSavedArticleTools(inert({ list: async () => [], add: async () => ({ status: "failed" }) })),
    ...buildCitationTools(inert({ fetchFn: noFetch, canIngest: false })),
    ...buildPaperSearchTools(inert({ search: async () => [], canIngest: false })),
    ...buildRetellTools(inert({ chapters: [], record: async () => {}, read: async () => null, outline: async () => null })),
    ...buildArrangeTools(inert({ readOutline: async () => null, editOutline: async () => null })),
    ...buildSourceTools(inert({ fetchFn: noFetch, extract: async () => null, addSource: async () => {}, onProbeCard: () => {} })),
    buildReadPageTool(inert({ fetchFn: noFetch })),
    ...buildTaskingTools({}),
    subagentTool(buildResearchAgent(inert({})), inert({})),
    ...buildCompanionTools(
      inert({
        fetchFn: noFetch,
        extract: async () => null,
        addSource: async () => {},
        onProbeCard: () => {},
        startBriefing: () => "started",
        labs: { labs: async () => [], sources: async () => [], onLabCard: () => {}, threadId: "" },
        siteSignIn: { signInSites: async () => [], openSignIn: async () => ({ closed: true, elapsedMs: 0 }) },
      }),
    ),
  ];
  const byName = new Map<string, AgentTool>();
  for (const tool of tools) if (!byName.has(tool.name)) byName.set(tool.name, tool);
  return [...byName.values()];
}
