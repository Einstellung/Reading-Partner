// Where a piece of info material belongs (docs/21, docs/61).
//
// Keeping an article is not filing it: the reader is not asked to pick a topic,
// the companion proposes one and they nod. So this tool drafts a card and
// nothing else — the same shape update_profile has (companion-tools.ts), for the
// same reason: the AI writes the proposal, the reader owns the write.
//
// What is proposed is a topic AND what the material adds to it. A topic alone
// would be a folder; the point of keeping something is what it contributes to
// what the reader is already working through, and whether it confirms or
// contradicts it.
//
// The reader's topics are read at call time and printed into the prompt, so the
// model proposes an existing one by id rather than minting a near-duplicate of
// a topic that is already there.

import { Type } from "@earendil-works/pi-ai";
import { getThread } from "../../platform/app/threads";
import { BRIEF_TOPIC_ID, BRIEF_TOPIC_NAME, listTopics, type Topic } from "../../platform/app/topics";
import type { AgentTool } from "../../ai/agent";
import type { TopicProposalCardData } from "../boxes/cards";

/** A topic as this tool needs it: enough to name one and to match one. */
export interface TopicChoice {
  id: string;
  name: string;
}

export interface ProposeTopicDeps {
  // The conversation the proposal files. Carried on the card so one read back
  // off disk still says which it was.
  threadId: string;
  // The reader's topics, read when the tool is called rather than when the desk
  // was laid: a topic created earlier in this same conversation counts.
  topics(): Promise<TopicChoice[]>;
  // Surface the proposal card. The host owns Apply; the tool never writes.
  onTopicCard(card: TopicProposalCardData): void;
}

/**
 * The topic roster and the standing instruction, for the companion's prompt.
 *
 * The roster is here rather than in the tool description because it is data
 * about this reader, and a description is written once for every reader. Empty
 * where there are no topics at all, which is the first-run shape: there is then
 * nothing to belong to and every proposal is a new one.
 */
export function topicGuidance(topics: readonly TopicChoice[]): string {
  const roster = topics.length
    ? topics.map((t) => `- ${t.name} (id: ${t.id})`).join("\n")
    : "- (none yet)";
  return [
    "WHERE THINGS BELONG",
    "The reader's topics:",
    roster,
    "",
    "When the reader keeps an article, and whenever the conversation settles on what a " +
      "piece of material is for, call propose_topic. Give the topic it belongs under — an " +
      "id from the list above, or a name for a new one — and say what it adds to that " +
      "topic: what it contributes, and whether it confirms or contradicts what the reader " +
      "has already read. The Brief topic is a queue, not a home: material sitting there is " +
      "waiting to be given one. propose_topic writes nothing — the reader sees a card and " +
      "confirms it. Do not tell them it is filed until they have.",
  ].join("\n");
}

/**
 * Which topic the model meant. An id it read off the roster, failing that a name
 * from it (the model repeats what it was shown at least as often as it repeats
 * an id), and failing that a new topic by that name.
 *
 * Matching a name rather than only an id is what keeps a second "AI safety" from
 * being created beside the first.
 */
export function resolveProposedTopic(
  raw: string,
  topics: readonly TopicChoice[],
): TopicProposalCardData["topic"] | null {
  const wanted = raw.trim();
  if (!wanted) return null;
  const byId = topics.find((t) => t.id === wanted);
  if (byId) return { id: byId.id, name: byId.name };
  const folded = wanted.toLowerCase();
  const byName = topics.find((t) => t.name.trim().toLowerCase() === folded);
  if (byName) return { id: byName.id, name: byName.name };
  return { newName: wanted };
}

/**
 * The topic an info conversation is filed under, for the desk it lays.
 *
 * The thread's own once the reader has confirmed one, and the brief queue until
 * then — which is where every info conversation was before there was a way to
 * say otherwise (docs/21). Read per turn rather than when the conversation
 * opened: filing it is a gesture made mid-conversation, and the turn right after
 * it is the one that has to read the new topic's memory.
 *
 * The thread has to be loaded already, which every caller does before its first
 * turn; an unloaded one reads as the brief queue rather than waiting on a file.
 */
export async function threadTopic(
  bookId: string,
  threadId: string,
): Promise<{ id: string; name: string }> {
  const id = getThread(bookId, threadId)?.topicId ?? BRIEF_TOPIC_ID;
  // A shelf that will not read costs the name, not the turn.
  const topics = await listTopics().catch((): Topic[] => []);
  return { id, name: topics.find((t) => t.id === id)?.name ?? BRIEF_TOPIC_NAME };
}

/** The name a proposal reads as, whichever half of the union it is. */
export function proposedTopicName(topic: TopicProposalCardData["topic"]): string {
  return "id" in topic ? topic.name : topic.newName;
}

/**
 * The propose_topic tool: draft where something belongs and what it adds. It
 * writes nothing — the card's Apply does, in the host.
 */
export function buildProposeTopicTool(deps: ProposeTopicDeps): AgentTool {
  return {
    name: "propose_topic",
    description:
      "Propose where a piece of material belongs and what it adds. Call this when the user " +
      "keeps an article, and when a conversation settles on what something is for. `topic` " +
      "is the id of one of the topics listed in your instructions, or a name for a new topic " +
      "where none of them fits — never a near-duplicate of one that exists. `meaning` is what " +
      "this material adds to that topic in one or two sentences: what it contributes, and " +
      "whether it confirms or contradicts what the user has already read. Pass `articleId` " +
      "when the proposal is about an article that was just kept. It does not file anything — " +
      "it shows the user a confirm card; they Apply it. Do not say the material is filed.",
    parameters: Type.Object({
      topic: Type.String({
        description:
          "The id of an existing topic from your instructions, or a name for a new one.",
      }),
      meaning: Type.String({
        description:
          "What this material adds to that topic, and whether it confirms or contradicts " +
          "what the user has read.",
      }),
      articleId: Type.Optional(
        Type.String({ description: "The kept article this is about, where there is one." }),
      ),
    }),
    execute: async (args) => {
      const meaning = String(args.meaning ?? "").trim();
      if (!meaning) throw new Error("propose_topic needs what the material adds to the topic.");
      const topic = resolveProposedTopic(String(args.topic ?? ""), await deps.topics());
      if (!topic) throw new Error("propose_topic needs a topic id or a name for a new one.");
      const articleId = String(args.articleId ?? "").trim();
      deps.onTopicCard({
        kind: "topic-proposal",
        ...(articleId ? { articleId } : {}),
        threadId: deps.threadId,
        topic,
        meaning,
        phase: "draft",
      });
      const where =
        "id" in topic ? `the existing topic "${topic.name}"` : `a new topic "${topic.newName}"`;
      return (
        `Proposed ${where}. A confirm card now shows the user the proposal. Nothing is filed ` +
        `yet — they Apply it themselves.`
      );
    },
  };
}
