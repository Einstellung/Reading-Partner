// Recall that reaches past the topic the tools are mounted on
// (src/memory/observations/recall.ts, wired in tools.ts).
//
// The failure this covers is silent: the store is one directory per topic and
// the tools bound to one adapter, so a reader who keeps one book as a standing
// frame while reading another had two topics that could not see each other —
// including two that held opposite records of him.

import { expect, test } from "bun:test";
import type { ObservationAdapter } from "../../src/memory/observations/adapter";
import {
  otherTopicNames,
  rankObservations,
  searchOtherTopics,
  unionById,
  CROSS_RECALL_LIMIT,
  type TopicObservations,
} from "../../src/memory/observations/recall";
import { buildObservationTools } from "../../src/memory/observations/tools";
import type { Observation, ObservationType } from "../../src/memory/observations/types";

function obs(
  id: string,
  opts: { summary?: string; body?: string; type?: ObservationType; annotations?: string[] } = {},
): Observation {
  return {
    id,
    type: opts.type ?? "belief",
    summary: opts.summary ?? `summary of ${id}`,
    body: opts.body ?? `body of ${id}`,
    created: "2026-07-01",
    updated: "2026-07-05",
    anchors: { annotationIds: opts.annotations ?? [], messageIds: [] },
  };
}

function topic(topicId: string, topicName: string, entries: Observation[]): TopicObservations {
  return { topicId, topicName, entries };
}

// The real adapter's recall is rankObservations over store.list() and nothing
// else (adapter.ts), so a fake that does the same is the same search.
function mount(home: Observation[], others?: TopicObservations[]) {
  const adapter = {
    listObservations: async () => home,
    recall: async (query: string, limit = 6) => rankObservations(home, query, limit),
    correct: async (id: string) => home.find((e) => e.id === id) ?? null,
  } as unknown as ObservationAdapter;
  const tools = buildObservationTools(adapter, others ? { otherTopics: async () => others } : {});
  const byName = (name: string) => tools.find((t) => t.name === name)!;
  return {
    search: (query: string) => byName("observation_search").execute({ query }).then(String),
    read: (id: string) => byName("observation_read").execute({ id }).then(String),
    write: byName("observation_update"),
    searchDescription: byName("observation_search").description,
    writeDescription: byName("observation_update").description,
  };
}

const RL_TOPIC = topic("t-frame", "Reinforcement learning", [
  obs("m-11111111", { summary: "no reinforcement-learning vocabulary", body: "asked what a policy is" }),
]);

test("a search from one topic finds a hit in another, labelled with that topic", async () => {
  const m = mount([obs("m-aaaaaaaa", { summary: "reads transformers closely" })], [RL_TOPIC]);
  const out = await m.search("reinforcement policy");
  expect(out).toContain("m-11111111");
  expect(out).toContain('topic "Reinforcement learning"');
  // Named at the line, not only under a heading: the model quotes lines.
  expect(out).toMatch(/\[m-11111111\] \(topic "Reinforcement learning", /);
});

test("cross-topic hits are the default — the model is given no way to ask for them", async () => {
  const m = mount([obs("m-aaaaaaaa", { summary: "reads transformers closely" })], [RL_TOPIC]);
  const params = m.searchDescription;
  expect(params).toContain("other topics");
  // The only parameter is the query: no scope, no "wider", nothing to opt into.
  const tool = buildObservationTools(
    { listObservations: async () => [], recall: async () => [] } as unknown as ObservationAdapter,
    { otherTopics: async () => [RL_TOPIC] },
  ).find((t) => t.name === "observation_search")!;
  expect(Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties)).toEqual(["query"]);
  // And it happened without being asked for.
  expect(await m.search("reinforcement policy")).toContain("m-11111111");
});

test("the same-topic answer is unchanged when nothing outside it matches", async () => {
  const home = [obs("m-aaaaaaaa", { summary: "reads transformers closely" })];
  const alone = await mount(home).search("transformers");
  const widened = await mount(home, [RL_TOPIC]).search("transformers");
  expect(widened).toBe(alone);
  expect(widened).not.toContain("topic");
});

test("no topic list mounted leaves the tool exactly as it was", async () => {
  const home = [obs("m-aaaaaaaa", { summary: "reads transformers closely" })];
  const m = mount(home);
  expect(m.searchDescription).toContain("This topic only");
  expect(m.searchDescription).not.toContain("other topics");
  expect(await m.search("nothing here")).toBe('No observation matches "nothing here".');
});

test("the topic in hand keeps all its slots — the other topics only add", async () => {
  // Seven local matches against a limit of six, plus a foreign topic that
  // matches the same term: a union ranking would drop local hits for it.
  const home = Array.from({ length: 7 }, (_, i) =>
    obs(`m-0000000${i}`, { summary: `policy gradient note ${i}` }),
  );
  const loud = topic(
    "t-other",
    "Other",
    Array.from({ length: 5 }, (_, i) => obs(`m-1111111${i}`, { summary: `policy gradient elsewhere ${i}` })),
  );
  const out = await mount(home, [loud]).search("policy gradient");
  expect(out.match(/\[m-0000000\d\]/g)).toHaveLength(6);
  expect(out.match(/\[m-1111111\d\]/g)).toHaveLength(CROSS_RECALL_LIMIT);
});

test("an id a search handed back from another topic can be read", async () => {
  const m = mount([obs("m-aaaaaaaa")], [RL_TOPIC]);
  const out = await m.read("m-11111111");
  expect(out).toContain("asked what a policy is");
  expect(out).toContain("topic: Reinforcement learning");
});

test("an observation in another topic cannot be written from here", async () => {
  const m = mount([obs("m-aaaaaaaa")], [RL_TOPIC]);
  const updated = String(await m.write.execute({ action: "update", id: "m-11111111", summary: "x" }));
  expect(updated).toContain('topic "Reinforcement learning"');
  const deleted = String(await m.write.execute({ action: "delete", id: "m-11111111" }));
  expect(deleted).toContain('topic "Reinforcement learning"');
  expect(deleted).not.toContain("Deleted");
  expect(m.writeDescription).toContain("this topic only");
  // An id that is nowhere still reads as a typo, not as someone else's.
  expect(String(await m.write.execute({ action: "update", id: "m-99999999", summary: "x" }))).toBe(
    'No observation with id "m-99999999".',
  );
});

test("a body's mention resolves into another topic once that topic is mounted", async () => {
  const home = [obs("m-aaaaaaaa", { body: "he said the opposite in m-11111111." })];
  expect(await mount(home).read("m-aaaaaaaa")).toContain("Mentioned but not in the observations you can see");
  const widened = await mount(home, [RL_TOPIC]).read("m-aaaaaaaa");
  expect(widened).toContain('topic "Reinforcement learning"');
  expect(widened).toContain("no reinforcement-learning vocabulary");
  expect(widened).not.toContain("Mentioned but not in");
});

test("a mark that sits in two topics shows both topics' observations", async () => {
  // A book can belong to two topics, and then one annotation carries an
  // observation under each.
  const home = [obs("m-aaaaaaaa", { annotations: ["a-1"] })];
  const other = topic("t-other", "Other", [obs("m-cccccccc", { annotations: ["a-1"], summary: "same mark, other frame" })]);
  const out = await mount(home, [other]).read("m-aaaaaaaa");
  expect(out).toContain("Other observations from the same evidence:");
  expect(out).toContain('topic "Other", ');
  expect(out).toContain("same mark, other frame");
});

// Ids are eight hex characters off a fresh UUID with no uniqueness check
// (store.ts newId), so nothing forbids two topics minting the same one — about
// one chance in 400,000 at the owner's 143 observations, and zero times so far
// on his real store. Spanning topics is the first read wide enough for it to
// matter, so the tie has a rule instead of an accident.
test("a colliding id resolves to the topic in hand", () => {
  const home = [obs("m-dddddddd", { summary: "local" })];
  const other = [topic("t-other", "Other", [obs("m-dddddddd", { summary: "foreign" })])];
  expect(unionById(home, other).get("m-dddddddd")!.summary).toBe("local");
  expect(otherTopicNames(home, other).has("m-dddddddd")).toBe(false);
});

test("a foreign hit knows which topic it came from even across several", () => {
  const hits = searchOtherTopics(
    [RL_TOPIC, topic("t-third", "Third", [obs("m-22222222", { summary: "policy of the third book" })])],
    "policy",
  );
  expect(hits.length).toBeGreaterThan(1);
  expect(new Set(hits.map((h) => h.topicName))).toEqual(new Set(["Reinforcement learning", "Third"]));
  for (const h of hits) expect(h.topicId).toBe(h.topicName === "Third" ? "t-third" : "t-frame");
});

test("ranking two topics apart never compares their scores", () => {
  // Same entry text in a small topic and a large one: a merged corpus would
  // score them differently by idf alone. Ranked apart, each keeps its own.
  const entry = obs("m-eeeeeeee", { summary: "attention is a soft lookup" });
  const small = rankObservations([entry], "attention", 6);
  const inOthers = searchOtherTopics([topic("t-small", "Small", [entry])], "attention");
  expect(inOthers[0].score).toBe(small[0].score);
});
