// The rack's tool as the reader view takes it. The AI pen is the underline tool
// in a fixed purple; the highlighter is always yellow.

import { HIGHLIGHT_COLOR } from "../../../platform/app/annotations";
import type { Tool } from "../../../platform/app/reader-contract";
import { AI_PEN_COLOR } from "../../../reading/session/use-marks";
import type { ToolType } from "./types";

export function readerTool(toolType: ToolType): Tool {
  if (toolType === "none") return { type: "pointer" };
  if (toolType === "navlock") return { type: "navlock" };
  if (toolType === "ai") return { type: "underline", color: AI_PEN_COLOR };
  return { type: toolType, color: HIGHLIGHT_COLOR };
}

// The navigation lock lets a stylus scroll without marking (docs/09). With no
// touch input there is no stylus to lock: a mouse marks only with a tool in
// hand and moves the page with the wheel, so the desktop rack leaves it out.
// Read off the pointers the device has, not its operating system: an iPad with
// a trackpad still has its touch screen, and a touch laptop keeps the lock.
export function rackOmits(touchInput: boolean): readonly ToolType[] {
  return touchInput ? [] : ["navlock"];
}

export function hasTouchInput(win: Pick<Window, "matchMedia"> | undefined): boolean {
  return win?.matchMedia?.("(any-pointer: coarse)").matches ?? false;
}
