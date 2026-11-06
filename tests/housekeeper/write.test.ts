// edit_data and undo_edit over a kind of the test's own (docs/platform/687):
// the program runs in the real run_code sandbox, the guards and the landing
// are the housekeeper's, the files are in memory.

import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import type { AgentTool, ToolResult } from "../../src/legion/durable/contract";
import {
  buildEditTools,
  changedPaths,
  confirmPending,
  declinePending,
  underPattern,
  type HousekeeperConfirmCard,
} from "../../src/housekeeper/write";
import type { SandboxRunner } from "../../src/legion/codemode";
import { testQuickJsWasm } from "../support/quickjs";
import { NOTES_KIND, NOTES_PATH, memIo, notesDeps, notesEntry, readNotes, seedNotes } from "./write-fixture";

function setup(options: { runner?: SandboxRunner; card?: boolean; reads?: AgentTool[] } = {}) {
  const io = memIo();
  const original = seedNotes(io);
  const clock = { now: 1_000 };
  const log = { landed: 0 };
  const deps = notesDeps(io, notesEntry(io, log), clock);
  const cards: HousekeeperConfirmCard[] = [];
  const [edit, undo] = buildEditTools(
    options.reads ?? [],
    {
      initiator: { threadId: "t1", place: "meals" },
      ...(options.card === false ? {} : { raiseCard: (card: HousekeeperConfirmCard) => cards.push(card) }),
    },
    { wasm: testQuickJsWasm, runner: options.runner ?? "inline", write: deps },
  );
  const call = async (tool: AgentTool, args: Record<string, unknown>): Promise<ToolResult> => {
    clock.now += 1_000;
    const out = await tool.execute(args);
    return typeof out === "string" ? { text: out } : out;
  };
  return {
    io,
    original,
    log,
    deps,
    cards,
    edit: (code: string, why = "test") => call(edit!, { kind: NOTES_KIND, code, why }),
    undo: () => call(undo!, { kind: NOTES_KIND }),
    versions: () => [...io.files.keys()].filter((p) => p.startsWith(`housekeeper-versions/${NOTES_KIND}/`)).sort(),
    pendings: () => [...io.files.keys()].filter((p) => p.startsWith("housekeeper-pending/")),
  };
}

describe("paths", () => {
  test("changes are leaf paths, and a pattern covers what is below it", () => {
    expect(changedPaths({ a: { b: 1, c: [1, 2] } }, { a: { b: 2, c: [1] } }).sort()).toEqual(["a.b", "a.c.1"]);
    expect(changedPaths({ a: 1 }, { a: 1 })).toEqual([]);
    expect(underPattern("plan.days.3.lunch.solved.grams", "plan.days.*.*.solved")).toBe(true);
    expect(underPattern("plan.days.3.lunch.note", "plan.days.*.*.solved")).toBe(false);
  });
});

describe("edit_data", () => {
  test("a program that returns nothing only looks", async () => {
    const s = setup();
    const out = await s.edit("console.log(SHAPE.includes('computed')); text(data.items.length);");
    expect(out.text).toContain("true");
    expect(out.text).toContain("2");
    expect(out.receipt).toBeNull();
    expect(readNotes(s.io)).toEqual(s.original);
    expect(s.versions()).toEqual([]);
  });

  test("a change to an input lands, the computed field is recomputed, and the version is kept", async () => {
    const s = setup();
    const out = await s.edit("data.items[0].count = 5; return data;", "five eggs");
    expect(out.text).toContain("Written");
    expect(out.text).toContain("eggs: 5");
    expect(out.text).toContain("Total is now 6.");
    expect(out.receipt?.summary).toBe("eggs: 5");
    expect(readNotes(s.io).total).toBe(6);
    const [version] = s.versions();
    const record = JSON.parse(s.io.files.get(version!)!);
    expect(record.beforeText).toBe(JSON.stringify(s.original));
    expect(record.why).toBe("five eggs");
    expect(record.initiator).toEqual({ threadId: "t1", place: "meals" });
  });

  test("the same program runs in the worker", async () => {
    const s = setup({ runner: "worker" });
    const out = await s.edit("data.items[1].count = 4; return data;");
    expect(out.text).toContain("Written");
    expect(readNotes(s.io).total).toBe(6);
  });

  test("writing a computed or a locked field is sent back with its path, and nothing is written", async () => {
    const s = setup();
    const computed = await s.edit("data.total = 99; return data;");
    expect(computed.text).toContain("Nothing was written.");
    expect(computed.text).toContain("total: computed by the app; change items.*.count instead");
    const locked = await s.edit("data.id = 'x'; data.updatedAt = 5; return data;");
    expect(locked.text).toContain("id: locked");
    expect(locked.text).toContain("updatedAt: locked");
    const shape = await s.edit("return { nope: true };");
    expect(shape.text).toContain("not a notes file");
    expect(readNotes(s.io)).toEqual(s.original);
    expect(s.log.landed).toBe(0);
    expect(s.versions()).toEqual([]);
  });

  test("the domain's check stops a write", async () => {
    const s = setup();
    const out = await s.edit("data.items[0].count = 500; return data;");
    expect(out.text).toContain("items.0.count: at most 100");
    expect(readNotes(s.io)).toEqual(s.original);
  });

  test("a gated change waits on a card, and lands when the reader confirms", async () => {
    const s = setup();
    const out = await s.edit("data.title = 'Market'; return data;");
    expect(out.text).toContain("nothing is written until then");
    expect(out.receipt).toBeNull();
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0]!.lines).toEqual(["Title: Market"]);
    expect(s.cards[0]!.gate).toBe("replace");
    expect(readNotes(s.io).title).toBe("Groceries");
    expect(s.pendings()).toHaveLength(1);
    const outcome = await confirmPending(s.cards[0]!.pendingId, s.deps);
    expect(outcome.status).toBe("written");
    expect(readNotes(s.io).title).toBe("Market");
    expect(s.pendings()).toEqual([]);
    expect(s.versions()).toHaveLength(1);
  });

  test("declining a card deletes the record and writes nothing", async () => {
    const s = setup();
    await s.edit("data.title = 'Market'; return data;");
    await declinePending(s.cards[0]!.pendingId, s.deps);
    expect(s.pendings()).toEqual([]);
    expect(readNotes(s.io).title).toBe("Groceries");
    expect((await confirmPending(s.cards[0]!.pendingId, s.deps)).status).toBe("gone");
  });

  test("a gated change with no card to show is refused", async () => {
    const s = setup({ card: false });
    const out = await s.edit("data.title = 'Market'; return data;");
    expect(out.text).toContain("no card can be shown here");
    expect(s.pendings()).toEqual([]);
  });

  test("data that moved while the program ran, or before a card was confirmed, is not written over", async () => {
    let poke = (): void => {};
    const reads: AgentTool[] = [
      {
        name: "poke",
        label: () => "poke",
        effect: "read",
        description: "changes the file under the program",
        parameters: Type.Object({}),
        execute: async () => {
          poke();
          return "ok";
        },
      },
    ];
    const s = setup({ reads });
    poke = () => s.io.files.set(NOTES_PATH, JSON.stringify({ ...readNotes(s.io), title: "Elsewhere" }));
    const out = await s.edit("await tools.poke({}); data.items[0].count = 5; return data;");
    expect(out.text).toContain("The data changed while the program ran");
    expect(readNotes(s.io).items[0]!.count).toBe(2);
    expect(s.log.landed).toBe(0);

    await s.edit("data.title = 'Market'; return data;");
    s.io.files.set(NOTES_PATH, JSON.stringify({ ...readNotes(s.io), title: "Again" }));
    expect((await confirmPending(s.cards[0]!.pendingId, s.deps)).status).toBe("stale");
    expect(readNotes(s.io).title).toBe("Again");
    expect(s.pendings()).toEqual([]);
  });

  test("a program that throws comes back as run_code's error, with its line", async () => {
    const s = setup();
    await expect(s.edit("const x = 1;\nnull.boom;")).rejects.toThrow(/The program failed \(script\).*codemode\.js:2/s);
  });

  test("a kind nobody registered is refused with the kinds that can be edited", async () => {
    const s = setup();
    const [edit] = buildEditTools([], { initiator: {} }, { wasm: testQuickJsWasm, runner: "inline", write: s.deps });
    await expect(edit!.execute({ kind: "info-meals", code: "return 1", why: "" })).rejects.toThrow(
      /"info-meals" cannot be edited here\. These can:\n- test-notes: The test's notes\./,
    );
  });
});

describe("undo_edit", () => {
  test("undo steps back one write at a time, and says when there is nothing left", async () => {
    const s = setup();
    await s.edit("data.items[0].count = 5; return data;");
    await s.edit("data.items[0].count = 7; return data;");
    expect(readNotes(s.io).total).toBe(8);
    const first = await s.undo();
    expect(first.text).toContain("Written");
    expect(readNotes(s.io).items[0]!.count).toBe(5);
    await s.undo();
    expect(readNotes(s.io).items[0]!.count).toBe(2);
    expect(readNotes(s.io).total).toBe(3);
    expect((await s.undo()).text).toContain("no edit_data change to test-notes left to take back");
    // Two writes and two undos, each a version of its own.
    expect(s.versions()).toHaveLength(4);
  });

  test("undo is refused when the data changed after the write, and names what changed since", async () => {
    const s = setup();
    await s.edit("data.items[0].count = 5; return data;", "five eggs");
    s.io.files.set(NOTES_PATH, JSON.stringify({ ...readNotes(s.io), title: "Edited by hand" }));
    const out = await s.undo();
    expect(out.text).toContain("has changed since that write");
    expect(readNotes(s.io).title).toBe("Edited by hand");
    await s.edit("data.items[1].count = 3; return data;", "three milk");
    await s.undo();
    s.io.files.set(NOTES_PATH, JSON.stringify({ ...readNotes(s.io), title: "Again by hand" }));
    const later = await s.undo();
    expect(later.text).toContain("has changed since that write");
  });

  test("undoing a gated change waits on a card too", async () => {
    const s = setup();
    await s.edit("data.title = 'Market'; return data;");
    await confirmPending(s.cards[0]!.pendingId, s.deps);
    const out = await s.undo();
    expect(out.text).toContain("nothing is written until then");
    expect(s.cards).toHaveLength(2);
    expect((await confirmPending(s.cards[1]!.pendingId, s.deps)).status).toBe("written");
    expect(readNotes(s.io).title).toBe("Groceries");
  });
});
