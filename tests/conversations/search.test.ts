// Searching every conversation the app holds (src/conversations/search.ts): the
// scope that widens, the ranking, and the anchors a hit points back with. A
// literal store, one file per thread kind, so what is under test is the search
// and not the thread writer. Run: bun test.

import { expect, test } from "bun:test";
import {
  readConversation,
  searchConversations,
  type ConversationIo,
} from "../../src/conversations";
import type { Thread, ThreadMessage } from "../../src/platform/app/threads";

let stamp = 1_753_000_000_000;

function msg(role: "user" | "ai", text: string, id?: string): ThreadMessage {
  stamp += 1000;
  return { role, text, ts: stamp, ...(id ? { id } : {}) };
}

function thread(id: string, messages: ThreadMessage[]): Thread {
  return { id, annotationId: "", path: "", createdAt: 1, messages };
}

// One store: files by name, and the threads each thread file holds.
function io(files: Record<string, string>, threads: Record<string, Thread[]>): ConversationIo {
  return {
    listRoot: async () => [...Object.keys(files), ...Object.keys(threads).map((k) => `threads-${k}.json`)],
    readText: async (path) => files[path] ?? null,
    peekThreads: async (key) => threads[key] ?? [],
  };
}

const TOPICS = JSON.stringify({
  topics: [{ id: "t-attention", name: "Attention", files: [{ path: "/a.pdf", hash: "book-1" }] }],
});

// A book in one topic, a retell in another, a briefing in the brief topic.
function store(): ConversationIo {
  return io(
    {
      "topics.json": TOPICS,
      "retell-7.json": JSON.stringify({ id: "7", topicId: "t-talks" }),
    },
    {
      "book-1": [
        thread("th-book", [
          msg("user", "what does the author mean by attention here", "t-0000000000000001"),
          msg("ai", "the weighting of one token against the rest"),
        ]),
      ],
      "retell-7": [
        thread("th-retell", [msg("user", "I want to open the talk with entropy, not attention")]),
      ],
      "info-2026-07-21": [
        thread("briefing-2026-07-21", [msg("user", "why is this newsletter about attention again")]),
      ],
    },
  );
}

test("a search stays in the topic when the topic answers it", async () => {
  const { hits, widened } = await searchConversations(
    "attention",
    { topicId: "t-attention", widen: true },
    store(),
  );
  expect(widened).toBe(false);
  expect(hits.length).toBe(1);
  expect(hits[0].fileKey).toBe("book-1");
  expect(hits[0].threadId).toBe("th-book");
  expect(hits[0].kind).toBe("reading-thread");
  expect(hits[0].topicId).toBe("t-attention");
  expect(hits[0].snippet).toContain("attention");
});

test("a hit points back in the anchor form observations are written with", async () => {
  const { hits } = await searchConversations(
    "attention",
    { topicId: "t-attention", widen: false },
    store(),
  );
  expect(hits[0].anchor).toBe(`t-0000000000000001@th-book:${hits[0].ts}`);
  // A message written before ids exist is anchored by the pair alone.
  const { hits: retell } = await searchConversations(
    "entropy",
    { topicId: "t-talks", widen: false },
    store(),
  );
  expect(retell[0].anchor).toBe(`th-retell:${retell[0].ts}`);
});

test("a topic with no answer widens to the library and says so", async () => {
  const { hits, widened } = await searchConversations(
    "entropy",
    { topicId: "t-attention", widen: true },
    store(),
  );
  expect(widened).toBe(true);
  expect(hits.map((h) => h.fileKey)).toEqual(["retell-7"]);
  expect(hits[0].topicId).toBe("t-talks");
});

test("widen false keeps a fruitless search inside its topic", async () => {
  const { hits, widened } = await searchConversations(
    "entropy",
    { topicId: "t-attention", widen: false },
    store(),
  );
  expect(hits).toEqual([]);
  expect(widened).toBe(false);
});

test("a null topic searches everything from the start and never reads as widened", async () => {
  const { hits, widened } = await searchConversations("attention", { topicId: null, widen: true }, store());
  expect(widened).toBe(false);
  expect(hits.map((h) => h.fileKey).sort()).toEqual(["book-1", "info-2026-07-21", "retell-7"]);
});

test("the same thread id in two day files is two conversations, not one", async () => {
  // The onboarding thread carries a literal id and repeats in every
  // threads-info-<date>.json there is (docs/pitfall/209).
  const disk = io(
    {},
    {
      "info-2026-07-21": [thread("onboarding", [msg("user", "I mostly read papers on the train")])],
      "info-2026-07-22": [thread("onboarding", [msg("user", "papers again, on the train home")])],
    },
  );
  const { hits } = await searchConversations("papers", { topicId: "brief", widen: false }, disk);
  expect(hits.length).toBe(2);
  expect(hits.every((h) => h.threadId === "onboarding")).toBe(true);
  expect(hits.map((h) => h.fileKey).sort()).toEqual(["info-2026-07-21", "info-2026-07-22"]);
});

test("more of the query's terms outranks fewer, and recency breaks the tie", async () => {
  const disk = io(
    {},
    {
      "info-2026-07-21": [
        thread("briefing-2026-07-21", [
          msg("user", "entropy alone"),
          msg("user", "attention alone"),
          msg("user", "entropy and attention together"),
        ]),
      ],
    },
  );
  const { hits } = await searchConversations(
    "entropy attention",
    { topicId: null, widen: false },
    disk,
  );
  expect(hits.map((h) => h.score)).toEqual([2, 1, 1]);
  expect(hits[0].snippet).toContain("together");
  // Equal score, later message first.
  expect(hits[1].ts).toBeGreaterThan(hits[2].ts);
});

test("Chinese is matched by adjacent-character bigrams", async () => {
  const disk = io(
    {},
    {
      "info-2026-07-21": [
        thread("briefing-2026-07-21", [msg("user", "这一段讲的是注意力机制的来历")]),
      ],
    },
  );
  const found = await searchConversations("注意力", { topicId: null, widen: false }, disk);
  expect(found.hits.length).toBe(1);
  // A single character lands inside a longer run.
  const one = await searchConversations("熵", { topicId: null, widen: false }, disk);
  expect(one.hits).toEqual([]);
  const inside = await searchConversations("机", { topicId: null, widen: false }, disk);
  expect(inside.hits.length).toBe(1);
});

test("an empty query asks nothing", async () => {
  const { hits } = await searchConversations("   ", { topicId: null, widen: true }, store());
  expect(hits).toEqual([]);
});

test("read_conversation gives back the stretch around a hit, with its topic", async () => {
  const messages = Array.from({ length: 20 }, (_, i) => msg("user", `line ${i}`));
  const disk = io({ "retell-7.json": JSON.stringify({ topicId: "t-talks" }) }, {
    "retell-7": [thread("th-retell", messages)],
  });
  const excerpt = await readConversation(
    { fileKey: "retell-7", threadId: "th-retell", aroundTs: messages[10].ts, span: 4 },
    disk,
  );
  expect(excerpt).not.toBeNull();
  expect(excerpt!.topicId).toBe("t-talks");
  expect(excerpt!.kind).toBe("retell-thread");
  expect(excerpt!.lines.map((l) => l.text)).toEqual(["line 8", "line 9", "line 10", "line 11"]);
  expect(excerpt!.before).toBe(8);
  expect(excerpt!.after).toBe(8);
});

test("read_conversation with no stamp reads the end", async () => {
  const messages = Array.from({ length: 5 }, (_, i) => msg("ai", `line ${i}`));
  const disk = io({}, { "info-2026-07-21": [thread("onboarding", messages)] });
  const excerpt = await readConversation(
    { fileKey: "info-2026-07-21", threadId: "onboarding", span: 2 },
    disk,
  );
  expect(excerpt!.lines.map((l) => l.text)).toEqual(["line 3", "line 4"]);
  expect(excerpt!.after).toBe(0);
});

test("read_conversation refuses a thread that is not in that file", async () => {
  const disk = io({}, { "info-2026-07-21": [thread("onboarding", [msg("user", "hi")])] });
  expect(await readConversation({ fileKey: "info-2026-07-22", threadId: "onboarding" }, disk)).toBeNull();
  expect(await readConversation({ fileKey: "library", threadId: "onboarding" }, disk)).toBeNull();
});
