// propose_topic (src/memory/filing/propose.ts, docs/21): the AI says where this
// conversation belongs and what it adds, and writes nothing. What is asserted
// here is that it only drafts — the card is the whole effect — plus how a
// proposal is matched to a topic the reader already has, the roster the model
// proposes out of, and when filing rides a turn at all. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildProposeTopicTool,
  filingTools,
  proposedTopicName,
  resolveProposedTopic,
  topicGuidance,
  type TopicChoice,
  type TopicProposalCardData,
} from "../../src/memory";

const TOPICS: TopicChoice[] = [
  { id: "brief", name: "Brief" },
  { id: "t-9f2", name: "AI safety" },
];

function tool(topics: TopicChoice[] = TOPICS) {
  const cards: TopicProposalCardData[] = [];
  const t = buildProposeTopicTool({
    threadId: "briefing-2026-09-08",
    topics: async () => topics,
    onTopicCard: (card) => cards.push(card),
  });
  return { t, cards };
}

// The tool is a proposal and nothing else — the same shape update_profile has.
// Everything it could write is behind the card's Apply.
test("proposing an existing topic drafts a card and writes nothing", async () => {
  const { t, cards } = tool();
  const said = await t.execute({
    topic: "t-9f2",
    meaning: "First eval of the new refusal set.",
  });
  expect(cards).toEqual([
    {
      kind: "topic-proposal",
      threadId: "briefing-2026-09-08",
      topic: { id: "t-9f2", name: "AI safety" },
      meaning: "First eval of the new refusal set.",
      phase: "draft",
    },
  ]);
  // And it says so, so the model does not report the material as filed.
  expect(String(said)).toContain("Apply");
  expect(String(said)).toContain("AI safety");
});

test("a name no topic answers to is a proposal for a new one", async () => {
  const { t, cards } = tool();
  await t.execute({ topic: "Robot learning", meaning: "A second line of work." });
  expect(cards[0].topic).toEqual({ newName: "Robot learning" });
});

// The model repeats what it was shown at least as often as it repeats an id,
// and a second "AI safety" beside the first is the failure this prevents.
test("a topic named rather than identified still lands on the one that exists", () => {
  expect(resolveProposedTopic("AI safety", TOPICS)).toEqual({ id: "t-9f2", name: "AI safety" });
  expect(resolveProposedTopic("  ai SAFETY ", TOPICS)).toEqual({ id: "t-9f2", name: "AI safety" });
  expect(resolveProposedTopic("brief", TOPICS)).toEqual({ id: "brief", name: "Brief" });
  expect(resolveProposedTopic("Robot learning", TOPICS)).toEqual({ newName: "Robot learning" });
  expect(resolveProposedTopic("   ", TOPICS)).toBeNull();
});

test("a proposal with nothing said about the material is refused", async () => {
  const { t, cards } = tool();
  await expect(t.execute({ topic: "t-9f2", meaning: "  " })).rejects.toThrow();
  expect(cards).toEqual([]);
});

test("the roster is the reader's own topics, and says so when there are none", () => {
  const roster = topicGuidance(TOPICS);
  expect(roster).toContain("- Brief (id: brief)");
  expect(roster).toContain("- AI safety (id: t-9f2)");
  expect(roster).toContain("propose_topic");
  expect(topicGuidance([])).toContain("(none yet)");
});

test("a proposal reads by name whichever half of the union it is", () => {
  expect(proposedTopicName({ id: "t-9f2", name: "AI safety" })).toBe("AI safety");
  expect(proposedTopicName({ newName: "Robot learning" })).toBe("Robot learning");
});

// --- when filing rides a turn -----------------------------------------------

// The offer is made to a conversation that has no topic, and to no other: one
// already filed has nothing left to propose. Nothing here is the soul's — what
// decides is the conversation, because a topic is where the material goes.
test("filing rides a conversation with no topic, and nothing once it has one", async () => {
  const cards: TopicProposalCardData[] = [];
  const mount = {
    threadId: "briefing-2026-09-08",
    onCard: (c: TopicProposalCardData) => cards.push(c),
    list: async () => TOPICS,
  };

  const offered = await filingTools({ ...mount, filedTopic: null });
  expect(offered.tools.map((t) => t.name)).toEqual(["propose_topic"]);
  expect(offered.prompt).toContain("WHERE THIS BELONGS");
  expect(offered.prompt).toContain("AI safety");

  const filed = await filingTools({ ...mount, filedTopic: "t-9f2" });
  expect(filed.tools).toEqual([]);
  expect(filed.prompt).toBe("");
});
