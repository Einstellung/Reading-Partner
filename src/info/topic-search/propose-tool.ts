// propose_topic_search (docs/info/88 起草：来回问): the door tool that draws the
// drafting card once Lumen and the reader have talked a topic through. Same
// shape as propose_lab (info/briefer/lab-tool.ts): the tool draws a card and
// writes nothing; the card's Apply writes the config and the concern
// (apply.ts), answered in the door chat's onCardAction.
//
// The model drafts the words. The program numbers the subtopics and queries,
// weighs the queries, resolves the topic and the existing concern it named,
// finds the message the reader opened with, and reads the desktop's heartbeat
// for when the first result can be expected.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/durable/contract";
import type { DeviceClaim } from "../../legion/claim";
import { messageAnchor, type Statement } from "../../memory";
import { asArray, asString, asStrings, isObject } from "../../platform/std/json";
import { t } from "../../i18n";
import type { TopicSearchProposalCardData } from "./cards";
import { firstRunEta } from "./eta";
import {
  activeNameTaken,
  numberQueries,
  numberSubtopics,
  resolveTopicSearch,
  type DraftQuery,
  type DraftSubtopic,
} from "./topic-searches";
import type { TopicSearch } from "./types";

/** A line the reader typed in this conversation. */
export interface ReaderLine {
  id?: string;
  ts: number;
  text: string;
}

export interface ProposeToolDeps {
  threadId: string;
  // The reader's lines so far, oldest first, read when the tool is called.
  readerLines(): readonly ReaderLine[];
  searches(): Promise<TopicSearch[]>;
  statements(): Promise<readonly Statement[]>;
  claims(): Promise<readonly DeviceClaim[]>;
  now(): number;
  raiseCard(card: TopicSearchProposalCardData): void;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The anchor of the message the reader opened with: the latest of their lines
 * that holds `quote` (whitespace and case folded), or their latest line when
 * none does or no quote was given. Null with no lines at all.
 */
export function openingAnchor(lines: readonly ReaderLine[], quote: string, threadId: string): string | null {
  if (lines.length === 0) return null;
  const wanted = squash(quote);
  let hit: ReaderLine | undefined;
  if (wanted) {
    for (let i = lines.length - 1; i >= 0 && !hit; i--) if (squash(lines[i].text).includes(wanted)) hit = lines[i];
  }
  const line = hit ?? lines[lines.length - 1];
  return messageAnchor({ ...(line.id ? { id: line.id } : {}), ts: line.ts }, threadId);
}

/** The concern the model pointed at, when it is a live concern. */
export function resolveConcern(raw: string, statements: readonly Statement[]): Statement | null {
  const wanted = raw.trim();
  if (!wanted) return null;
  return statements.find((s) => s.id === wanted && s.kind === "concern" && !s.supersededBy) ?? null;
}

function draftSubtopics(raw: unknown): DraftSubtopic[] {
  return asArray(raw)
    .filter(isObject)
    .map((s) => ({ name: asString(s.name), picked: s.picked !== false }));
}

export function draftQueries(raw: unknown): DraftQuery[] {
  return asArray(raw)
    .filter(isObject)
    .map((q) => ({
      subtopic: asString(q.subtopic),
      x: asString(q.x),
      arxiv: asString(q.arxiv),
      ranking: asString(q.ranking),
    }));
}

export function draftAnswers(raw: unknown): { asked: string; answer: string }[] {
  return asArray(raw)
    .filter(isObject)
    .map((a) => ({ asked: asString(a.asked).trim(), answer: asString(a.answer).trim() }))
    .filter((a) => a.answer !== "");
}

export const QUERY_SCHEMA = Type.Object({
  subtopic: Type.String({ description: "The subtopic's name or id; empty for a query over the whole topic." }),
  x: Type.String({ description: "Keywords as X posts on this would put them. No time words, no 'news'/'updates'." }),
  arxiv: Type.String({
    description:
      "2-4 short keywords as arXiv titles would put them, the most specific first, never a sentence " +
      "(every word must appear in the paper); empty when papers do not fit.",
  }),
  ranking: Type.String({ description: "One plain question a good result answers, for reranking." }),
});

export const ANSWER_SCHEMA = Type.Object({
  asked: Type.String({ description: "The question you asked." }),
  answer: Type.String({ description: "The reader's answer, word for word." }),
});

export function buildProposeTopicSearchTool(deps: ProposeToolDeps): AgentTool {
  return {
    name: "propose_topic_search",
    label: (args) => t("info.tool.draftingTopicSearch", { name: String(args.name ?? "") }),
    effect: "write",
    gate: "card",
    description:
      "Propose a topic search once you and the reader have talked it through: a topic followed on " +
      "X, arXiv and GitHub, with a first overview and then what is new each day. It draws a card " +
      "and files nothing; the reader applies it. Call it again with the changes when they correct " +
      "the draft. The card shows name, scope, subtopics, want/avoid, your judgements and the " +
      "topic it files into; the queries and anchors are never shown.",
    parameters: Type.Object({
      name: Type.String({ description: "Short name, the reader's words." }),
      scope: Type.String({ description: "One paragraph: what is in and out, in the reader's words." }),
      subtopics: Type.Array(
        Type.Object({ name: Type.String(), picked: Type.Boolean() }),
        { description: "The subtopics offered, and whether the reader picked each." },
      ),
      want: Type.Array(Type.String(), { description: "What the reader wants from it." }),
      avoid: Type.Array(Type.String(), { description: "What the reader does not want." }),
      judgments: Type.Array(Type.String(), {
        description: "Calls you made and said out loud, which the reader did not object to.",
      }),
      anchors: Type.Array(Type.String(), {
        description: "Words that disambiguate the topic; a post naming one is on topic.",
      }),
      queries: Type.Array(QUERY_SCHEMA, {
        description: "1-2 per picked subtopic, 1-4 over the whole topic. None for unpicked subtopics.",
      }),
      answers: Type.Array(ANSWER_SCHEMA, {
        description: "What the reader answered to your questions while drafting, word for word.",
      }),
      concern: Type.String({ description: "One sentence: that the reader is following this." }),
      existingConcern: Type.Optional(
        Type.String({ description: "Id (s-…) of a concern already saying the same thing." }),
      ),
      searchId: Type.Optional(
        Type.String({ description: "Id (ts-…) of a stopped topic search this re-drafts." }),
      ),
      opening: Type.String({
        description: "A few words copied exactly from the reader's message where they first said they follow this.",
      }),
      once: Type.Optional(
        Type.Boolean({
          description: "True when the reader wants one look only, not a daily follow: it stops after the first result.",
        }),
      ),
    }),
    execute: async (args) => {
      const name = asString(args.name).trim();
      if (!name) throw new Error("propose_topic_search needs a name.");
      const scope = asString(args.scope).trim();
      if (!scope) throw new Error("propose_topic_search needs a scope paragraph.");
      const searches = await deps.searches();
      const redraft = args.searchId ? resolveTopicSearch(asString(args.searchId), searches) : null;
      const taken = activeNameTaken(name, searches);
      if (taken && taken.id !== redraft?.id) {
        return {
          text:
            `The reader already follows "${taken.name}" (id: ${taken.id}), so nothing was proposed. ` +
            `Change that one with update_topic_search, or propose under a different name.`,
          receipt: null,
        };
      }
      const subtopics = numberSubtopics(draftSubtopics(args.subtopics));
      const queries = numberQueries(draftQueries(args.queries), subtopics);
      if (queries.length === 0) {
        throw new Error(
          "propose_topic_search needs at least one query, over the whole topic or a picked subtopic.",
        );
      }
      const concern = resolveConcern(asString(args.existingConcern), await deps.statements());
      const card: TopicSearchProposalCardData = {
        kind: "topic-search-proposal",
        threadId: deps.threadId,
        searchId: redraft && redraft.status === "stopped" ? redraft.id : null,
        name,
        scope,
        subtopics,
        want: asStrings(args.want),
        avoid: asStrings(args.avoid),
        judgments: asStrings(args.judgments),
        eta: firstRunEta(await deps.claims(), deps.now()),
        ...(args.once === true ? { once: true } : {}),
        anchors: asStrings(args.anchors),
        queries,
        answers: draftAnswers(args.answers),
        concern: {
          text: asString(args.concern).trim() || `Following ${name}`,
          existingId: concern?.id ?? null,
          evidence: openingAnchor(deps.readerLines(), asString(args.opening), deps.threadId),
        },
        phase: "draft",
      };
      deps.raiseCard(card);
      const unpicked = subtopics.filter((s) => !s.picked).length;
      return {
        text:
          `Drew the card for "${name}": ${subtopics.length - unpicked} picked subtopics, ${queries.length} ` +
          `queries${concern ? `, hung on concern ${concern.id}` : ""}${card.once ? ", once only" : ""}. ` +
          `Nothing is filed until the reader applies it.`,
        receipt: {
          label: t("info.tool.draftedTopicSearchLabel"),
          summary: t("info.tool.draftedTopicSearchSummary", { name, scope }),
        },
      };
    },
  };
}
