// The topic card's Apply (src/memory/filing/settle.ts, docs/21): one gesture — mint
// the topic where it is new, file this conversation under it, and tell whatever
// is on the desk that the topic settled. Over ports, so the order and what a
// failure stops are assertable without React and without a filesystem; what the
// info article does with the news is tested in tests/info/desk.test.ts.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  applyTopicProposal,
  type TopicProposalCardData,
  type TopicSettlePorts,
} from "../../src/memory";

function card(over: Partial<TopicProposalCardData> = {}): TopicProposalCardData {
  return {
    kind: "topic-proposal",
    threadId: "briefing-2026-09-08",
    topic: { id: "t-9f2", name: "AI safety" },
    meaning: "First eval of the new refusal set.",
    phase: "draft",
    ...over,
  };
}

// Every port records what it was called with, so a sequence that stopped early
// can be told from one that ran.
function ports(opts: { createFails?: boolean; hookFails?: boolean } = {}) {
  const calls: string[] = [];
  const p: TopicSettlePorts & { calls: string[] } = {
    calls,
    createTopic: async (name) => {
      calls.push(`createTopic:${name}`);
      if (opts.createFails) throw new Error("shelf unreadable");
      return { id: "t-new" };
    },
    fileThread: (threadId, topicId) => calls.push(`fileThread:${threadId}:${topicId}`),
    settled: [
      async (topicId) => {
        calls.push(`settled:${topicId}`);
        if (opts.hookFails) throw new Error("disk full");
      },
    ],
    topicsChanged: () => calls.push("topicsChanged"),
  };
  return p;
}

test("applying an existing topic files the conversation and mints nothing", async () => {
  const p = ports();
  const applied = await applyTopicProposal(card(), p);
  expect(applied).toEqual({ ok: true, topicId: "t-9f2" });
  expect(p.calls).toEqual([
    "fileThread:briefing-2026-09-08:t-9f2",
    "settled:t-9f2",
    "topicsChanged",
  ]);
});

test("applying a new topic mints it first and files everything under it", async () => {
  const p = ports();
  const applied = await applyTopicProposal(card({ topic: { newName: "Robot learning" } }), p);
  expect(applied).toEqual({ ok: true, topicId: "t-new" });
  expect(p.calls).toEqual([
    "createTopic:Robot learning",
    "fileThread:briefing-2026-09-08:t-new",
    "settled:t-new",
    "topicsChanged",
  ]);
});

// Nothing on the desk asked to be told. Filing the conversation is the whole
// gesture, which is the case a desk with nothing but a briefing on it is in.
test("a desk that registered nothing files the conversation alone", async () => {
  const p = ports();
  p.settled = [];
  await applyTopicProposal(card(), p);
  expect(p.calls).toEqual(["fileThread:briefing-2026-09-08:t-9f2", "topicsChanged"]);
});

// The card stays on screen for the rest of the conversation and comes back on
// reopen, so a second click is an ordinary thing to do; without the guard it
// would mint a second topic by the same name.
test("a card already applied is a no-op on the second click", async () => {
  const p = ports();
  const applied = await applyTopicProposal(card({ phase: "applied" }), p);
  expect(applied).toEqual({ ok: false, topicId: null });
  expect(p.calls).toEqual([]);
});

test("a topic that could not be minted files nothing", async () => {
  const p = ports({ createFails: true });
  const applied = await applyTopicProposal(card({ topic: { newName: "Robot learning" } }), p);
  expect(applied).toEqual({ ok: false, topicId: null });
  expect(p.calls).toEqual(["createTopic:Robot learning"]);
});

// The conversation is filed, which is the gesture the reader made. What an item
// does about its own material afterwards is the item's to retry.
test("an item that could not follow the topic does not fail the Apply", async () => {
  const p = ports({ hookFails: true });
  const applied = await applyTopicProposal(card(), p);
  expect(applied).toEqual({ ok: true, topicId: "t-9f2" });
  expect(p.calls).toEqual([
    "fileThread:briefing-2026-09-08:t-9f2",
    "settled:t-9f2",
    "topicsChanged",
  ]);
});
