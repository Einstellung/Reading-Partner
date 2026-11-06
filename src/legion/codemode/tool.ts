// run_code (docs/soul/686): the model writes a JavaScript program and the app
// runs it over the turn's read tools, so a figure computed from data is
// computed by a program and not by the model. The program runs in a QuickJS VM
// whose only capability is calling those reads (`tools.<name>(args)`): no write
// tool, no network, no file system is reachable from it. Only what the program
// prints and returns comes back, cut to a budget; the nested results never
// enter the model's context.
//
// The description is one fixed text, whatever the desk holds. The durable
// runtime registers every tool once per process from the catalog and sends the
// model the catalog's description (legion/durable/tools.ts), and a fixed text
// keeps the cache prefix where it was. Each read is in the model's tool list
// already with its schema; inside the VM `ALL_TOOLS` lists their signatures.

import { Type, validateToolArguments, type Tool } from "@earendil-works/pi-ai";
import { renderToolSignature } from "@earendil-works/pi-codemode/declarations";
import type { CodemodeJsonSchema, CodemodeResult, CodemodeTool } from "@earendil-works/pi-codemode/portable";
import { t } from "../../i18n";
import type { AgentTool } from "../durable/contract";
import type { DurableTool } from "../durable/tools";
import { defaultRunner, runProgram, type SandboxLimits, type SandboxRunner } from "./sandbox";
import { appQuickJsWasm, type QuickJsWasm } from "./wasm";

export const CODEMODE_TOOL = "run_code";

/** Characters of printed and returned text handed back to the model. */
export const CODEMODE_OUTPUT_CHARS = 12_000;

/** Tool calls one program may make. */
export const CODEMODE_CALLS = 50;

export const CODEMODE_LIMITS: SandboxLimits = {
  timeoutMs: 60_000,
  interruptBudget: 100_000,
  memoryLimitBytes: 64 * 1024 * 1024,
};

export const CODEMODE_DESCRIPTION =
  "Run a short JavaScript program over what your read-only tools return, and get back only " +
  "what it prints and returns; the intermediate results never reach you. Use it when an answer " +
  "has to be computed from data: totals, counts, averages, filtering, sorting, or comparing " +
  "across several lookups. The program computes the figures so you do not work them out " +
  "yourself. The code is the body of an async function. `await tools.<name>(args)` calls any " +
  "read-only tool you hold, with the arguments that tool takes, and resolves to the text it " +
  "would have returned to you (JSON.parse it when it is JSON). `text(value)` or " +
  "`console.log(value)` prints; `return value` hands a value back. `ALL_TOOLS` lists the " +
  "callable tools with their signatures. Tools that change anything cannot be called from a " +
  "program, and there is no network, file access or timer. An error comes back with the line " +
  "it happened on: fix the program and run it again.";

export const CODE_PARAMETER_DESCRIPTION =
  "The program, as the body of an async function. Example: " +
  "`const rows = JSON.parse(await tools.some_tool({})); return rows.filter((r) => r.done).length;`";

export interface CodemodeDeps {
  /** The compiled engine. The self-hosted one unless a test hands one in. */
  wasm?: QuickJsWasm;
  /** Where the VM runs. A Web Worker wherever there is one. */
  runner?: SandboxRunner;
  /** Starts the worker. The bundled entry unless a test hands one in. */
  spawn?: () => Worker;
  limits?: Partial<SandboxLimits>;
  outputChars?: number;
  maxCalls?: number;
}

/**
 * The tools a program may call: reads that run by themselves. A write never is,
 * nor run_code itself, nor a read that runs a child conversation on the
 * durable runtime (a sub-agent), which has no `execute` of its own to call.
 */
export function codemodeReach(tools: readonly AgentTool[]): AgentTool[] {
  return tools.filter(
    (tool) => tool.effect === "read" && tool.name !== CODEMODE_TOOL && !(tool as DurableTool).runInDurable,
  );
}

/** `tools` with run_code added over them, when there is a read for it to call and it is not there already. */
export function withCodemode(tools: readonly AgentTool[], deps: CodemodeDeps = {}): AgentTool[] {
  if (tools.some((tool) => tool.name === CODEMODE_TOOL)) return [...tools];
  if (codemodeReach(tools).length === 0) return [...tools];
  return [...tools, buildCodemodeTool(tools, deps)];
}

/** run_code over the reads among `tools`, which is the turn's final list. */
export function buildCodemodeTool(tools: readonly AgentTool[], deps: CodemodeDeps = {}): AgentTool {
  const reach = codemodeReach(tools);
  return {
    name: CODEMODE_TOOL,
    label: () => t("chat.runCode.running"),
    effect: "read",
    // A program can only read, so running it again costs the reads and nothing else.
    replay: "safe",
    description: CODEMODE_DESCRIPTION,
    parameters: Type.Object({ code: Type.String({ description: CODE_PARAMETER_DESCRIPTION }) }),
    execute: async (args) => {
      const code = String(args.code ?? "");
      if (code.trim() === "") throw new Error(`${CODEMODE_TOOL} needs a program in code.`);
      const max = deps.maxCalls ?? CODEMODE_CALLS;
      const calls = { left: max, max };
      const result = await runProgram(code, {
        tools: reach.map((tool) => sandboxTool(tool, calls)),
        wasm: deps.wasm ?? appQuickJsWasm,
        limits: { ...CODEMODE_LIMITS, ...deps.limits },
        runner: deps.runner ?? defaultRunner(),
        ...(deps.spawn ? { spawn: deps.spawn } : {}),
      });
      return reportResult(result, deps.outputChars ?? CODEMODE_OUTPUT_CHARS);
    },
  };
}

// One read as the VM sees it. Arguments are checked and coerced against the
// tool's schema the way the turn's own loop does before `execute`; the result
// is the text the model would have been handed, images left out.
export function sandboxTool(tool: AgentTool, calls: { left: number; max: number }): CodemodeTool {
  const inputSchema = tool.parameters as unknown as CodemodeJsonSchema;
  const outputSchema: CodemodeJsonSchema = { type: "string" };
  return {
    name: tool.name,
    description: renderToolSignature({ name: tool.name, inputSchema, outputSchema }),
    inputSchema,
    outputSchema,
    execute: async (args) => {
      if (calls.left <= 0) {
        throw new Error(`A program may call tools at most ${calls.max} times. Call fewer and aggregate.`);
      }
      calls.left--;
      const validated = validateToolArguments(tool as unknown as Tool, {
        type: "toolCall",
        id: CODEMODE_TOOL,
        name: tool.name,
        // A JSON round trip has already been made on the way out of the VM.
        arguments: (args ?? {}) as Parameters<typeof validateToolArguments>[1]["arguments"],
      }) as Record<string, unknown>;
      const result = await tool.execute(validated);
      return typeof result === "string" ? result : result.text;
    },
  };
}

/**
 * What the model is handed: the printed text, then the returned value. A
 * failed program is thrown, so it comes back as an error result: the kind,
 * the error and the line, and what it printed before it failed.
 */
export function reportResult(result: CodemodeResult, budget: number): string {
  const printed = result.output.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
  if (result.ok) {
    const parts = printed === "" ? [] : [printed];
    if (result.value !== undefined) parts.push(`Returned: ${show(result.value)}`);
    if (parts.length === 0) parts.push("The program printed nothing and returned nothing.");
    return clip(parts.join("\n"), budget);
  }
  const { error } = result;
  const where = error.stack
    ?.split("\n")
    .find((line) => line.includes("codemode.js"))
    ?.trim();
  const head = `${error.name ? `${error.name}: ` : ""}${error.message}`;
  const lines = [`The program failed (${error.kind}): ${head}${where ? ` [${where}]` : ""}`];
  if (error.kind === "timeout") lines.push("It ran out of time: compute less, or call fewer tools.");
  if (printed !== "") lines.push(`It printed before failing:\n${printed}`);
  throw new Error(clip(lines.join("\n"), budget));
}

function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function clip(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return (
    `${text.slice(0, budget)}\n[Cut at ${budget} of ${text.length} characters. ` +
    "Print less: aggregate, filter or slice in the program.]"
  );
}
