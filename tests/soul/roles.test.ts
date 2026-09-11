// Roles put on the soul (src/soul/roles.ts, docs/67 角色): the registry itself,
// and what a loaded role does to a turn — its duty opens the prompt, its tools
// join the soul's, and a tool name it shares with something on the desk is
// refused. Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { assembleTurn, listRoles, registerRole, roleOf, roleRegistered } from "../../src/soul";
import { openDesk, registerDeskItemKind, type DeskEnv, type DeskItem } from "../../src/desk";
import { DEFAULT_SETTINGS } from "../../src/platform/app/settings";
import { rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import { installAppData } from "../support/appdata-fake";
import type { AgentTool } from "../../src/ai/agent";

// A kind no domain would ever ask for (pitfall 287: a test kind named like a
// real one replaces the domain's opener for the whole run).
const KIND = "roles-test-item";

const undo: (() => void)[] = [];

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
});

afterEach(() => {
  while (undo.length) undo.pop()!();
});

function tool(name: string): AgentTool {
  return { name, description: "", parameters: {}, execute: async () => "" } as never;
}

function role(id: string, duty: string, tools: AgentTool[] = []) {
  return {
    id,
    duty,
    tools: () => tools,
    writes: tools.map((t) => ({ tool: t.name, gate: "card" as const })),
  };
}

function mount(id: string, duty: string, tools: AgentTool[] = []) {
  undo.push(registerRole(role(id, duty, tools)));
}

function env(): DeskEnv {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      defaultProviderId: "anthropic",
      defaultModelId: "claude-sonnet-4-5",
    },
    thread: { key: "roles-test", id: "t-1" },
  };
}

function item(tools: AgentTool[]): DeskItem {
  return {
    kind: KIND,
    label: "a thing on the desk",
    tools,
    toolPrompts: [],
    rungs: [],
    prompt: () => "WHAT LIES ON THE DESK",
  };
}

async function laid(tools: AgentTool[] = []) {
  undo.push(registerDeskItemKind({ kind: KIND, open: async () => item(tools) }));
  return openDesk([{ kind: KIND, ref: {} }], env());
}

test("a role is registered by name, and a second one under that name is refused", () => {
  mount("archivist", "You keep the record.");
  expect(roleRegistered("archivist")).toBe(true);
  expect(roleOf("archivist").duty).toBe("You keep the record.");
  expect(listRoles().map((r) => r.id)).toContain("archivist");
  expect(() => registerRole(role("archivist", "You do something else."))).toThrow(
    /already registered/,
  );
});

test("unregistering takes the role away again", () => {
  const off = registerRole(role("archivist", "You keep the record."));
  off();
  expect(roleRegistered("archivist")).toBe(false);
  expect(() => roleOf("archivist")).toThrow(/no role called "archivist"/);
});

test("a turn asking for a role nothing registered throws", async () => {
  const desk = await laid();
  await expect(assembleTurn({ desk, role: "nobody" })).rejects.toThrow(/no role called "nobody"/);
});

test("the duty opens the prompt and the role's tools ride the turn", async () => {
  mount("archivist", "You keep the record.", [tool("file_it")]);
  const desk = await laid([tool("read_the_shelf")]);
  const turn = await assembleTurn({ desk, role: "archivist" });
  expect(turn!.systemPrompt.startsWith("You keep the record.\n\n")).toBe(true);
  expect(turn!.systemPrompt).toContain("WHAT LIES ON THE DESK");
  const names = turn!.tools.map((t) => t.name);
  expect(names[0]).toBe("file_it");
  expect(names).toContain("read_the_shelf");
});

// No role loaded is the reading path, the door and every legion errand: the
// prompt is the desk's, byte for byte what it was before roles existed.
test("a turn with no role prints no duty and mounts nothing extra", async () => {
  mount("archivist", "You keep the record.", [tool("file_it")]);
  const desk = await laid();
  const turn = await assembleTurn({ desk });
  expect(turn!.systemPrompt).not.toContain("You keep the record.");
  expect(turn!.tools.map((t) => t.name)).not.toContain("file_it");
});

test("a role and a desk item offering one tool name is refused", async () => {
  mount("archivist", "You keep the record.", [tool("file_it")]);
  const desk = await laid([tool("file_it")]);
  await expect(assembleTurn({ desk, role: "archivist" })).rejects.toThrow(
    /"archivist" role and the "roles-test-item" desk item both offer the tool "file_it"/,
  );
});
