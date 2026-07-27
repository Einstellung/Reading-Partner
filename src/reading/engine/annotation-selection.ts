// Which engine emissions count as a change of the selected annotation, and what
// each of them is allowed to do to the annotation editor. Pure and DOM-free so
// the rule is one readable table instead of a condition buried in two .tsx
// files: the editor is the one piece of reader UI that opens itself, and the way
// it goes wrong is always an emission nobody meant as a selection.
//
// The engine's annotation plugin publishes ONE state stream for everything it
// holds — the active tool, the annotations, the selection — so switching tools
// or writing an annotation re-delivers the selection that was already there,
// unchanged. Passing those on made a tool switch open the editor over the middle
// of the page for an annotation nobody had touched.

// Drawing is not selecting. The plugin selects whatever it has just created
// unless this says otherwise, and that default is behind two things the reader
// never asked for: the editor opening over the page the moment a stroke ends,
// and the fresh mark left selected — handles up, page claimed by the selection
// activity — until something else is tapped. A mark is selected by being tapped.
//
// Passed explicitly because the default is true and reads as false: the plugin's
// own type declares "When true (default false)", while the manifest and the tool
// merge both fall back to true (docs/pitfall/60).
//
// Nothing downstream needs the new annotation selected: the host learns about it
// from the create event (onSaveAnnotations), which is also where the AI pen picks
// up the id for its thread. The one visible consequence is that a just-drawn mark
// is no longer the highlighted row in the trace list.
//
// With it off, a create emits the plugin state with its selection array
// untouched, which `selectionChanged` below already reads as nothing to say.
export const SELECT_AFTER_CREATE = false;

// Whether an emission carries a selection that actually moved.
//
// The identity of the plugin's own id array is what tells the two cases apart: a
// state change that leaves the selection alone hands back the same array, while
// every selection dispatch builds a new one — including re-selecting what is
// already selected, which is a real event (tapping a mark whose editor you just
// dismissed has to bring it back). Comparing the ids instead would swallow that.
//
// `prev` is null before the first emission. Nothing selected then and nothing
// selected now is not worth saying.
export function selectionChanged(prev: readonly string[] | null, next: readonly string[]): boolean {
  if (prev === next) return false;
  if ((prev?.length ?? 0) === 0 && next.length === 0) return false;
  return true;
}

// What one selection emission does to the annotation editor.
//   "open"   — an annotation is selected: show the editor on it.
//   "close"  — nothing is selected any more: take the editor away.
//   "ignore" — leave the editor exactly as it is, pending fallback included.
export type PopupEffect = "open" | "close" | "ignore";

// Changing the tool is not a selection event, and it is the one moment the
// engine speaks without being asked: `setActiveTool` republishes the plugin
// state synchronously, inside the host's own setTool call. Whatever comes out of
// that window says nothing about what the reader selected, so it may neither
// open the editor nor close one already open.
export function popupEffect(selectedId: string | null, duringToolChange: boolean): PopupEffect {
  if (duringToolChange) return "ignore";
  return selectedId === null ? "close" : "open";
}
