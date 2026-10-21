import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import { earlierLines } from "../../../src/info/topic-search/build-result";
import { checkWritten, composePrompt, type ComposeInput } from "../../../src/info/topic-search/compose";
import type { TopicSearchResult, TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import type { TopicSearch } from "../../../src/info/topic-search/types";

const TOPIC: TopicSearch = {
  id: "ts-0a1b2c3d",
  name: "AI for science",
  concernId: null,
  scope: "AI used to do science",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
};

function item(id: string, over: Partial<TopicSearchResultItem> = {}): TopicSearchResultItem {
  return {
    id,
    key: `url:https://example.org/${id}`,
    keys: [],
    kind: "page",
    subtopic: null,
    title: `Story ${id}`,
    titleFrom: "original",
    summary: null,
    facts: { kind: "page", host: "example.org", author: null, publishedAt: "2026-10-14" },
    links: { original: `https://example.org/${id}`, posts: [] },
    materials: [],
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score: 50,
    ...over,
  };
}

function input(items: TopicSearchResultItem[], earlier: ComposeInput["earlier"] = []): ComposeInput {
  return {
    topic: TOPIC,
    kind: "daily",
    items,
    registry: new MaterialRegistry("r", { write: async () => {} }),
    profile: [],
    questions: [],
    language: "",
    earlier,
  };
}

test("an entry is a conclusion, paragraphs and an unknown; a new item without paragraphs is sent back", () => {
  const reply = (body: string[]) =>
    JSON.stringify({
      overview: { text: "Quiet day; see E1.", cites: ["E1"] },
      items: [{ e: "E1", conclusion: "A lab released a model.", body, unknown: "Whether it reproduces." }],
    });
  const ok = checkWritten(reply(["It was released.", "It may matter."]), input([item("E1")]));
  expect(ok.written?.items.get("E1")).toEqual({
    summary: "A lab released a model.",
    body: ["It was released.", "It may matter."],
    unknown: "Whether it reproduces.",
  });
  const bare = checkWritten(reply([]), input([item("E1")]));
  expect(bare.written).toBeNull();
  expect(bare.problems).toEqual(["E1 has a conclusion but no body paragraphs."]);
});

test("earlier conclusions go to the model and count as sources for their numbers", () => {
  const earlier = [{ date: "2026-10-14", title: "Story E1", summary: "The benchmark had 120 tasks." }];
  const prompt = composePrompt(input([item("E1")], earlier));
  expect(prompt.user).toContain("Said in earlier issues (newest first):\n- 2026-10-14 · Story E1: The benchmark had 120 tasks.");
  expect(prompt.system).toContain("yesterday, still, again");
  const reply = JSON.stringify({
    overview: { text: "See E1.", cites: ["E1"] },
    items: [{ e: "E1", conclusion: "Still 120 tasks.", body: ["Nothing new was added."] }],
  });
  expect(checkWritten(reply, input([item("E1")], earlier)).written?.items.get("E1")?.unknown).toBeNull();
  expect(checkWritten(reply, input([item("E1")])).written).toBeNull();
});

test("earlier lines are the topic's written conclusions, newest result first", () => {
  const result = (id: string, createdAt: number, items: TopicSearchResultItem[]) =>
    ({ id, date: id, createdAt, items }) as unknown as TopicSearchResult;
  const lines = earlierLines([
    result("2026-10-13", 1, [item("E1", { summary: "Old." })]),
    result("2026-10-14", 2, [item("E1", { summary: "New." }), item("E2")]),
  ]);
  expect(lines.map((l) => `${l.date} ${l.summary}`)).toEqual(["2026-10-14 New.", "2026-10-13 Old."]);
});

test("what the reader understands goes to the model with the rule for explaining terms", () => {
  const none = composePrompt(input([item("E1")]));
  expect(none.user).toContain("What the reader understands:\n- (nothing recorded)");
  expect(none.system).toContain("explained in a short clause the first time it appears");
  expect(none.system).toContain("When unsure, explain it.");

  const known = composePrompt({
    ...input([item("E1")]),
    known: ["Familiar with reinforcement learning", "Not familiar with symbolic regression"],
  });
  expect(known.user).toContain(
    "What the reader understands:\n- Familiar with reinforcement learning\n- Not familiar with symbolic regression",
  );
});
