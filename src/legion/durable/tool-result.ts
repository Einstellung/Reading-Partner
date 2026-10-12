// The two pieces of the adapter that are worth testing without a harness: the
// line a tool call shows while it runs, and the check that a write came back
// with a receipt. turn.ts calls both; nothing here knows about pi.

import type { AgentTool, Receipt, ToolResult, ToolResultImage } from "./contract";

// The reader's line for a call. A label that throws or comes back blank is a
// bug in the tool, not a reason to fail the turn: the name stands in.
export function toolLabel(tool: AgentTool, args: Record<string, any>): string {
  try {
    const label = tool.label(args).trim();
    return label || tool.name;
  } catch {
    return tool.name;
  }
}

// What a tool returned, in one shape, with the gate enforced: a tool declared
// `effect: "write"` that succeeds without a receipt has changed something the
// reader will never be told about, so the call is turned into an error the model
// has to account for rather than a silent write.
export function normalizeToolResult(
  tool: AgentTool,
  raw: string | ToolResult,
): { text: string; images: ToolResultImage[]; receipt?: Receipt } {
  const text = typeof raw === "string" ? raw : raw.text;
  const images = typeof raw === "string" ? [] : (raw.images ?? []);
  const receipt = typeof raw === "string" ? undefined : raw.receipt;
  if (tool.effect === "write" && receipt === undefined) {
    throw new Error(
      `${tool.name} returned without a receipt, so a change the reader is never told ` +
        `about may have landed. Report what you did instead of calling it again.`,
    );
  }
  return { text, images, ...(receipt ? { receipt } : {}) };
}
