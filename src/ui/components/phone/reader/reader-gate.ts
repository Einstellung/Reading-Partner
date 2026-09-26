// What the phone's reader will not do yet, and the one sentence the control
// says about it (docs/70, docs/77).
//
// The book's lesson is on the phone — Learn in the top bar opens the same
// book-level conversation the iPad has — but the AI pen is not: there is no
// asking about a passage here yet. The pen is still drawn — the phone is one of
// the reading forms, and the rule has to be legible where the reader would
// reach for it — so what is needed is the reason, and the way in that is here.

import type { FlowTool } from "../../../../reading/epub/flow/flow-contract";
import type { Tool, ToolType } from "../../reader/types";

export const AI_PEN_NOT_ON_PHONE =
  "The AI pen is not on the phone yet — Learn this book with AI is in the top bar";

// The lock holds a page still under a finger that is drawing. The phone has no
// pages to hold — it is one scroll, and the finger scrolls it — so the rack
// does not draw it here at all, and the Aa that opens the display sheet stands
// in its place on the bar (docs/70).
export const PHONE_OMITTED_TOOLS: readonly ToolType[] = ["navlock"];

/**
 * The rack's tool as the reflow pane understands it. The pane knows two states
 * — off, and the highlighter with a colour — so anything else the rack could be
 * in is off (the AI pen is dim and the lock is not drawn, so it cannot be in
 * either).
 */
export function flowTool(tool: Tool): FlowTool {
  return {
    type: tool.type === "highlight" ? "highlight" : "none",
    color: tool.color,
  };
}
