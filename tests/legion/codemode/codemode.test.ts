// run_code (docs/soul/686): a program over the turn's read tools, run in a
// QuickJS VM whose only capability is calling those reads.

import { afterEach, describe, expect, test } from "bun:test";
import { Type } from "typebox";
import type { AgentTool } from "../../../src/legion/durable/contract";
import {
  buildCodemodeTool,
  CODEMODE_DESCRIPTION,
  CODEMODE_TOOL,
  codemodeReach,
  replaceQuickJsWasm,
  withCodemode,
  type CodemodeDeps,
  type SandboxRunner,
} from "../../../src/legion/codemode";
import { runSubagent, type SubagentDefinition } from "../../../src/legion/subagent";
import { testQuickJsWasm } from "../../support/quickjs";

const afterTest: (() => void)[] = [];
afterEach(() => {
  for (const undo of afterTest.splice(0)) undo();
});

const MEALS = [
  { day: "mon", name: "oats", kcal: 420, eaten: true },
  { day: "mon", name: "chicken rice", kcal: 650, eaten: true },
  { day: "tue", name: "salmon", kcal: 580, eaten: false },
  { day: "tue", name: "yoghurt", kcal: 150, eaten: true },
];

function fakeTools(log: { wrote: number; reads: string[] }): AgentTool[] {
  return [
    {
      name: "list_meals",
      label: () => "Listing meals",
      effect: "read",
      description: "The planned meals, as JSON.",
      parameters: Type.Object({ day: Type.Optional(Type.String({ description: "mon or tue" })) }),
      execute: async (args) => {
        log.reads.push(`list_meals:${args.day ?? "*"}`);
        return JSON.stringify(args.day ? MEALS.filter((m) => m.day === args.day) : MEALS);
      },
    },
    {
      name: "plan_note",
      label: () => "Reading the note",
      effect: "read",
      description: "The plan's note.",
      parameters: Type.Object({}),
      execute: async () => ({ text: "high protein week", images: [{ data: "AAAA", mimeType: "image/png" }] }),
    },
    {
      name: "missing_day",
      label: () => "Reading a day",
      effect: "read",
      description: "Always fails.",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("no such day");
      },
    },
    {
      name: "save_meal",
      label: () => "Saving a meal",
      effect: "write",
      gate: "card",
      description: "Writes a meal.",
      parameters: Type.Object({ name: Type.String() }),
      execute: async () => {
        log.wrote++;
        return { text: "saved", receipt: null };
      },
    },
  ];
}

function setup(runner: SandboxRunner, deps: CodemodeDeps = {}) {
  const log = { wrote: 0, reads: [] as string[] };
  const tool = buildCodemodeTool(fakeTools(log), { wasm: testQuickJsWasm, runner, ...deps });
  const run = async (code: string) => tool.execute({ code }) as Promise<string>;
  return { log, tool, run };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected the program to fail");
}

for (const runner of ["worker", "inline"] as const) {
  describe(`run_code (${runner})`, () => {
    test("reads a tool and computes over its JSON", async () => {
      const { run, log } = setup(runner);
      const out = await run(
        [
          "const meals = JSON.parse(await tools.list_meals({}));",
          "const eaten = meals.filter((m) => m.eaten);",
          "text(`eaten ${eaten.length}`);",
          "return eaten.reduce((sum, m) => sum + m.kcal, 0);",
        ].join("\n"),
      );
      expect(out).toBe("eaten 3\nReturned: 1220");
      expect(log.reads).toEqual(["list_meals:*"]);
    });

    test("combines several reads and hands back only what it prints", async () => {
      const { run, log } = setup(runner);
      const out = await run(
        [
          "const days = ['mon', 'tue'];",
          "const totals = {};",
          "for (const day of days) totals[day] = JSON.parse(await tools.list_meals({ day })).reduce((s, m) => s + m.kcal, 0);",
          "const note = await tools.plan_note({});",
          "return { totals, note };",
        ].join("\n"),
      );
      expect(out).toBe('Returned: {"totals":{"mon":1070,"tue":730},"note":"high protein week"}');
      expect(log.reads).toEqual(["list_meals:mon", "list_meals:tue"]);
    });

    test("a write tool is not there, and nothing the program does writes", async () => {
      const { run, log } = setup(runner);
      const out = await run(
        [
          "text(ALL_TOOLS.map((t) => t.name).join(','));",
          "try { await tools.save_meal({ name: 'x' }); } catch (e) { text(e.name); }",
          "try { await tools['save_meal']({ name: 'x' }); } catch (e) { text(e.name); }",
          "try { await tools.run_code({ code: '' }); } catch (e) { text(e.name); }",
        ].join("\n"),
      );
      expect(out.split("\n")).toEqual(["list_meals,plan_note,missing_day", "TypeError", "TypeError", "TypeError"]);
      // Reaching for a write says what is there instead.
      const message = await failure(run("await tools.save_meal({ name: 'x' });"));
      expect(message).toContain("tools.save_meal does not exist. Available: list_meals, plan_note, missing_day.");
      expect(log.wrote).toBe(0);
    });

    test("no network, no timers, no host", async () => {
      const { run } = setup(runner);
      const out = await run("return [typeof fetch, typeof setTimeout, typeof XMLHttpRequest, typeof process, typeof require].join(',');");
      expect(out).toBe("Returned: undefined,undefined,undefined,undefined,undefined");
    });

    test("a script error comes back with its kind, message and line", async () => {
      const { run } = setup(runner);
      const message = await failure(run("text('before');\nconst row = null;\nreturn row.kcal;"));
      expect(message).toContain("The program failed (script): TypeError:");
      expect(message).toContain("codemode.js:3");
      expect(message).toContain("It printed before failing:\nbefore");
    });

    test("a tool that throws rejects inside the program, where it can be caught", async () => {
      const { run } = setup(runner);
      expect(await run("try { await tools.missing_day({}); } catch (e) { return e.message; }")).toBe(
        "Returned: no such day",
      );
      expect(await failure(run("await tools.missing_day({});"))).toContain("no such day");
    });

    test("a loop that never yields ends on its interrupt budget", async () => {
      const { run } = setup(runner, { limits: { interruptBudget: 2_000 } });
      const started = Date.now();
      const message = await failure(run("let i = 0;\nwhile (true) { i++; }"));
      expect(message).toContain("The program failed (timeout)");
      expect(Date.now() - started).toBeLessThan(10_000);
    });

    test("printing past the budget is cut, with the total said", async () => {
      const { run } = setup(runner, { outputChars: 1_000 });
      const out = await run("text('x'.repeat(50000));");
      expect(out.startsWith("x".repeat(1_000) + "\n[Cut at 1000 of 50000 characters.")).toBe(true);
      expect(out.length).toBeLessThan(1_200);
    });

    test("a program may make only so many tool calls", async () => {
      const { run, log } = setup(runner, { maxCalls: 3 });
      const message = await failure(run("for (let i = 0; i < 5; i++) await tools.list_meals({});"));
      expect(message).toContain("at most 3 times");
      expect(log.reads.length).toBe(3);
    });

    test("ALL_TOOLS carries each read's rendered declaration", async () => {
      const { run } = setup(runner);
      const out = await run("return ALL_TOOLS.find((t) => t.name === 'list_meals').description;");
      expect(out).toContain("list_meals(args:");
      expect(out).toContain("day?: string");
      expect(out).toContain("Promise<string>");
    });

    test("arguments are checked against the tool's schema", async () => {
      const { run } = setup(runner);
      const message = await failure(run("await tools.list_meals({ day: { not: 'a string' } });"));
      expect(message).toContain("list_meals");
    });
  });
}

test("the deadline ends a program that spins in its worker", async () => {
  const { run } = setup("worker", { limits: { timeoutMs: 300, interruptBudget: 1e12 } });
  const started = Date.now();
  const message = await failure(run("while (true) {}"));
  expect(message).toContain("The program failed (timeout)");
  expect(Date.now() - started).toBeLessThan(5_000);
});

// A delegated worker gets run_code too, over the same reads it holds; what its
// program looks up counts as the run's evidence, like a direct call.
test("a sub-agent run mounts run_code over its reads, and the program's lookups are its evidence", async () => {
  const undo = replaceQuickJsWasm(testQuickJsWasm);
  afterTest.push(undo);
  const log = { wrote: 0, reads: [] as string[] };
  const tools = fakeTools(log).filter((t) => t.effect === "read");
  let mounted: string[] = [];
  const brief = await runSubagent(
    {
      definition: {
        name: "probe",
        description: "Probe.",
        label: "Probing",
        systemPrompt: "Answer.",
        briefContract: false,
        tools,
        maxRounds: 2,
      } as SubagentDefinition,
      task: "How many calories were eaten?",
    },
    {
      run: async (request) => {
        mounted = request.tools.map((t) => t.name);
        const runCode = request.tools.find((t) => t.name === CODEMODE_TOOL)!;
        const program = "return JSON.parse(await tools.list_meals({})).filter((m) => m.eaten).reduce((s, m) => s + m.kcal, 0);";
        const out = await runCode.execute({ code: program });
        return { kind: "answer", text: `Eaten: ${String(out).replace("Returned: ", "")} kcal.` };
      },
    },
  );
  expect(mounted).toEqual(["list_meals", "plan_note", "missing_day", CODEMODE_TOOL]);
  expect(brief.outcome).toBe("answered");
  expect(brief.toolSuccesses).toBe(1);
  expect(brief.brief).toContain("Eaten: 1220 kcal.");
});

test("run_code reaches reads only, never itself or a child-running read", () => {
  const log = { wrote: 0, reads: [] as string[] };
  const tools = fakeTools(log);
  const child = { ...tools[0]!, name: "research", runInDurable: async () => "" } as AgentTool;
  const self = buildCodemodeTool(tools);
  expect(codemodeReach([...tools, child, self]).map((t) => t.name)).toEqual(["list_meals", "plan_note", "missing_day"]);
});

test("withCodemode adds run_code once, and only where there is a read", () => {
  const log = { wrote: 0, reads: [] as string[] };
  const tools = fakeTools(log);
  const writes = tools.filter((t) => t.effect === "write");
  expect(withCodemode(writes).map((t) => t.name)).toEqual(["save_meal"]);
  const once = withCodemode(tools);
  expect(once.map((t) => t.name)).toEqual(["list_meals", "plan_note", "missing_day", "save_meal", CODEMODE_TOOL]);
  expect(withCodemode(once).length).toBe(once.length);
});

test("the description is one fixed text, whatever the desk holds", () => {
  const log = { wrote: 0, reads: [] as string[] };
  const tool = buildCodemodeTool(fakeTools(log));
  expect(tool.description).toBe(CODEMODE_DESCRIPTION);
  expect(buildCodemodeTool([]).description).toBe(CODEMODE_DESCRIPTION);
  expect(tool.effect).toBe("read");
  expect(tool.replay).toBe("safe");
});
