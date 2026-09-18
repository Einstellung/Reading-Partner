// Every tool the app mounts, against the contract in legion/execute/contract.ts:
// a label the reader can read, an effect, and a gate that is one of the declared
// ones. The list below is the roster — like tests/layering.test.ts's LAYER table,
// it is written out by hand, and a factory that grows or loses a tool fails here
// until the roster is brought up to date. Nothing scans the source: a regex over
// field declarations reads a commented-out tool as a mounted one.
//
// The deps are the smallest fakes each factory will take. They are cast rather
// than built out, because what is under test is the tool's own declaration and
// not what its execute does with a store.

import { expect, test } from "bun:test";
import { buildObservationTools } from "../../src/memory/observations/tools";
import { buildStatementTools } from "../../src/memory/statements/tools";
import { buildProposeTopicTool } from "../../src/memory/filing/propose";
import { buildDelegateTools } from "../../src/soul/delegate";
import { buildPlaceTools } from "../../src/soul/places";
import { registerPlaces } from "../../src/desk";
import { buildCatalogueTools } from "../../src/soul/catalogue";
import { buildConversationTools } from "../../src/conversations/tools";
import { buildReadingTools } from "../../src/reading/context";
import { buildReadChapterTool } from "../../src/reading/lecture/tools";
import { buildFigureTools } from "../../src/reading/figures/tools";
import { buildTranslateTools } from "../../src/reading/translate/tool";
import { buildSourceTools as buildPrepSourceTools } from "../../src/reading/prep/papers/source-tool";
import { buildClassroomTools } from "../../src/reading/prep/papers/tools";
import { buildSupplementTools } from "../../src/reading/ingest/remove-tool";
import { buildSavedArticleTools } from "../../src/reading/saved-article-tools";
import { buildCitationTools } from "../../src/reading/papers/citation-tool";
import { buildPaperSearchTools } from "../../src/reading/papers/search-tool";
import { buildRetellTools } from "../../src/reading/retell/tools";
import { buildArrangeTools } from "../../src/reading/talk/tools";
import { buildSourceTools } from "../../src/info/sources/source-tools";
import { buildCompanionTools } from "../../src/info/briefer/companion-tools";
import { buildReadPageTool } from "../../src/info/extract/read-page-tool";
import { buildTaskingTools } from "../../src/info/tasking/tools";
import { subagentTool } from "../../src/legion/subagent/tool";
import { normalizeToolResult, toolLabel } from "../../src/legion/execute/tool-result";
import type { AgentTool } from "../../src/legion/execute/contract";

const any = (v: unknown): any => v as any;

// buildPlaceTools mounts nothing when the shell has registered no place, so the
// roster would be asserting against an empty list. One place is enough.
const unregisterPlaces = registerPlaces([
  { id: "sources", name: "Sources", go: async () => {} } as any,
]);

// Factory -> the tool names it is expected to mount, in any order.
const ROSTER: { where: string; tools: AgentTool[]; names: string[] }[] = [
  {
    where: "memory/observations",
    tools: buildObservationTools(any({ listObservations: async () => [] })),
    names: ["observation_search", "observation_read", "observation_update"],
  },
  {
    where: "memory/statements",
    // statement_write is only mounted on a user message it can date from
    // (tools.ts), so the fake context carries one.
    tools: buildStatementTools(
      any({ store: {}, threadId: "t", message: { role: "user", text: "I read at night", ts: 1_700_000_000_000 } }),
    ),
    names: ["statement_write"],
  },
  {
    where: "memory/filing",
    tools: [buildProposeTopicTool(any({ topics: async () => [], onTopicCard: () => {}, threadId: "t" }))],
    names: ["propose_topic"],
  },
  {
    where: "soul/delegate",
    tools: buildDelegateTools({ kinds: () => ["research-literature"] }),
    names: ["delegate"],
  },
  { where: "soul/places", tools: buildPlaceTools(), names: ["go_to"] },
  { where: "soul/catalogue", tools: buildCatalogueTools(any({})), names: ["list_palace", "list_kind"] },
  {
    where: "conversations",
    tools: buildConversationTools(any({}), any({})),
    names: ["search_conversations", "read_conversation"],
  },
  {
    where: "reading/context",
    // Each of the three is mounted only when the topic has what it reads
    // (context.ts), so the fake topic has a full text and a mark.
    tools: buildReadingTools(
      any({
        currentFulltext: { status: "ok", pages: ["one"] },
        materials: [
          {
            label: "A book",
            fulltext: { status: "ok", pages: ["one"] },
            annotations: [{ page: 1, text: "a line", comment: "" }],
          },
        ],
      }),
    ),
    names: ["read_pages", "search_topic", "read_annotations"],
  },
  {
    where: "reading/lecture",
    tools: [buildReadChapterTool(any({ chapters: [], pages: async () => [] }))],
    names: ["read_chapter"],
  },
  {
    where: "reading/figures",
    // Not mounted at all on a document with no figures (tools.ts).
    tools: buildFigureTools(any({ figures: [{ id: "3", caption: "A chart" }], modelSupportsImages: true })),
    names: ["view_figure"],
  },
  {
    where: "reading/translate",
    tools: buildTranslateTools(any({ find: async () => null, busy: async () => false, start: async () => ({ ok: false }) })),
    names: ["translate_document"],
  },
  {
    where: "reading/prep/papers/source-tool",
    tools: buildPrepSourceTools(any({ start: async () => ({ runId: "r" }) })),
    names: ["ingest_url"],
  },
  { where: "reading/prep/papers/tools", tools: buildClassroomTools(() => []), names: ["read_paper", "read_note"] },
  {
    where: "reading/ingest",
    tools: buildSupplementTools(any({ list: async () => [], remove: async () => {} })),
    names: ["remove_supplement"],
  },
  {
    where: "reading/saved-articles",
    tools: buildSavedArticleTools(any({ list: async () => [], add: async () => ({ status: "failed" }) })),
    names: ["list_saved_articles", "add_saved_article"],
  },
  {
    where: "reading/papers/citations",
    tools: buildCitationTools(any({ fetchFn: async () => new Response(""), canIngest: false })),
    names: ["find_paper", "walk_citations"],
  },
  {
    where: "reading/papers/search",
    tools: buildPaperSearchTools(any({ search: async () => [], canIngest: false })),
    names: ["search_papers"],
  },
  {
    where: "reading/retell",
    tools: buildRetellTools(any({ chapters: [], record: async () => {}, read: async () => null, outline: async () => null })),
    names: ["record_chapter_decision", "read_chapter_note", "read_retell_outline"],
  },
  {
    where: "reading/talk",
    tools: buildArrangeTools(any({ readOutline: async () => null, editOutline: async () => null })),
    names: [
      "set_talk_spine",
      "write_talk_segment",
      "move_talk_segment",
      "remove_talk_segment",
      "read_talk_outline",
    ],
  },
  {
    where: "info/sources",
    tools: buildSourceTools(any({ fetchFn: async () => new Response(""), extract: async () => null, addSource: async () => {}, onProbeCard: () => {} })),
    names: ["probe_source", "trial_source", "add_source"],
  },
  {
    where: "info/extract",
    tools: [buildReadPageTool(any({ fetchFn: async () => new Response("") }))],
    names: ["read_page"],
  },
  {
    where: "info/tasking",
    tools: buildTaskingTools({}),
    // A tasking run reads pages the way the collection does, so it mounts the
    // extractor's read_page as well as its own three.
    names: ["search_cables", "read_cable", "read_picture", "read_page"],
  },
  {
    where: "legion/subagent",
    tools: [
      subagentTool(
        any({ name: "research_literature", description: "d", label: "Searching the literature", tools: [] }),
        any({}),
      ),
    ],
    names: ["research_literature"],
  },
];

// Put the registry back the way it was found: it is process-wide, and the next
// file's "no places registered, no tool" is a real assertion.
unregisterPlaces();

// The companion's own tools are built separately: its factory takes a bag of
// deps and drops whole tools when a dep is missing, so the roster is what a
// fully-equipped info turn mounts.
const companion = buildCompanionTools(
  any({
    fetchFn: async () => new Response(""),
    extract: async () => null,
    addSource: async () => {},
    onProbeCard: () => {},
    startBriefing: () => "started",
    labs: { labs: async () => [], sources: async () => [], onLabCard: () => {}, threadId: "t" },
    siteSignIn: { signInSites: async () => [], openSignIn: async () => ({ closed: true, elapsedMs: 1 }) },
  }),
);

test("every factory mounts the tools the roster names", () => {
  for (const { where, tools, names } of ROSTER) {
    expect(`${where}: ${tools.map((t) => t.name).sort().join(",")}`).toBe(
      `${where}: ${[...names].sort().join(",")}`,
    );
  }
});

test("the info companion mounts its own tools plus the source tools", () => {
  expect(companion.map((t) => t.name).sort()).toEqual(
    [
      "add_source",
      "archive_lab",
      "generate_briefing",
      "open_site_sign_in",
      "probe_source",
      "propose_lab",
      "read_page",
      "trial_source",
    ].sort(),
  );
});

const EFFECTS = new Set(["read", "write"]);
const GATES = new Set(["card", "trial", "instruction"]);

test("every tool declares a label, an effect and — where it has one — a known gate", () => {
  const all = [...ROSTER.flatMap((r) => r.tools), ...companion];
  expect(all.length).toBeGreaterThan(40);
  for (const tool of all) {
    // Called with no arguments at all: a label that reaches into args without
    // guarding would throw here, and the trace would go blank on a call the
    // model made loosely.
    const label = tool.label({});
    expect(`${tool.name}: ${typeof label} ${label.trim().length > 0}`).toBe(`${tool.name}: string true`);
    // The reader reads these as a list; a trailing period reads as a sentence.
    expect(`${tool.name}: ${label.endsWith(".")}`).toBe(`${tool.name}: false`);
    expect(`${tool.name}: ${tool.effect}`).toBe(`${tool.name}: ${EFFECTS.has(tool.effect) ? tool.effect : "?"}`);
    if (tool.gate !== undefined) {
      expect(`${tool.name}: ${tool.gate}`).toBe(`${tool.name}: ${GATES.has(tool.gate) ? tool.gate : "?"}`);
      expect(`${tool.name}: ${tool.effect}`).toBe(`${tool.name}: write`);
    }
  }
});

test("toolLabel falls back to the tool's name when its label throws or is blank", () => {
  const thrower = any({
    name: "boom",
    label: () => {
      throw new Error("no");
    },
  });
  expect(toolLabel(thrower, {})).toBe("boom");
  expect(toolLabel(any({ name: "blank", label: () => "   " }), {})).toBe("blank");
});

test("a write that comes back without a receipt is turned into an error", () => {
  const write = any({ name: "record_it", effect: "write" });
  expect(() => normalizeToolResult(write, "done")).toThrow(/without a receipt/);
  expect(() => normalizeToolResult(write, { text: "done" })).toThrow(/without a receipt/);
  // null is the write saying it wrote nothing this time, which is allowed.
  expect(normalizeToolResult(write, { text: "nothing matched", receipt: null }).receipt).toBeUndefined();
  const receipt = { label: "Wrote it down", summary: "the thing" };
  expect(normalizeToolResult(write, { text: "done", receipt }).receipt).toEqual(receipt);
  // A read never needs one.
  expect(normalizeToolResult(any({ name: "look", effect: "read" }), "found").receipt).toBeUndefined();
});

