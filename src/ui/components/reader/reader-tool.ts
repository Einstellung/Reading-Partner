// The rack's tool as the reader view takes it. The AI pen is the underline tool
// in a fixed purple; the other pens draw in the picked color.

import type { Tool } from "../../../platform/app/reader-contract";
import { AI_PEN_COLOR } from "../../../reading/session/use-marks";
import type { ToolType } from "./types";

export function readerTool(toolType: ToolType, penColor: string): Tool {
  if (toolType === "none") return { type: "pointer" };
  if (toolType === "navlock") return { type: "navlock" };
  if (toolType === "ai") return { type: "underline", color: AI_PEN_COLOR };
  return { type: toolType, color: penColor };
}
