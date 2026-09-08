// The one assembly (src/ai/assemble, docs/61): a laid desk plus what is known
// about the reader, put together into one call. Fake items throughout — what a
// book contributes is tested in tests/reading, and what is tested here is the
// putting together. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { assembleTurn, configuredModel } from "../../src/ai/assemble";
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
  const laid = await desk([item("only", { prompt: () => "the only block\n\nand its second line" })]);
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("the only block\n\nand its second line");
});

test("the items' prompts come out in desk order, and an empty one leaves no gap", async () => {
  const laid = await desk([
    item("first", { prompt: () => "FIRST" }),
    item("silent", { prompt: () => "" }),
    item("last", { prompt: () => "LAST" }),
  ]);
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("FIRST\n\nLAST");
});

// What is always there, then what this desk happens to hold.
test("the tools are the brain's and then each item's", async () => {
  createBookThread("book-1", "thread-1");
  appendMessage("book-1", "thread-1", { role: "user", text: "why is this fast?", ts: 1000 });
  const laid = await desk([
    item("a", { tools: [tool("read_pages")] }),
    item("b", { tools: [tool("list_saved_articles")] }),
  ]);
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.tools.map((t) => t.name)).toEqual([
    "statement_write",
    "search_conversations",
    "read_conversation",
    "read_pages",
    "list_saved_articles",
  ]);
});

// The AI can reach for what it and the reader already said, wherever they said
// it (src/conversations, docs/61). Part of the brain rather than of any item:
// what was said belongs to the reader, and the desk it was said over is only
// where the search starts. So it rides an empty desk and a desk with no topic
// settled, which is exactly where the observation tools do not.
test("the brain brings the conversation search to every desk", async () => {
  const empty = await assembleTurn({ desk: await desk([]) });
  expect(empty!.tools.map((t) => t.name)).toContain("search_conversations");
  expect(empty!.tools.map((t) => t.name)).toContain("read_conversation");
  const laid = await desk([item("a")], env({ topic: { id: "t-1", name: "Attention" } }));
  const scoped = await assembleTurn({ desk: laid });
  expect(scoped!.tools.map((t) => t.name)).toContain("search_conversations");
});

test("an item is told every tool name on the desk, the brain's included", async () => {
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
  await assembleTurn({ desk: laid });
  expect([...seen]).toEqual([
    "statement_write",
    "search_conversations",
    "read_conversation",
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

// The desk with nothing on it (docs/61): no material, no prompt, and the brain
// still there. It assembles rather than failing, which is what the companion
// with no book open will stand on.
test("an empty desk assembles", async () => {
  const laid = await desk([]);
  const turn = await assembleTurn({ desk: laid, messages: [{ role: "user", text: "hello" }] });
  expect(turn).not.toBeNull();
  expect(turn!.systemPrompt).toBe("");
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
  const laid = await desk([
    item("teller", {
      rungs: [{ id: "big-block", notice: "the big block was left out" }],
      history: { compose: () => [{ role: "user", text: "hi" }] },
      prompt: (view) => (view.dropped.has("big-block") ? "small" : huge),
    }),
    item("guest", {
      rungs: [{ id: "guest-rung", notice: "the guest gave something up" }],
      prompt: (view) => (view.dropped.has("guest-rung") ? "" : "guest"),
    }),
  ]);
  const turn = await assembleTurn({ desk: laid });
  expect(turn!.systemPrompt).toBe("small\n\nguest");
  expect(turn!.notice).toBe("Note: the big block was left out.");
});

// Settings naming a model pi does not know: the turn is assembled without a
// budget rather than blocked on one, and the ladder is not walked at all.
test("an unknown model assembles the turn at full size", async () => {
  const unknown = { ...settings, defaultModelId: "no-such-model" };
  expect(configuredModel(unknown)).toBeNull();
  const laid = await desk([item("only", { prompt: () => "full size" })], env({ settings: unknown }));
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
