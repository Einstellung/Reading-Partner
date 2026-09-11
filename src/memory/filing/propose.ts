// Where this conversation belongs (docs/21, docs/61).
//
// Filing a conversation is not asking the reader to pick a folder: the AI
// proposes a topic and they nod. So this tool drafts a card and nothing else —
// the same shape update_profile has, for the same reason: the AI writes the
// proposal, the reader owns the write (docs/21).
//
// It belongs to memory and to no domain, and to no one's soul: a topic is the
// key data is filed under — which topic a book is listed in, which topic an
// observation is written to — and the person at the desk is under none of them.
// What makes the offer ride a turn is the conversation, not the person: one with
// no topic is one nothing can be filed under and nothing is distilled from.
//
// What is proposed is a topic AND what the material adds to it. A topic alone
// would be a folder; the point is what it contributes to what the reader is
// already working through, and whether it confirms or contradicts it.
//
// The reader's topics are read at call time and printed into the prompt, so the
// model proposes an existing one by id rather than minting a near-duplicate of a
// topic that is already there.

import { Type } from "@earendil-works/pi-ai";
import { listTopics, type Topic } from "../../platform/app/topics";
import type { AgentTool } from "../../ai/agent";
import type { TopicProposalCardData } from "./card";

/** A topic as this tool needs it: enough to name one and to match one. */
export interface TopicChoice {
  id: string;
  name: string;
}

/**
 * What a caller offers the proposal: somewhere to draw the card, and the roster
 * to propose out of. The card is required, and a caller that offers none is not
 * offered the tool at all (self.ts) — a proposal writes nothing, so a card the
 * reader never sees is a filing that never happens and a model that says it did.
 * The roster is optional: a caller that injects none gets the reader's own shelf.
 */
export interface TopicProposalSurface {
  onCard(card: TopicProposalCardData): void;
  list?(): Promise<TopicChoice[]>;
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

/** The reader's own shelf, for a caller that injects no roster. */
export function liveTopicChoices(): Promise<TopicChoice[]> {
  return (
    listTopics()
      .then((topics: Topic[]) => topics.map(({ id, name }) => ({ id, name })))
      // A shelf that will not read leaves the AI proposing new topics rather
      // than failing the turn the reader is waiting for.
      .catch((): TopicChoice[] => [])
  );
}

/**
 * The topic roster and the standing instruction, for the prompt of a turn whose
 * conversation has no topic yet.
 *
 * The roster is here rather than in the tool description because it is data
 * about this reader, and a description is written once for every reader. The
 * paragraph still prints with no topics at all, which is the first-run shape:
 * there is then nothing to belong to and every proposal is a new one.
 */
export function topicGuidance(topics: readonly TopicChoice[]): string {
  const roster = topics.length
    ? topics.map((t) => `- ${t.name} (id: ${t.id})`).join("\n")
    : "- (none yet)";
  return [
    "WHERE THIS BELONGS",
    "The reader's topics:",
    roster,
    "",
    "This conversation is filed under none of them yet, and nothing said in it is " +
      "remembered until it is. When the reader keeps something, and whenever the " +
      "conversation settles on what it is for, call propose_topic. Give the topic it " +
      "belongs under — an id from the list above, or a name for a new one — and say what " +
      "it adds to that topic: what it contributes, and whether it confirms or contradicts " +
      "what the reader has already read. propose_topic writes nothing — the reader sees a " +
      "card and confirms it. Do not tell them it is filed until they have.",
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
 * The propose_topic tool: draft where this belongs and what it adds. It writes
 * nothing — the card's Apply does, in the host.
 */
export function buildProposeTopicTool(deps: ProposeTopicDeps): AgentTool {
  return {
    name: "propose_topic",
    description:
      "Propose where this conversation belongs and what it adds. Call this when the user " +
      "keeps something, and when a conversation settles on what it is for. `topic` is the " +
      "id of one of the topics listed in your instructions, or a name for a new topic where " +
      "none of them fits — never a near-duplicate of one that exists. `meaning` is what this " +
      "material adds to that topic in one or two sentences: what it contributes, and whether " +
      "it confirms or contradicts what the user has already read. It does not file anything " +
      "— it shows the user a confirm card; they Apply it. Do not say the material is filed.",
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
    }),
    execute: async (args) => {
      const meaning = String(args.meaning ?? "").trim();
      if (!meaning) throw new Error("propose_topic needs what the material adds to the topic.");
      const topic = resolveProposedTopic(String(args.topic ?? ""), await deps.topics());
      if (!topic) throw new Error("propose_topic needs a topic id or a name for a new one.");
      deps.onTopicCard({
        kind: "topic-proposal",
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

/** What the soul hands filing when it mounts it: the conversation, and the card sink. */
export interface FilingMount extends TopicProposalSurface {
  // The conversation a proposal would file.
  threadId: string;
  // The topic it is already filed under. Non-null means there is nothing to
  // propose, and filing mounts neither tool nor paragraph.
  filedTopic: string | null;
}

/**
 * What filing contributes to one turn: the tool that proposes a topic, and the
 * roster paragraph that tells the model which topics there already are.
 *
 * Empty on both counts once the conversation is filed. The soul mounts this
 * beside its own tools and prints the paragraph; it is memory's text and not the
 * soul's, because what it is about is where the material goes.
 */
export async function filingTools(
  mount: FilingMount,
): Promise<{ tools: AgentTool[]; prompt: string }> {
  if (mount.filedTopic !== null) return { tools: [], prompt: "" };
  const topics = mount.list ?? liveTopicChoices;
  return {
    tools: [
      buildProposeTopicTool({
        threadId: mount.threadId,
        topics,
        onTopicCard: mount.onCard,
      }),
    ],
    prompt: topicGuidance(await topics()),
  };
}
