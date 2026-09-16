// What the phone's reader will not do yet, and the one sentence each control
// says about it (docs/69).
//
// The AI is not on this shell: there is no book thread, no classroom and no
// pen that opens one. Both controls are still drawn — the phone is one of the
// reading forms, and the rule has to be legible where the reader would reach
// for it — so what is needed here is the reason, not an absence.

import type { FlowTool } from "../../../reading/epub/flow-contract";
import type { Tool } from "../reader/types";

export const AI_NOT_ON_PHONE = "The AI does not read with you on the phone yet";
// The lock holds a page still under a finger that is drawing. The phone has no
// pages to hold: it is one scroll, and the finger scrolls it.
export const NO_PAGES_TO_LOCK = "There are no pages to lock on the phone";

/**
 * The rack's tool as the reflow pane understands it. The pane knows two states
 * — off, and the highlighter with a colour — so anything else the rack could be
 * in is off (the AI pen and the lock are dim, so it cannot be in those).
 */
export function flowTool(tool: Tool): FlowTool {
  return {
    type: tool.type === "highlight" ? "highlight" : "none",
    color: tool.color,
  };
}
