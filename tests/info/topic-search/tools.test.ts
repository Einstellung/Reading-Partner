// The door tools and the card's Apply for topic searches (docs/info/88 起草,
// 记忆回写, 不关注了), over in-memory ports. Run: scripts/t.sh tests/info/topic-search

import { expect, test } from "bun:test";
import {
  applyTopicSearchProposal,
  linkConcern,
  stopFollowing,
  type ConcernPorts,
} from "../../../src/info/topic-search/apply";
import type { TopicSearchProposalCardData } from "../../../src/info/topic-search/cards";
import { buildStopTopicSearchTool, buildUpdateTopicSearchTool, type EditToolDeps } from "../../../src/info/topic-search/edit-tools";
import {
  buildProposeTopicSearchTool,
  openingAnchor,
  resolveFiledTopic,
} from "../../../src/info/topic-search/propose-tool";
import { applyTopicSearchUpdate } from "../../../src/info/topic-search/topic-searches";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { createStatementStore } from "../../../src/memory/statements/store";
import type { Statement } from "../../../src/memory";

const OCT_14 = new Date("2026-10-14T09:00:00Z").getTime();

function search(id: string, over: Partial<TopicSearch> = {}): TopicSearch {
  return {
    id,
    name: id,
    topicId: "topic-1",
    concernId: null,
    scope: "s",
    subtopics: [{ id: "st1", name: "Materials", picked: true }],
    want: [],
    avoid: [],
    judgments: [],
    anchors: [],
    queries: [{ id: "q1", subtopic: null, x: "AI for science", arxiv: null, ranking: "", weight: 1 }],
    answers: [],
    status: "active",
    revision: 1,
    createdAt: 1,
    lastRunAt: null,
    ...over,
  };
}

function statements() {
  const files = new Map<string, string>();
  let n = 0;
  const store = createStatementStore({
    async read(p) {
      return files.get(p) ?? null;
    },
    async write(p, c) {
      files.set(p, c);
    },
    async observationDates() {
      return null;
    },
    newId: () => `s-${String(++n).padStart(16, "0")}`,
  });
  return store;
}

function card(over: Partial<TopicSearchProposalCardData> = {}): TopicSearchProposalCardData {
  return {
    kind: "topic-search-proposal",
    threadId: "thread-1",
    searchId: null,
    name: "AI for science",
    scope: "s",
    subtopics: [{ id: "st1", name: "Materials", picked: true }],
    want: [],
    avoid: [],
    judgments: ["AI chip design counts as engineering"],
    topic: { id: null, name: "AI for science" },
    eta: "tonight",
    anchors: ["AI for science"],
    queries: [{ id: "q1", subtopic: null, x: "AI for science", arxiv: null, ranking: "", weight: 1 }],
    answers: [{ asked: "Funding news?", answer: "No" }],
    concern: { text: "Following AI for science", existingId: null, evidence: `thread-1:${OCT_14}` },
    phase: "draft",
    ...over,
  };
}

function memoryFile() {
  let all: TopicSearch[] = [];
  return {
    get all() {
      return all;
    },
    load: async () => all,
    put: async (s: TopicSearch) => {
      all = [...all.filter((x) => x.id !== s.id), s];
    },
    change: async (id: string, fn: (s: TopicSearch) => TopicSearch) => {
      const at = all.find((s) => s.id === id);
      if (!at) return null;
      const next = fn(at);
      all = all.map((s) => (s.id === id ? next : s));
      return next;
    },
  };
}

test("the opening message is the latest line holding the quote, or the latest line", () => {
  const lines = [
    { ts: 1, text: "I follow AI for   Science now" },
    { id: "t-abc", ts: 2, text: "materials and weather please" },
  ];
  expect(openingAnchor(lines, "ai for science", "th")).toBe("th:1");
  expect(openingAnchor(lines, "not said", "th")).toBe("t-abc@th:2");
  expect(openingAnchor([], "x", "th")).toBeNull();
  expect(resolveFiledTopic("Science", [{ id: "tp", name: "science" }], "x")).toEqual({ id: "tp", name: "science" });
  expect(resolveFiledTopic("", [{ id: "tp", name: "AI" }], "AI")).toEqual({ id: "tp", name: "AI" });
  expect(resolveFiledTopic("", [], "AI")).toEqual({ id: null, name: "AI" });
});

test("propose draws a card and writes nothing; a taken name is refused", async () => {
  const cards: TopicSearchProposalCardData[] = [];
  const deps = {
    threadId: "thread-1",
    readerLines: () => [{ ts: OCT_14, text: "帮我整理 AI for science 的资料" }],
    searches: async () => [search("ts-1", { name: "Chips" })],
    topics: async () => [],
    statements: async () => [],
    claims: async () => [],
    now: () => OCT_14,
    raiseCard: (c: TopicSearchProposalCardData) => cards.push(c),
  };
  const tool = buildProposeTopicSearchTool(deps);
  const args = {
    name: "AI for science",
    scope: "AI used to do science",
    subtopics: [{ name: "Materials", picked: true }, { name: "Weather", picked: false }],
    want: [],
    avoid: ["funding news"],
    judgments: [],
    anchors: ["AI for science"],
    queries: [
      { subtopic: "", x: "AI for science", arxiv: "", ranking: "" },
      { subtopic: "Weather", x: "AI weather", arxiv: "", ranking: "" },
    ],
    answers: [],
    topic: "",
    concern: "Following AI for science",
    opening: "AI for science",
  };
  const result = await tool.execute(args);
  expect(typeof result === "object" && result.receipt).toBeTruthy();
  expect(cards).toHaveLength(1);
  expect(cards[0].queries.map((q) => q.x)).toEqual(["AI for science"]);
  expect(cards[0].concern.evidence).toBe(`thread-1:${OCT_14}`);
  expect(cards[0].topic).toEqual({ id: null, name: "AI for science" });
  expect(cards[0].eta).toBe("tonight");

  const refused = await tool.execute({ ...args, name: "chips" });
  expect(typeof refused === "object" && refused.receipt).toBeNull();
  expect(cards).toHaveLength(1);
});

test("a concern is written in the reader's words, a dream's is superseded, a reader's is followed again", async () => {
  const store = statements();
  const ports: ConcernPorts = store;
  const evidence = `thread-1:${OCT_14}`;

  const fresh = await linkConcern({ text: "Following X", existingId: null, evidence }, ports);
  expect((await store.getStatement(fresh!))?.author).toBe("reader");

  const dream = await store.createStatement({
    kind: "concern",
    text: "Seems to care about X",
    author: "dream",
    evidence: [`thread-0:${OCT_14 - 86_400_000}`],
  });
  const replaced = await linkConcern({ text: "Following X", existingId: dream.id, evidence }, ports);
  expect(replaced).not.toBe(dream.id);
  expect((await store.getStatement(dream.id))?.supersededBy).toBe(replaced!);

  await store.setLapsed(replaced!, true);
  const again = await linkConcern({ text: "Following X", existingId: dream.id, evidence }, ports);
  expect(again).toBe(replaced);
  expect((await store.getStatement(replaced!))?.lapsed).toBeUndefined();

  expect(await linkConcern({ text: "x", existingId: null, evidence: null }, ports)).toBeNull();
});

test("Apply writes the config with a new topic and the concern, then hands off the first run", async () => {
  const store = statements();
  const file = memoryFile();
  const dispatched: string[] = [];
  const made: string[] = [];
  const result = await applyTopicSearchProposal(card(), {
    concern: store,
    load: file.load,
    put: file.put,
    topicExists: async () => false,
    createTopic: async (name) => {
      made.push(name);
      return { id: "topic-new" };
    },
    dispatchFirstRun: async (s) => {
      dispatched.push(s.id);
    },
    now: () => OCT_14,
    random: () => 0,
  });
  expect(result.ok).toBe(true);
  const [written] = file.all;
  expect(`${written.id} ${written.topicId} ${written.status} ${written.revision}`).toBe("ts-00000000 topic-new active 1");
  expect(written.answers).toEqual([{ asked: "Funding news?", answer: "No", at: OCT_14 }]);
  expect(made).toEqual(["AI for science"]);
  expect(dispatched).toEqual(["ts-00000000"]);
  const concern = await store.getStatement(written.concernId!);
  expect(`${concern?.kind} ${concern?.author} ${concern?.text}`).toBe("concern reader Following AI for science");
  expect(concern?.evidence).toEqual([`thread-1:${OCT_14}`]);

  expect((await applyTopicSearchProposal(card({ phase: "applied" }), {} as never)).ok).toBe(false);
});

test("stopping marks the search stopped and its concern lapsed; re-drafting it follows both again", async () => {
  const store = statements();
  const concern = await store.createStatement({
    kind: "concern",
    text: "Following AI for science",
    author: "reader",
    evidence: [`thread-1:${OCT_14}`],
  });
  const file = memoryFile();
  await file.put(search("ts-1", { concernId: concern.id }));
  const deps: EditToolDeps = { searches: file.load, change: file.change, setLapsed: store.setLapsed, now: () => OCT_14 };

  const stop = buildStopTopicSearchTool(deps);
  await stop.execute({ searchId: "ts-1" });
  expect(file.all[0].status).toBe("stopped");
  expect((await store.getStatement(concern.id))?.lapsed).toBe(true);
  expect(await stopFollowing("ts-nope", deps)).toBeNull();

  const result = await applyTopicSearchProposal(card({ searchId: "ts-1", concern: { ...card().concern, evidence: `thread-2:${OCT_14 + 1000}` } }), {
    concern: store,
    load: file.load,
    put: file.put,
    topicExists: async () => true,
    createTopic: async () => ({ id: "never" }),
    dispatchFirstRun: async () => {},
    now: () => OCT_14 + 1000,
  });
  expect(result.ok).toBe(true);
  expect(file.all).toHaveLength(1);
  expect(`${file.all[0].id} ${file.all[0].status} ${file.all[0].revision} ${file.all[0].concernId}`).toBe(
    `ts-1 active 3 ${concern.id}`,
  );
  const back = (await store.getStatement(concern.id)) as Statement;
  expect(back.lapsed).toBeUndefined();
  expect(back.evidence).toHaveLength(2);
});

test("update writes the change at once with a 'saved to this topic' receipt", async () => {
  const file = memoryFile();
  await file.put(search("ts-1"));
  const tool = buildUpdateTopicSearchTool({
    searches: file.load,
    change: file.change,
    setLapsed: async () => null,
    now: () => OCT_14,
  });
  const result = await tool.execute({
    searchId: "ts-1",
    addAvoid: ["funding news"],
    answers: [{ asked: "Funding news?", answer: "这个主题不要融资新闻" }],
  });
  expect(typeof result === "object" && result.receipt?.label).toBe("Saved to this topic");
  expect(file.all[0]).toEqual(
    applyTopicSearchUpdate(
      search("ts-1"),
      { avoid: { add: ["funding news"] }, answers: [{ asked: "Funding news?", answer: "这个主题不要融资新闻" }] },
      OCT_14,
    ),
  );
  const nothing = await tool.execute({ searchId: "ts-1" });
  expect(typeof nothing === "object" && nothing.receipt).toBeNull();
  const unknown = await tool.execute({ searchId: "nope", addAvoid: ["x"] });
  expect(typeof unknown === "object" && unknown.text).toContain("not one of the reader's topic searches");
});
