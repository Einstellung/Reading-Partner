// update_topic_search and stop_topic_search (docs/info/88 记忆回写, 不关注了).
// Unlike propose they write straight away: an answer the reader just gave and
// "I don't care about this any more" are both already their decision, and the
// receipt says where it went.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/durable/contract";
import type { Statement } from "../../memory";
import { asStrings, asString } from "../../platform/std/json";
import { t } from "../../i18n";
import { stopFollowing } from "./apply";
import { ANSWER_SCHEMA, QUERY_SCHEMA, draftAnswers, draftQueries } from "./propose-tool";
import {
  applyTopicSearchUpdate,
  isEmptyUpdate,
  resolveTopicSearch,
  type TopicSearchUpdate,
} from "./topic-searches";
import type { TopicSearch } from "./types";

export interface EditToolDeps {
  searches(): Promise<TopicSearch[]>;
  /** The searches as last seen, without waiting: the running line is made in one step. */
  known(): readonly TopicSearch[];
  change(id: string, change: (s: TopicSearch) => TopicSearch): Promise<TopicSearch | null>;
  setLapsed(id: string, lapsed: boolean): Promise<Statement | null>;
  now(): number;
}

/** What a running line calls the search the model named: its name, or what was said when it is not known. */
export function searchLabelName(raw: unknown, known: readonly TopicSearch[]): string {
  const said = String(raw ?? "");
  return resolveTopicSearch(said, known)?.name ?? said;
}

const list = (add: unknown, remove: unknown) => ({ add: asStrings(add), remove: asStrings(remove) });

/** The tool's arguments as an update. Exported for the tests. */
export function updateFromArgs(args: Record<string, unknown>): TopicSearchUpdate {
  return {
    ...(typeof args.scope === "string" ? { scope: args.scope } : {}),
    want: list(args.addWant, args.removeWant),
    avoid: list(args.addAvoid, args.removeAvoid),
    judgments: list(args.addJudgments, args.removeJudgments),
    anchors: list(args.addAnchors, args.removeAnchors),
    pick: asStrings(args.pickSubtopics),
    unpick: asStrings(args.unpickSubtopics),
    addSubtopics: asStrings(args.addSubtopics),
    ...(Array.isArray(args.queries) ? { queries: draftQueries(args.queries) } : {}),
    answers: draftAnswers(args.answers),
  };
}

function unknownSearch(raw: string, searches: readonly TopicSearch[]): string {
  return (
    `"${raw}" is not one of the reader's topic searches, so nothing was changed. ` +
    (searches.length
      ? `They have:\n${searches.map((s) => `- ${s.name} (id: ${s.id}, ${s.status})`).join("\n")}`
      : "They have none.")
  );
}

const strings = (description: string) => Type.Optional(Type.Array(Type.String(), { description }));

export function buildUpdateTopicSearchTool(deps: EditToolDeps): AgentTool {
  return {
    name: "update_topic_search",
    label: (args) => t("info.tool.updatingTopicSearch", { name: searchLabelName(args.searchId, deps.known()) }),
    effect: "write",
    description:
      "Change a topic search the reader follows, when they say something that holds only for this " +
      "topic ('no funding news here', 'materials: only experimentally verified'). Writes at once. " +
      "Pass the reader's question and answer in `answers`, word for word. What holds for the " +
      "reader in general goes to statement_write as a profile instead; a sentence with both goes " +
      "to both.",
    parameters: Type.Object({
      searchId: Type.String({ description: "The search's id (ts-…) or name." }),
      scope: Type.Optional(Type.String({ description: "A new scope paragraph, replacing the old." })),
      addWant: strings("Add to what the reader wants."),
      removeWant: strings("Remove from what the reader wants."),
      addAvoid: strings("Add to what the reader does not want."),
      removeAvoid: strings("Remove from what the reader does not want."),
      addJudgments: strings("Judgements you said out loud that the reader accepted."),
      removeJudgments: strings("Judgements the reader corrected."),
      addAnchors: strings("Disambiguating words to add."),
      removeAnchors: strings("Disambiguating words to drop."),
      pickSubtopics: strings("Subtopics (id or name) to follow."),
      unpickSubtopics: strings("Subtopics (id or name) to stop following."),
      addSubtopics: strings("New subtopics to follow."),
      queries: Type.Optional(
        Type.Array(QUERY_SCHEMA, { description: "All queries anew, when the subtopics changed." }),
      ),
      answers: Type.Optional(Type.Array(ANSWER_SCHEMA, { description: "The reader's answers, word for word." })),
    }),
    execute: async (args) => {
      const raw = asString(args.searchId).trim();
      const searches = await deps.searches();
      const search = resolveTopicSearch(raw, searches);
      if (!search) return { text: unknownSearch(raw, searches), receipt: null };
      const update = updateFromArgs(args);
      if (isEmptyUpdate(update)) {
        return { text: `Nothing to change on "${search.name}": the call carried no change.`, receipt: null };
      }
      const now = deps.now();
      const written = await deps.change(search.id, (s) => applyTopicSearchUpdate(s, update, now));
      if (!written) throw new Error(`The topic search "${search.name}" could not be written.`);
      return {
        text:
          `Saved to the topic search "${written.name}" (revision ${written.revision}). Tell the reader ` +
          `in one line that it went into this topic.`,
        receipt: { label: t("info.tool.savedToTopic"), summary: written.name },
      };
    },
  };
}

export function buildStopTopicSearchTool(deps: EditToolDeps): AgentTool {
  return {
    name: "stop_topic_search",
    label: (args) => t("info.tool.stoppingTopicSearch", { name: searchLabelName(args.searchId, deps.known()) }),
    effect: "write",
    description:
      "Stop a topic search when the reader says they no longer care about it. Never on your own " +
      "initiative. No more runs; its concern is marked lapsed. Nothing is deleted, and drafting it " +
      "again with propose_topic_search (searchId) follows it again.",
    parameters: Type.Object({
      searchId: Type.String({ description: "The search's id (ts-…) or name." }),
    }),
    execute: async (args) => {
      const raw = asString(args.searchId).trim();
      const searches = await deps.searches();
      const search = resolveTopicSearch(raw, searches);
      if (!search) return { text: unknownSearch(raw, searches), receipt: null };
      if (search.status === "stopped") {
        return { text: `"${search.name}" was already stopped.`, receipt: null };
      }
      const stopped = await stopFollowing(search.id, deps);
      if (!stopped) throw new Error(`The topic search "${search.name}" could not be written.`);
      return {
        text: `Stopped "${stopped.name}". Its record and concern are kept, the concern marked lapsed.`,
        receipt: { label: t("info.tool.stoppedFollowing"), summary: stopped.name },
      };
    },
  };
}
