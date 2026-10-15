// The rack's tool as the reader view takes it. The AI pen is the underline tool
// in a fixed purple; the highlighter is always yellow.

import { HIGHLIGHT_COLOR } from "../../../platform/app/annotations";
import type { Tool } from "../../../platform/app/reader-contract";
import { AI_PEN_COLOR } from "../../../reading/session/use-marks";
import type { ReaderMode } from "../../../reading/issue";
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
//
// A brief (docs/info/88) has no conversation of the reader's own to start, so
// its rack has no AI pen either; the highlighter stays.
export function rackOmits(touchInput: boolean, mode: ReaderMode = "book"): readonly ToolType[] {
  const omit: ToolType[] = touchInput ? [] : ["navlock"];
  if (mode === "issue") omit.push("ai");
  return omit;
}

export function hasTouchInput(win: Pick<Window, "matchMedia"> | undefined): boolean {
  return win?.matchMedia?.("(any-pointer: coarse)").matches ?? false;
}
