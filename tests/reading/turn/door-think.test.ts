// The tools a think run handed off from a call at the door gets
// (src/reading/turn/door-think.ts, docs/companion/136), and the brief laid
// beside them while the call has one open (docs/info/88).
// Run: scripts/t.sh tests/reading/turn/door-think.test.ts

import { afterEach, expect, test } from "bun:test";

import type { DeskEnv, DeskItem, DeskRef } from "../../../src/desk";
import type { AgentTool } from "../../../src/legion/durable/contract";
import type { Settings } from "../../../src/platform/app/settings";
import type { AssembledTurn, DoorTurnInput } from "../../../src/soul";
import { thinkDesk, thinkTools, type ThinkDeskLaid } from "../../../src/soul/think";
import { holdDoorMaterial, liveDoorMaterial, type DoorCallMaterial } from "../../../src/soul/voice/live/door-material";
import { doorThinkDesk, registerDoorThinkDesk, type DoorThinkDeskDeps } from "../../../src/reading/turn/door-think";

function tool(name: string, effect: "read" | "write"): AgentTool {
  return { name, effect } as unknown as AgentTool;
}

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
});

const ISSUE_REF: DeskRef = { kind: "issue", ref: { bookId: "b1", title: "Brief No. 7", fulltext: null } };

function issueItem(): DeskItem {
  return {
    kind: "issue",
    label: "Brief No. 7",
    tools: [tool("read_pages", "read"), tool("search_topic", "read"), tool("read_supplement", "read")],
    toolPrompts: [],
    rungs: [],
    prompt: (view) => `The reader has a brief open. Tools: ${view.toolNames.join(",")}`,
  };
}

function deps(
  seen: DoorTurnInput[],
  opened: string[],
  material: () => DoorCallMaterial | null = () => null,
  items: { refs: readonly DeskRef[]; env: DeskEnv }[] = [],
): DoorThinkDeskDeps {
  const surface = [tool("web_search", "read"), tool("background_status", "read")];
  return {
    settings: async () => ({ aiLanguage: "en" }) as unknown as Settings,
    openThread: async (date) => {
      opened.push(date);
      return { id: "d1" };
    },
    openTurn: async (input) => {
      seen.push(input);
      return {
        tools: [tool("search_conversations", "read"), tool("delegate", "write"), ...(input.tools ?? [])],
      } as unknown as AssembledTurn;
    },
    surfaceTools: (_settings, threadId) => (threadId === "d1" ? surface : []),
    material,
    openItems: async (refs, env) => {
      items.push({ refs, env });
      return refs.map(() => issueItem());
    },
  };
}

function briefOpen(open: () => boolean): DoorCallMaterial {
  return {
    opened: open,
    place: async () => (open() ? "brief" : ""),
    desk: async () =>
      open()
        ? { desk: [ISSUE_REF], note: '\n\n[App note, not the reader\'s words. The reader has the brief "Brief No. 7" open, on page 3 of 9.]' }
        : null,
  };
}

test("the desk is the day's door turn, with the door's reads mounted beside the soul's set", async () => {
  const seen: DoorTurnInput[] = [];
  const opened: string[] = [];
  const tools = (await doorThinkDesk({ place: "door", date: "2026-10-20" }, deps(seen, opened))) as AgentTool[];
  expect(opened).toEqual(["2026-10-20"]);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.threadId).toBe("d1");
  expect(seen[0]!.date).toBe("2026-10-20");
  expect(seen[0]!.tools?.map((t) => t.name)).toEqual(["web_search", "background_status"]);
  expect(tools.map((t) => t.name)).toEqual(["search_conversations", "delegate", "web_search", "background_status"]);
});

test("another place gets nothing from the door's desk", async () => {
  const seen: DoorTurnInput[] = [];
  expect(await doorThinkDesk({ place: "briefing", date: "2026-10-20" }, deps(seen, []))).toEqual([]);
  expect(seen).toEqual([]);
});

test("registered under the door, a think run there gets its reads and no writes", async () => {
  const seen: DoorTurnInput[] = [];
  undo.push(registerDoorThinkDesk((origin) => doorThinkDesk(origin, deps(seen, []))));
  const tools = await thinkTools({ place: "door", date: "2026-10-20" });
  expect(tools.map((t) => t.name)).toEqual(["search_conversations", "web_search", "background_status"]);
});

test("with a brief open beside the call, the run gets the brief's reads, its prompt and where the reader is", async () => {
  const items: { refs: readonly DeskRef[]; env: DeskEnv }[] = [];
  const laid = (await doorThinkDesk(
    { place: "door", date: "2026-10-20" },
    deps([], [], () => briefOpen(() => true), items),
  )) as ThinkDeskLaid;
  expect(laid.tools.map((t) => t.name)).toEqual([
    "search_conversations",
    "delegate",
    "web_search",
    "background_status",
    "read_pages",
    "search_topic",
    "read_supplement",
  ]);
  expect(items).toHaveLength(1);
  expect(items[0]!.refs).toEqual([ISSUE_REF]);
  expect(items[0]!.env.thread).toEqual({ key: "door-2026-10-20", id: "d1" });
  expect(laid.prompt).toBe(
    "The reader has a brief open. Tools: search_conversations,delegate,web_search,background_status,read_pages,search_topic,read_supplement" +
      '\n\n[App note, not the reader\'s words. The reader has the brief "Brief No. 7" open, on page 3 of 9.]',
  );
});

test("a call with nothing open lays the plain door desk", async () => {
  const items: { refs: readonly DeskRef[]; env: DeskEnv }[] = [];
  const tools = await doorThinkDesk({ place: "door", date: "2026-10-20" }, deps([], [], () => briefOpen(() => false), items));
  expect(Array.isArray(tools)).toBe(true);
  expect(items).toEqual([]);
});

test("the live call's provider is read when the run starts, and only while the call holds it", async () => {
  let open = true;
  undo.push(registerDoorThinkDesk((origin) => doorThinkDesk(origin, { ...deps([], []), material: liveDoorMaterial })));
  const origin = { place: "door" as const, date: "2026-10-20" };

  // No call: the plain door desk.
  expect((await thinkDesk(origin)).prompt).toBe("");
  expect((await thinkTools(origin)).map((t) => t.name)).not.toContain("read_pages");

  // A call holding a provider with a brief open: the brief's reads, reads only.
  const release = holdDoorMaterial(briefOpen(() => open));
  undo.push(release);
  const during = await thinkDesk(origin);
  expect(during.tools.map((t) => t.name)).toEqual([
    "search_conversations",
    "web_search",
    "background_status",
    "read_pages",
    "search_topic",
    "read_supplement",
  ]);
  expect(during.prompt).toContain("Brief No. 7");

  // The reader puts the brief away mid-call: the next run is plain.
  open = false;
  expect((await thinkDesk(origin)).prompt).toBe("");

  // Hung up: plain again, whatever the provider would say.
  open = true;
  release();
  expect((await thinkDesk(origin)).prompt).toBe("");
});

