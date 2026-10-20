// The tools a think run handed off from a call at the door gets
// (src/reading/turn/door-think.ts, docs/companion/136).
// Run: scripts/t.sh tests/reading/turn/door-think.test.ts

import { afterEach, expect, test } from "bun:test";

import type { AgentTool } from "../../../src/legion/durable/contract";
import type { Settings } from "../../../src/platform/app/settings";
import type { AssembledTurn, DoorTurnInput } from "../../../src/soul";
import { thinkTools } from "../../../src/soul/think";
import { doorThinkDesk, registerDoorThinkDesk, type DoorThinkDeskDeps } from "../../../src/reading/turn/door-think";

function tool(name: string, effect: "read" | "write"): AgentTool {
  return { name, effect } as unknown as AgentTool;
}

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
});

function deps(seen: DoorTurnInput[], opened: string[]): DoorThinkDeskDeps {
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
  };
}

test("the desk is the day's door turn, with the door's reads mounted beside the soul's set", async () => {
  const seen: DoorTurnInput[] = [];
  const opened: string[] = [];
  const tools = await doorThinkDesk({ place: "door", date: "2026-10-20" }, deps(seen, opened));
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
