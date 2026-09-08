// Laying the desk (src/desk, docs/61): which openers answer, in what order, and
// what the registry refuses to lay. Fake items throughout — what a book or a
// briefing puts on the desk is tested where it is written. Run: bun test.

import { expect, test } from "bun:test";
import {
  deskKindRegistered,
  openDesk,
  registerDeskItemKind,
  registeredDeskKinds,
  type DeskEnv,
  type DeskItem,
  type DeskItemKind,
} from "../../src/desk";
import { DEFAULT_SETTINGS } from "../../src/platform/app/settings";

const env: DeskEnv = {
  settings: { ...DEFAULT_SETTINGS },
  topic: { id: null, name: "Nothing" },
  thread: { key: "book-1", id: "thread-1" },
};

function item(over: Partial<DeskItem> = {}): DeskItem {
  return {
    kind: "fake",
    label: "Fake",
    tools: [],
    toolPrompts: [],
    rungs: [],
    prompt: () => "",
    ...over,
  };
}

function kindOf(kind: string, open: DeskItemKind["open"]): DeskItemKind {
  return { kind, open };
}

function tool(name: string) {
  return { name, description: "", parameters: {}, execute: async () => "" } as never;
}

test("an opener is registered by kind, and unregistering takes it away again", async () => {
  const off = registerDeskItemKind(kindOf("k-one", async () => item({ kind: "k-one" })));
  expect(deskKindRegistered("k-one")).toBe(true);
  expect(registeredDeskKinds()).toContain("k-one");
  const desk = await openDesk([{ kind: "k-one", ref: {} }], env);
  expect(desk.items.map((i) => i.kind)).toEqual(["k-one"]);
  off();
  expect(deskKindRegistered("k-one")).toBe(false);
});

// A second registration is a second boot, not a conflict: two shells in one
// process, or a test registering what the app already registered.
test("registering a kind twice replaces the opener rather than throwing", async () => {
  registerDeskItemKind(kindOf("k-two", async () => item({ kind: "k-two", label: "first" })));
  registerDeskItemKind(kindOf("k-two", async () => item({ kind: "k-two", label: "second" })));
  const desk = await openDesk([{ kind: "k-two", ref: {} }], env);
  expect(desk.items.map((i) => i.label)).toEqual(["second"]);
  expect(registeredDeskKinds().filter((k) => k === "k-two")).toHaveLength(1);
});

test("the desk holds what was asked for, in the order it was asked for", async () => {
  registerDeskItemKind(kindOf("k-a", async () => item({ kind: "k-a" })));
  registerDeskItemKind(kindOf("k-b", async () => item({ kind: "k-b" })));
  const desk = await openDesk(
    [
      { kind: "k-b", ref: {} },
      { kind: "k-a", ref: {} },
    ],
    env,
  );
  expect(desk.items.map((i) => i.kind)).toEqual(["k-b", "k-a"]);
  expect(desk.env).toBe(env);
});

// The gate an item sits behind is the item's own to check: nothing kept, no
// prep run, a signal that aborted. It leaves no gap on the desk.
test("an opener that answers null puts nothing on the desk", async () => {
  registerDeskItemKind(kindOf("k-present", async () => item({ kind: "k-present" })));
  registerDeskItemKind(kindOf("k-absent", async () => null));
  const desk = await openDesk(
    [
      { kind: "k-absent", ref: {} },
      { kind: "k-present", ref: {} },
    ],
    env,
  );
  expect(desk.items.map((i) => i.kind)).toEqual(["k-present"]);
});

test("the ref is handed to the opener, with the env", async () => {
  const seen: unknown[] = [];
  const sawEnv: DeskEnv[] = [];
  registerDeskItemKind(
    kindOf("k-ref", async (ref, e) => {
      seen.push(ref);
      sawEnv.push(e);
      return item({ kind: "k-ref" });
    }),
  );
  await openDesk([{ kind: "k-ref", ref: { bookId: "b-1" } }], env);
  expect(seen).toEqual([{ bookId: "b-1" }]);
  expect(sawEnv[0]).toBe(env);
});

// A kind nothing has registered is a wiring mistake — the domain that owns it
// never booted — and laying an empty desk would turn it into a turn answering
// about nothing.
test("an unregistered kind is refused", async () => {
  await expect(openDesk([{ kind: "k-nobody", ref: {} }], env)).rejects.toThrow(
    /nothing registered for kind "k-nobody"/,
  );
});

test("two items offering the same tool name are refused", async () => {
  registerDeskItemKind(
    kindOf("k-left", async () => item({ kind: "k-left", tools: [tool("read_pages")] })),
  );
  registerDeskItemKind(
    kindOf("k-right", async () => item({ kind: "k-right", tools: [tool("read_pages")] })),
  );
  await expect(
    openDesk(
      [
        { kind: "k-left", ref: {} },
        { kind: "k-right", ref: {} },
      ],
      env,
    ),
  ).rejects.toThrow(/both offer the tool "read_pages"/);
});

// The memory paragraph is about the reader, not about the material: two copies
// of it in one prompt would be two copies of the same claims.
test("two items anchoring the retrieval are refused", async () => {
  const memory = { bookId: "b-1", observations: [], snapshot: () => "" };
  registerDeskItemKind(kindOf("k-m1", async () => item({ kind: "k-m1", memory })));
  registerDeskItemKind(kindOf("k-m2", async () => item({ kind: "k-m2", memory })));
  await expect(
    openDesk(
      [
        { kind: "k-m1", ref: {} },
        { kind: "k-m2", ref: {} },
      ],
      env,
    ),
  ).rejects.toThrow(/both carry the memory/);
});

test("two items carrying the history are refused", async () => {
  const history = { compose: () => [] };
  registerDeskItemKind(kindOf("k-h1", async () => item({ kind: "k-h1", history })));
  registerDeskItemKind(kindOf("k-h2", async () => item({ kind: "k-h2", history })));
  await expect(
    openDesk(
      [
        { kind: "k-h1", ref: {} },
        { kind: "k-h2", ref: {} },
      ],
      env,
    ),
  ).rejects.toThrow(/both carry the history/);
});
