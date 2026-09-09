// What a pointer landing on an EPUB means: draw on the book, or move it.
//
// The rule is the PDF side's rule (engine/gesture/touch-routing.ts), imported
// rather than restated — the reader's "draw with your finger" setting has to
// mean the same thing whichever format is open, and two copies of a routing
// table drift. What is new here is only the top of it: an EPUB has no page to
// put ink on, so the tool rack's third pen draws nothing.

import type { Tool } from "../../platform/app/reader-contract";
import { pointerKindOf, routePointer, toolKindOf } from "../engine/gesture/touch-routing";

export type EpubStroke = "highlight" | "underline";

/**
 * The stroke the active tool draws on an EPUB, or null when it draws none.
 *
 * Ink is the one tool with no answer here. A free path is anchored to a page's
 * coordinates, and an EPUB has no page: the same passage is at a different
 * place at every type size and in every window (docs/39 §5). The tool stays in
 * the rack — the reader may have a PDF open next — and does nothing.
 */
export function strokeOfTool(tool: Tool | undefined): EpubStroke | null {
  if (!tool) return null;
  if (tool.type === "highlight") return "highlight";
  // The AI pen arrives as the underline tool in a fixed purple; the shell tells
  // the two apart by the thread it hangs off the mark, not by the stroke.
  if (tool.type === "underline") return "underline";
  return null;
}

export type EpubPointerAction = "draw" | "navigate";

/**
 * What one pointer does. "draw" drags a selection out of the text and leaves a
 * mark where it lands; "navigate" is everything else the pane already does with
 * a pointer — turn the page, scroll, tap a mark.
 *
 * The navigation lock answers "navigate" for every device including the stylus,
 * which is what the lock is for.
 */
export function routeEpubPointer(
  tool: Tool | undefined,
  pointerType: string,
  fingerDraw: boolean,
): EpubPointerAction {
  const kind = toolKindOf(tool?.type);
  if (kind === "navlock") return "navigate";
  if (!strokeOfTool(tool)) return "navigate";
  return routePointer("annotate", pointerKindOf(pointerType), fingerDraw) === "draw"
    ? "draw"
    : "navigate";
}

/**
 * Whether a selection the reader made by hand — the system's own long-press and
 * handles, which are the only selection gesture inside the frame — should
 * become a mark when the pointer lifts. It should exactly when a pen is out:
 * with none, a selection is a selection.
 */
export function selectionMarks(tool: Tool | undefined): boolean {
  return strokeOfTool(tool) !== null;
}
