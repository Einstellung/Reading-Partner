// The one assembly (src/soul, docs/61): a laid desk plus what is known
// about the reader, put together into one call. Fake items throughout — what a
// book contributes is tested in tests/reading, and what is tested here is the
// putting together. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { assembleTurn, configuredModel, topicGuidance, type SequenceIo } from "../../src/soul";
import type { ConversationIo } from "../../src/conversations";
import {
  openDesk,
  registerDeskItemKind,
  type DeskEnv,
  type DeskItem,
  type DeskPromptView,
} from "../../src/desk";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import {
  appendMessage,
  createBookThread,
  rebuildThreadStoreForTests,
  type Thread,
  type ThreadMessage,
} from "../../src/platform/app/threads";
import { installAppData } from "../support/appdata-fake";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

function env(over: Partial<DeskEnv> = {}): DeskEnv {
  return {
    settings,
    topic: { id: null, name: "Nothing" },
    thread: { key: "book-1", id: "thread-1" },
    ...over,
  };
}

// The paragraph the soul prints itself where the conversation has no topic yet
// (soul/topic): the roster, empty here, and the standing offer to file it.
const WHERE_THIS_BELONGS = topicGuidance([]);

// A caller that can draw a proposal card, which is what mounts propose_topic at
// all (soul/self.ts). Where a case is about the tool list and not about the
// offer, this is what puts the offer on the desk.
const CARD_SURFACE = { onCard: () => {} };

// A desk under a topic the reader has settled, with something on it anchoring
// the retrieval: the reading desk's shape, and the one the provider's cache
// prefix depends on (docs/09).
const SETTLED = { id: "t-1", name: "Attention" };
const anchoring: Partial<DeskItem> = {
  memory: { bookId: "book-1", observations: [], snapshot: () => "" },
};

function item(kind: string, over: Partial<DeskItem> = {}): DeskItem {
  return {
    kind,
    label: kind,
    tools: [],
    toolPrompts: [],
    rungs: [],
    prompt: () => "",
    ...over,
  };
}

function tool(name: string) {
  return { name, description: "", parameters: {}, execute: async () => "" } as never;
}

// Lay a desk out of items already built, without going through a domain.
async function desk(items: DeskItem[], e: DeskEnv = env()) {
  for (const it of items) registerDeskItemKind({ kind: it.kind, open: async () => it });
  return openDesk(
    items.map((it) => ({ kind: it.kind, ref: {} })),
    e,
  );
}

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
});

test("one item's prompt is the whole prompt, byte for byte", async () => {
  const laid = await desk(
    [item("only", { ...anchoring, prompt: () => "the only block\n\nand its second line" })],
    env({ topic: SETTLED }),
  );
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("the only block\n\nand its second line");
});

// The soul's own paragraphs go to the item that anchors the retrieval, and the
// item decides where in its prompt they sit. Nothing is appended behind its
// back: a book on the desk assembles the same bytes it always did.
test("an anchored desk hands the memory paragraph to the item and prints nothing itself", async () => {
  let handed = "";
  const laid = await desk(
    [
      item("material", {
        ...anchoring,
        prompt: (view: DeskPromptView) => {
          handed = view.memory;
          return "THE BOOK";
        },
      }),
    ],
    env({ topic: SETTLED }),
  );
  const turn = await assembleTurn({ desk: laid });
  expect(handed).toContain("Observation tools:");
  expect(turn!.systemPrompt).toBe("THE BOOK");
});

// And where nothing anchors it, the same paragraph rides the turn all the same:
// what is known about the reader is about the reader, not about the material
// (docs/48). The soul prints it after the items.
test("with nothing anchoring the retrieval the soul prints the memory paragraph itself", async () => {
  const laid = await desk([item("guest", { prompt: () => "GUEST" })], env({ topic: SETTLED }));
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt.startsWith("GUEST\n\n")).toBe(true);
  expect(turn!.systemPrompt).toContain("Observation tools:");
});

// A conversation nobody has said what is about (docs/21): the roster and the
// offer to file it ride every turn until the reader nods, whatever the desk
// holds. Once the topic is settled, neither does.
test("a conversation with no topic carries the offer to give it one", async () => {
  const laid = await desk([item("only", { prompt: () => "ONLY" })]);
  const turn = await assembleTurn({ desk: laid, topic: CARD_SURFACE });
  expect(turn!.systemPrompt).toBe(`ONLY\n\n${WHERE_THIS_BELONGS}`);
  expect(turn!.tools.map((t) => t.name)).toContain("propose_topic");

  const settled = await desk(
    [item("only", { ...anchoring, prompt: () => "ONLY" })],
    env({ topic: SETTLED }),
  );
  const scoped = await assembleTurn({ desk: settled, topic: CARD_SURFACE });
  expect(scoped!.systemPrompt).toBe("ONLY");
  expect(scoped!.tools.map((t) => t.name)).not.toContain("propose_topic");
});

// And where the caller has nowhere to draw the card, the offer is not made at
// all. propose_topic writes nothing — the card is its whole effect — so mounting
// it on a surface that draws none leaves the model telling the reader to confirm
// something they were never shown (the reading session, soul/self.ts).
test("a caller with nowhere to draw the card is offered no way to propose", async () => {
  const laid = await desk([item("only", { prompt: () => "ONLY" })]);
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("ONLY");
  expect(turn!.systemPrompt).not.toContain("WHERE THIS BELONGS");
  expect(turn!.tools.map((t) => t.name)).not.toContain("propose_topic");
});

test("the items' prompts come out in desk order, and an empty one leaves no gap", async () => {
  const laid = await desk(
    [
      item("first", { ...anchoring, prompt: () => "FIRST" }),
      item("silent", { prompt: () => "" }),
      item("last", { prompt: () => "LAST" }),
    ],
    env({ topic: SETTLED }),
  );
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("FIRST\n\nLAST");
});

// What is always there, then what this desk happens to hold.
test("the tools are the soul's and then each item's", async () => {
  createBookThread("book-1", "thread-1");
  appendMessage("book-1", "thread-1", { role: "user", text: "why is this fast?", ts: 1000 });
  const laid = await desk([
    item("a", { tools: [tool("read_pages")] }),
    item("b", { tools: [tool("list_saved_articles")] }),
  ]);
  const turn = await assembleTurn({ desk: laid, topic: CARD_SURFACE });
  expect(turn!.tools.map((t) => t.name)).toEqual([
    "statement_write",
    "search_conversations",
    "read_conversation",
    "propose_topic",
    "read_pages",
    "list_saved_articles",
  ]);
});

// The AI can reach for what it and the reader already said, wherever they said
// it (src/conversations, docs/61). Part of the soul rather than of any item:
// what was said belongs to the reader, and the desk it was said over is only
// where the search starts. So it rides an empty desk and a desk with no topic
// settled, which is exactly where the observation tools do not.
test("the soul brings the conversation search to every desk", async () => {
  const empty = await assembleTurn({ desk: await desk([]) });
  expect(empty!.tools.map((t) => t.name)).toContain("search_conversations");
  expect(empty!.tools.map((t) => t.name)).toContain("read_conversation");
  const laid = await desk([item("a")], env({ topic: { id: "t-1", name: "Attention" } }));
  const scoped = await assembleTurn({ desk: laid });
  expect(scoped!.tools.map((t) => t.name)).toContain("search_conversations");
});

test("an item is told every tool name on the desk, the soul's included", async () => {
  createBookThread("book-1", "thread-1");
  appendMessage("book-1", "thread-1", { role: "user", text: "why is this fast?", ts: 1000 });
  let seen: readonly string[] = [];
  const laid = await desk([
    item("frame", {
      tools: [tool("read_pages")],
      prompt: (view: DeskPromptView) => {
        seen = view.toolNames;
        return "frame";
      },
    }),
    item("guest", { tools: [tool("list_saved_articles")] }),
  ]);
  await assembleTurn({ desk: laid, topic: CARD_SURFACE });
  expect([...seen]).toEqual([
    "statement_write",
    "search_conversations",
    "read_conversation",
    "propose_topic",
    "read_pages",
    "list_saved_articles",
  ]);
});

// An item's own paragraphs are left out of its view: it has them already and
// decides where they sit. What it cannot know is what else is on the desk.
test("an item is told the other items' tool paragraphs, not its own", async () => {
  const views: Record<string, readonly string[]> = {};
  const laid = await desk([
    item("frame", {
      toolPrompts: ["FRAME PARAGRAPH"],
      prompt: (view) => {
        views.frame = view.toolPrompts;
        return "frame";
      },
    }),
    item("guest", {
      toolPrompts: ["GUEST PARAGRAPH"],
      prompt: (view) => {
        views.guest = view.toolPrompts;
        return "";
      },
    }),
  ]);
  await assembleTurn({ desk: laid });
  expect([...views.frame]).toEqual(["GUEST PARAGRAPH"]);
  expect([...views.guest]).toEqual(["FRAME PARAGRAPH"]);
});

// The memory paragraph is about the reader, and it is built once. The item that
// anchors the retrieval prints it; every other item is handed nothing, so it
// cannot print it twice.
test("the memory paragraph goes to the item that anchors the retrieval and to no other", async () => {
  const memories: Record<string, string> = {};
  const laid = await desk([
    item("anchor", {
      memory: {
        bookId: "book-1",
        observations: [],
        snapshot: (tight) => (tight ? "- [gap] tight (id m-2)" : "- [gap] full (id m-1)"),
      },
      prompt: (view) => {
        memories.anchor = view.memory;
        return "anchor";
      },
    }),
    item("other", {
      prompt: (view) => {
        memories.other = view.memory;
        return "other";
      },
    }),
  ]);
  await assembleTurn({ desk: laid });
  expect(memories.anchor).toContain("- [gap] full (id m-1)");
  expect(memories.other).toBe("");
});

test("a desk with nothing anchoring the retrieval gets no memory paragraph", async () => {
  let memory = "unset";
  const laid = await desk([
    item("plain", {
      prompt: (view) => {
        memory = view.memory;
        return "plain";
      },
    }),
  ]);
  await assembleTurn({ desk: laid });
  expect(memory).toBe("");
});

test("the replayed messages come from the item that carries the history", async () => {
  const laid = await desk([
    item("teller", {
      history: { compose: () => [{ role: "user", text: "from the item" }] },
    }),
  ]);
  const turn = await assembleTurn({
    desk: laid,
    messages: [{ role: "user", text: "from the caller" }],
  });
  expect(turn!.messages).toEqual([{ role: "user", text: "from the item" }]);
});

test("with no item carrying the history, the caller's messages are replayed", async () => {
  const laid = await desk([item("quiet")]);
  const turn = await assembleTurn({
    desk: laid,
    messages: [{ role: "user", text: "from the caller" }],
  });
  expect(turn!.messages).toEqual([{ role: "user", text: "from the caller" }]);
});

// The desk with nothing on it (docs/61): no material, no prompt, and the soul
// still there. It assembles rather than failing, which is what the companion
// with no book open will stand on.
test("an empty desk assembles", async () => {
  const laid = await desk([]);
  const turn = await assembleTurn({
    desk: laid,
    messages: [{ role: "user", text: "hello" }],
    topic: CARD_SURFACE,
  });
  expect(turn).not.toBeNull();
  // No material, so no prompt but the soul's own: this conversation has no topic
  // and the offer to give it one is what the soul carries (soul/topic).
  expect(turn!.systemPrompt).toBe(WHERE_THIS_BELONGS);
  expect(turn!.messages).toEqual([{ role: "user", text: "hello" }]);
  expect(turn!.refusal).toBe("");
});

test("what the items report about themselves comes back merged", async () => {
  const laid = await desk([
    item("a", { report: { inline: "chapter" } }),
    item("b", { report: { kept: 2 } }),
  ]);
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.report).toEqual({ inline: "chapter", kept: 2 });
});

// What an item can only write after the fact: whether the pictures it planned
// actually went out.
test("every item hears what the ladder gave up, once the call is fitted", async () => {
  const heard: string[] = [];
  const laid = await desk([
    item("a", { afterFit: (dropped) => heard.push(`a:${dropped.size}`) }),
    item("b", { afterFit: (dropped) => heard.push(`b:${dropped.size}`) }),
  ]);
  await assembleTurn({ desk: laid });
  expect(heard).toEqual(["a:0", "b:0"]);
});

// The ladder is the history item's: the turn is mostly made of that item's
// material, so what it can give up is what the ladder walks. A rung on another
// item is not consulted — an item that brings two tools has nothing to give up.
test("the ladder walked is the one on the item carrying the history", async () => {
  // Over any window there is, until the rung takes it back.
  const huge = "the block. ".repeat(800_000);
  const laid = await desk(
    [
      item("teller", {
        ...anchoring,
        rungs: [{ id: "big-block", notice: "the big block was left out" }],
        history: { compose: () => [{ role: "user", text: "hi" }] },
        prompt: (view) => (view.dropped.has("big-block") ? "small" : huge),
      }),
      item("guest", {
        rungs: [{ id: "guest-rung", notice: "the guest gave something up" }],
        prompt: (view) => (view.dropped.has("guest-rung") ? "" : "guest"),
      }),
    ],
    env({ topic: SETTLED }),
  );
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("small\n\nguest");
  expect(turn!.notice).toBe("Note: the big block was left out.");
});

// Settings naming a model pi does not know: the turn is assembled without a
// budget rather than blocked on one, and the ladder is not walked at all.
test("an unknown model assembles the turn at full size", async () => {
  const unknown = { ...settings, defaultModelId: "no-such-model" };
  expect(configuredModel(unknown)).toBeNull();
  const laid = await desk(
    [item("only", { ...anchoring, prompt: () => "full size" })],
    env({ settings: unknown, topic: SETTLED }),
  );
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("full size");
  expect(turn!.notice).toBe("");
  expect(turn!.refusal).toBe("");
});

test("a turn the reader has already walked away from assembles nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const laid = await desk([item("only")], env({ signal: controller.signal }));
  expect(await assembleTurn({ desk: laid })).toBeNull();
});

// --- the soul's tail (src/soul/tail.ts) ------------------------------------

// A store of conversations to read the tail out of, in place of the disk. The
// index and the messages come off the same literal files, the way they do in
// the app.
function store(files: Record<string, Record<string, ThreadMessage[]>>) {
  const threads = (name: string): Thread[] =>
    Object.entries(files[name] ?? {}).map(
      ([id, messages]) => ({ id, annotationId: "", path: "", createdAt: 0, messages }) as Thread,
    );
  const conversationIo: ConversationIo = {
    listRoot: async () => Object.keys(files),
    readText: async () => null,
    peekThreads: async (fileKey) => threads(`threads-${fileKey}.json`),
  };
  const sequenceIo: SequenceIo = {
    conversations: conversationIo,
    mtime: async () => 1,
    readText: async () => null,
    writeText: async () => {},
  };
  return { conversationIo, sequenceIo };
}

function said(role: "user" | "ai", text: string, ts: number): ThreadMessage {
  return { id: `${role}-${ts}`, role, text, ts };
}

// The pin: nothing else on the device means nothing in front of the item's own
// span, byte for byte what the desk composed before any of this existed.
test("a fresh install replays exactly what the item carries and nothing else", async () => {
  const laid = await desk([
    item("teller", {
      history: {
        compose: () => [
          { role: "user", text: "why is this fast?" },
          { role: "ai", text: "because of the cache" },
        ],
      },
    }),
  ]);
  const turn = await assembleTurn({ desk: laid, ...store({}) });
  expect(turn!.messages).toEqual([
    { role: "user", text: "why is this fast?" },
    { role: "ai", text: "because of the cache" },
  ]);
});

test("what the reader said over another desk rides in front of the item's own span", async () => {
  const laid = await desk([
    item("teller", { history: { compose: () => [{ role: "user", text: "here, now" }] } }),
  ]);
  const turn = await assembleTurn({
    desk: laid,
    ...store({
      "threads-info-2026-07-21.json": { t0: [said("user", "about the debt cycle", 10)] },
    }),
  });
  expect(turn!.messages).toEqual([
    { role: "user", text: "[over the briefing of 2026-07-21]\nabout the debt cycle" },
    { role: "user", text: "here, now" },
  ]);
});

// The item's span wins when the two compete: a conversation long enough to fill
// the turn by itself leaves the tail nothing.
test("an item carrying a full span leaves no room for the tail", async () => {
  const full = Array.from({ length: 40 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "ai") as "user" | "ai",
    text: `mine ${i}`,
  }));
  const laid = await desk([item("teller", { history: { compose: () => full } })]);
  const turn = await assembleTurn({
    desk: laid,
    ...store({ "threads-info-2026-07-21.json": { t0: [said("user", "elsewhere", 10)] } }),
  });
  expect(turn!.messages).toEqual(full);
});

test("the conversation being held is never replayed twice", async () => {
  const laid = await desk([
    item("teller", { history: { compose: () => [{ role: "user", text: "here, now" }] } }),
  ]);
  const turn = await assembleTurn({
    desk: laid,
    // The desk's own env names threads-book-1.json / thread-1; the store holds
    // that file and one other.
    ...store({
      "threads-book-1.json": { "thread-1": [said("user", "here, now", 10)] },
      "threads-door-2026-09-10.json": { t0: [said("user", "at the door", 20)] },
    }),
  });
  expect(turn!.messages.map((m) => m.text)).toEqual([
    "[at the door]\nat the door",
    "here, now",
  ]);
});

// The tail is the first thing on the ladder: a call that does not fit gives up
// what was said over another desk before it touches what was said over this one.
test("the tail is what a call over its window gives up first", async () => {
  const huge = "the block. ".repeat(800_000);
  const laid = await desk([
    item("teller", {
      rungs: [{ id: "big-block", notice: "the big block was left out" }],
      history: { compose: () => [{ role: "user", text: "here, now" }] },
      prompt: (view) => (view.dropped.has("big-block") ? "small" : huge),
    }),
  ]);
  const turn = await assembleTurn({
    desk: laid,
    ...store({ "threads-info-2026-07-21.json": { t0: [said("user", "elsewhere", 10)] } }),
  });
  expect(turn!.messages).toEqual([{ role: "user", text: "here, now" }]);
  // And it goes silently: the reader has no stake in it.
  expect(turn!.notice).toBe("Note: the big block was left out.");
});
