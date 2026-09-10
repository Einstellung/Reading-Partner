// propose_topic (src/soul/topic/propose.ts, docs/21): the AI says where this
// conversation belongs and what it adds, and writes nothing. What is asserted
// here is that it only drafts — the card is the whole effect — plus how a
// proposal is matched to a topic the reader already has, the roster the model
// proposes out of, and the topic a desk is laid under. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildProposeTopicTool,
  proposedTopicName,
  resolveProposedTopic,
  threadTopic,
  topicGuidance,
  type TopicChoice,
  type TopicProposalCardData,
} from "../../src/soul";
import {
  createThread,
  loadThreads,
  rebuildThreadStoreForTests,
  setThreadTopic,
} from "../../src/platform/app/threads";
import { createTopic } from "../../src/platform/app/topics";
import { installAppData } from "../support/appdata-fake";

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

// --- the topic the desk is laid under ---------------------------------------

// A conversation is laid under its own topic once the reader has confirmed one,
// and under none until then: there is no queue to fall back on, and what follows
// from having no topic — no observation tools, nothing distilled — is the point.
test("a conversation lays its desk under its own topic, and under none until it has one", async () => {
  installAppData();
  rebuildThreadStoreForTests();
  const bookId = "info-2026-09-08";
  await loadThreads(bookId).catch(() => {});
  createThread(bookId, "info", "briefing-2026-09-08");

  expect(await threadTopic(bookId, "briefing-2026-09-08")).toEqual({ id: null, name: "" });

  const topic = await createTopic("AI safety");
  setThreadTopic(bookId, "briefing-2026-09-08", topic.id);
  expect(await threadTopic(bookId, "briefing-2026-09-08")).toEqual({
    id: topic.id,
    name: "AI safety",
  });

  // A conversation nobody has opened has no topic, which is not an error.
  expect(await threadTopic(bookId, "2026-09-08:a1")).toEqual({ id: null, name: "" });
});
