// edit_data and undo_edit (docs/platform/687 模型看到的接口). The model is
// handed a copy of the data inside the run_code sandbox, writes a program that
// changes it and returns it; the engine compares, guards and lands it. The
// descriptions are fixed texts for the same reason run_code's is: the durable
// runtime registers tools once per process from the catalog.

import { Type } from "@earendil-works/pi-ai";
import type { CodemodeResult } from "@earendil-works/pi-codemode/portable";
import { t } from "../../i18n";
import {
  CODEMODE_CALLS,
  CODEMODE_LIMITS,
  CODEMODE_OUTPUT_CHARS,
  appQuickJsWasm,
  codemodeReach,
  defaultRunner,
  reportResult,
  runProgram,
  sandboxTool,
  type CodemodeDeps,
} from "../../legion/codemode";
import type { AgentTool, ToolResult } from "../../legion/durable/contract";
import { confirmCard, type RaiseConfirmCard } from "./card";
import {
  liveWriteDeps,
  openCopy,
  settleEdit,
  targetOf,
  undoLatest,
  type UndoOutcome,
  type WriteDeps,
} from "./engine";
import { registeredWritables, type Initiator } from "./registry";

export const EDIT_DATA_TOOL = "edit_data";
export const UNDO_EDIT_TOOL = "undo_edit";

export const EDIT_DATA_DESCRIPTION =
  "Change the reader's data by program. You get a copy of one kind's data as `data` inside the " +
  "same sandbox as run_code, and `SHAPE`, a TypeScript declaration of it saying which fields are " +
  "inputs, which the app computes (and from what) and which are locked. The code is the body of an " +
  "async function: change `data` (or build a new value) and `return` it. The app compares it with " +
  "the copy, checks it, and writes it, recomputing what it computes; change inputs only. Without a " +
  "`return` nothing is written and you get back only what the program printed: print SHAPE and part " +
  "of `data` first to see what is there. `tools.<name>(args)`, `text()`, `console.log()` and " +
  "`ALL_TOOLS` work as in run_code, over your read-only tools. A refused change comes back with " +
  "each problem and its field path, and nothing written: fix the program and call again. Some " +
  "changes wait for the reader to confirm on a card. Do not repeat the data back to the reader.";

export const UNDO_EDIT_DESCRIPTION =
  "Take back the latest edit_data change to one kind's data that is not taken back yet, when the " +
  "reader asks for it to be put back. Calling it again goes one more step back. Refused when the " +
  "data has changed since that write; then make the change the reader wants with edit_data.";

/** Who is asking, and where a confirmation card goes. Passed by the turn's assembly or the sub-agent runner. */
export interface EditSurface {
  initiator: Initiator;
  /** Absent where no card can be shown; a run's records wait for its delivery instead. */
  raiseCard?: RaiseConfirmCard;
}

export interface EditToolDeps extends Omit<CodemodeDeps, "runner"> {
  runner?: CodemodeDeps["runner"];
  write?: Partial<WriteDeps>;
}

function printedOf(result: CodemodeResult): string {
  return result.output.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

function clip(text: string, budget: number): string {
  return text.length <= budget ? text : `${text.slice(0, budget)}\n[Cut at ${budget} of ${text.length} characters.]`;
}

function bullet(lines: readonly string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

const NOTHING_WRITTEN = "Nothing was written.";

function idOf(args: Record<string, unknown>): string | null {
  return typeof args.id === "string" && args.id !== "" ? args.id : null;
}

/** What one settled write says to the model, and the receipt the reader sees. */
function report(outcome: UndoOutcome, kind: string, surface: EditSurface, budget: number): ToolResult {
  switch (outcome.status) {
    case "looked":
    case "unchanged": {
      const printed = outcome.printed === "" ? "The program printed nothing." : outcome.printed;
      const tail = outcome.status === "unchanged" ? `\n${NOTHING_WRITTEN} The returned value is the same as the copy.` : "";
      return { text: clip(printed, budget) + tail, receipt: null };
    }
    case "rejected": {
      const problems = outcome.problems.map((p) => `${p.path === "" ? "(whole value)" : p.path}: ${p.message}`);
      const printed = outcome.printed === "" ? "" : `\nThe program printed:\n${clip(outcome.printed, budget)}`;
      return {
        text: `${NOTHING_WRITTEN} Fix these and call ${EDIT_DATA_TOOL} again:\n${bullet(problems)}${printed}`,
        receipt: null,
      };
    }
    case "pending": {
      surface.raiseCard?.(confirmCard(outcome.record));
      const where = surface.raiseCard
        ? "A card is waiting for the reader to confirm it"
        : "It waits for the reader to confirm it on a card in the conversation this work was asked from";
      return { text: `${where}; nothing is written until then.\n${bullet(outcome.record.lines)}`, receipt: null };
    }
    case "unconfirmable":
      return {
        text: `${NOTHING_WRITTEN} This change needs the reader's confirmation and no card can be shown here.\n${bullet(outcome.lines)}`,
        receipt: null,
      };
    case "stale":
      return { text: `${NOTHING_WRITTEN} The data changed while the program ran. Call again; it opens the data afresh.`, receipt: null };
    case "failed":
      return { text: `${NOTHING_WRITTEN} ${outcome.reason}`, receipt: null };
    case "nothing":
      return { text: `There is no ${EDIT_DATA_TOOL} change to ${kind} left to take back.`, receipt: null };
    case "moved": {
      const since = outcome.since.map((v) => `${v.why}${v.lines.length > 0 ? ` (${v.lines.join("; ")})` : ""}`);
      const list = since.length > 0 ? `\nChanges made by ${EDIT_DATA_TOOL} since:\n${bullet(since)}` : "";
      return {
        text:
          `${NOTHING_WRITTEN} The data has changed since that write, so it cannot simply be put back.${list}\n` +
          `Make the change the reader wants with ${EDIT_DATA_TOOL}.`,
        receipt: null,
      };
    }
    case "written":
      return {
        text:
          `Written (version ${outcome.writeId}).\n${bullet(outcome.lines)}` +
          (outcome.notes.length > 0 ? `\n${outcome.notes.join("\n")}` : "") +
          "\nDo not repeat the data back to the reader.",
        receipt: { label: t("chat.editData.changed"), summary: outcome.lines.join("; ") },
      };
  }
}

/** edit_data and undo_edit over the reads among `tools`, which is the turn's final list. */
export function buildEditTools(tools: readonly AgentTool[], surface: EditSurface, deps: EditToolDeps = {}): AgentTool[] {
  const reach = codemodeReach(tools);
  const write = () => liveWriteDeps(deps.write);
  const budget = deps.outputChars ?? CODEMODE_OUTPUT_CHARS;
  const request = (args: Record<string, unknown>) => ({
    kind: String(args.kind ?? ""),
    id: idOf(args),
    why: String(args.why ?? ""),
    initiator: surface.initiator,
    canConfirm: surface.raiseCard !== undefined || surface.initiator.runId !== undefined,
  });

  const editData: AgentTool = {
    name: EDIT_DATA_TOOL,
    label: () => t("chat.editData.running"),
    effect: "write",
    description: EDIT_DATA_DESCRIPTION,
    parameters: Type.Object({
      kind: Type.String({ description: "The kind of data, as the catalogue names it." }),
      id: Type.Optional(Type.String({ description: "Which one, for a kind with more than one; omit for a single file." })),
      code: Type.String({ description: "The program, as the body of an async function. `return data` to write." }),
      why: Type.String({ description: "One line, in the reader's words, saying why this changes." }),
    }),
    execute: async (args) => {
      const code = String(args.code ?? "");
      if (code.trim() === "") throw new Error(`${EDIT_DATA_TOOL} needs a program in code.`);
      const req = request(args);
      const wd = write();
      const target = targetOf(req.kind, req.id, wd);
      const copy = await openCopy(target, req.id);
      const max = deps.maxCalls ?? CODEMODE_CALLS;
      const calls = { left: max, max };
      // The copy goes in on the program's first line, so its line numbers are the model's own.
      const prelude = `const data = ${JSON.stringify(copy.value)}; const SHAPE = ${JSON.stringify(target.entry.shape)}; `;
      const result = await runProgram(prelude + code, {
        tools: reach.map((tool) => sandboxTool(tool, calls)),
        wasm: deps.wasm ?? appQuickJsWasm,
        limits: { ...CODEMODE_LIMITS, ...deps.limits },
        runner: deps.runner ?? defaultRunner(),
        ...(deps.spawn ? { spawn: deps.spawn } : {}),
      });
      // A failed program throws, in run_code's own words.
      if (!result.ok) reportResult(result, budget);
      const outcome = await settleEdit(req, copy, { printed: printedOf(result), value: result.ok ? result.value : undefined }, wd);
      return report(outcome, req.kind, surface, budget);
    },
  };

  const undoEdit: AgentTool = {
    name: UNDO_EDIT_TOOL,
    label: () => t("chat.undoEdit.running"),
    effect: "write",
    description: UNDO_EDIT_DESCRIPTION,
    parameters: Type.Object({
      kind: Type.String({ description: "The kind of data, as the catalogue names it." }),
      id: Type.Optional(Type.String({ description: "Which one, for a kind with more than one; omit for a single file." })),
    }),
    execute: async (args) => {
      const req = { ...request(args), why: "" };
      const outcome = await undoLatest(req, write());
      return report(outcome, req.kind, surface, budget);
    },
  };

  return [editData, undoEdit];
}

/**
 * `tools` with edit_data and undo_edit added, when a domain has registered
 * something they can change and they are not there already.
 */
export function withEditData(tools: readonly AgentTool[], surface: EditSurface, deps: EditToolDeps = {}): AgentTool[] {
  if (tools.some((tool) => tool.name === EDIT_DATA_TOOL)) return [...tools];
  if (registeredWritables().length === 0) return [...tools];
  return [...tools, ...buildEditTools(tools, surface, deps)];
}
