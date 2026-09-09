// The topic card's Apply (src/info/briefer/card-actions.ts, docs/21): one
// gesture, three writes — mint the topic where it is new, file the kept article
// under it, file this conversation with it. Over ports, so the order and what a
// failure stops are assertable without React and without a filesystem; the
// article write itself is exercised against the real store at the bottom.
// Run: bun test.

import { expect, test } from "bun:test";
import { applyTopicProposal, type TopicProposalPorts } from "../../src/info/briefer/card-actions";
import {
  SAVED_ARTICLES_FILE,
  loadSavedArticles,
  setSavedArticleTopic,
  type SavedArticle,
} from "../../src/reading/saved-articles";
import { createFakeAppData } from "../support/guarded-appdata";
import type { TopicProposalCardData } from "../../src/info/boxes/cards";

function card(over: Partial<TopicProposalCardData> = {}): TopicProposalCardData {
  return {
    kind: "topic-proposal",
    articleId: "https://example.com/a",
    threadId: "briefing-2026-09-08",
    topic: { id: "t-9f2", name: "AI safety" },
    meaning: "First eval of the new refusal set.",
    phase: "draft",
    ...over,
  };
}

// Every port records what it was called with, so a sequence that stopped early
// can be told from one that ran.
function ports(opts: { createFails?: boolean; fileFails?: boolean } = {}) {
  const calls: string[] = [];
  const p: TopicProposalPorts & { calls: string[] } = {
    calls,
    createTopic: async (name) => {
      calls.push(`createTopic:${name}`);
      if (opts.createFails) throw new Error("shelf unreadable");
      return { id: "t-new" };
    },
    fileArticle: async (articleId, topicId) => {
      calls.push(`fileArticle:${articleId}:${topicId}`);
      if (opts.fileFails) throw new Error("disk full");
    },
    fileThread: (threadId, topicId) => calls.push(`fileThread:${threadId}:${topicId}`),
    topicsChanged: () => calls.push("topicsChanged"),
  };
  return p;
}

test("applying an existing topic files the article and the conversation, and mints nothing", async () => {
  const p = ports();
  const applied = await applyTopicProposal(card(), p);
  expect(applied).toEqual({ ok: true, topicId: "t-9f2" });
  expect(p.calls).toEqual([
    "fileArticle:https://example.com/a:t-9f2",
    "fileThread:briefing-2026-09-08:t-9f2",
    "topicsChanged",
  ]);
});

test("applying a new topic mints it first and files both halves under it", async () => {
  const p = ports();
  const applied = await applyTopicProposal(card({ topic: { newName: "Robot learning" } }), p);
  expect(applied).toEqual({ ok: true, topicId: "t-new" });
  expect(p.calls).toEqual([
    "createTopic:Robot learning",
    "fileArticle:https://example.com/a:t-new",
    "fileThread:briefing-2026-09-08:t-new",
    "topicsChanged",
  ]);
});

// A proposal about the conversation rather than about anything kept.
test("a proposal with no article files the conversation alone", async () => {
  const p = ports();
  await applyTopicProposal(card({ articleId: undefined }), p);
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

// Filing the conversation under a topic the article did not reach would put the
// two halves of one gesture in different places.
test("an article that could not be filed stops the conversation being filed too", async () => {
  const p = ports({ fileFails: true });
  const applied = await applyTopicProposal(card(), p);
  expect(applied).toEqual({ ok: false, topicId: null });
  expect(p.calls).toEqual(["fileArticle:https://example.com/a:t-9f2"]);
});

// --- the article write itself -----------------------------------------------

function kept(over: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: "https://example.com/a",
    topicId: "brief",
    url: "https://example.com/a",
    title: "A title",
    source: "src",
    sourceName: "Source",
    publishedAt: "2026-08-01",
    savedAt: 1,
    summaryOnly: false,
    bodyHash: "0123456789abcdef0123456789abcdef",
    textChars: 4,
    ...over,
  };
}

test("moving a kept article rewrites its record and leaves the others alone", async () => {
  const io = createFakeAppData();
  io.files.set(
    SAVED_ARTICLES_FILE,
    JSON.stringify([kept(), kept({ id: "https://example.com/b", url: "https://example.com/b" })]),
  );

  expect(await setSavedArticleTopic("https://example.com/a", "t-9f2", io)).toBe(true);
  const list = await loadSavedArticles(io);
  expect(list.map((a) => [a.id, a.topicId])).toEqual([
    ["https://example.com/a", "t-9f2"],
    ["https://example.com/b", "brief"],
  ]);
});

// The record may not have arrived on this device yet. Nothing to move is not a
// write — and it is not a claim that the article was filed either.
test("moving an article this device has no record of writes nothing", async () => {
  const io = createFakeAppData();
  io.files.set(SAVED_ARTICLES_FILE, JSON.stringify([kept()]));
  const before = io.files.get(SAVED_ARTICLES_FILE);

  expect(await setSavedArticleTopic("https://example.com/gone", "t-9f2", io)).toBe(false);
  expect(io.files.get(SAVED_ARTICLES_FILE)).toBe(before);
});
