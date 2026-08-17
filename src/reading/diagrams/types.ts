// The diagram DSL: what the model is allowed to say about a picture.
//
// Why a DSL and not SVG. A model asked for SVG writes overlapping boxes and
// text that runs out of them, and a diffusion model asked for "the same figure
// but simpler" misspells every label. So the model describes *structure* —
// which parts exist, what connects to what — and this directory computes the
// geometry (layout.ts) and draws it (svg.ts). Nothing in this file carries a
// coordinate; nothing the model writes can put two boxes on top of each other.
//
// The two shapes that are the point. A dense architecture figure explained in
// prose is what the reader could not follow in the first place, so:
//   - `focus` takes one path through the structure and dims everything else,
//     which is what "just draw the QKV line on its own" means; and
//   - `stages` walks the same structure in steps, each adding a little.
// Both are *views* over one node/edge set, never a second diagram. Layout runs
// once over everything, so the boxes do not move between stages or when the
// focus changes — the reader is watching one picture, not a slideshow of
// several. That is the whole reason focus and stages are declared here rather
// than by sending another diagram.

// How the nodes are arranged. Layout, not decoration: each one is a different
// algorithm in layout.ts.
//   flow     a directed graph in ranks — block diagram, data path, flowchart.
//            The workhorse; when in doubt this is the one.
//   stack    horizontal bands, one per group, in group order — a layer cake.
//            Edges between non-adjacent bands ride a rail down the side, which
//            is how a residual/skip connection draws.
//   sequence lifelines with time-ordered messages between them. `nodes` are the
//            participants; the order of `edges` is the order in time.
//   tree     a hierarchy, parents centred over their children.
export type DiagramLayout = "flow" | "stack" | "sequence" | "tree";

// Which way the diagram grows. flow and tree take "down" or "right"; stack takes
// "down" (first band on top) or "up" (first band at the bottom, the way an
// architecture figure is usually drawn); sequence ignores it.
export type DiagramDirection = "down" | "up" | "right";

// The outline of a node. Shape carries meaning in a flowchart and nothing
// elsewhere; the layout gives a diamond extra room because its corners eat it.
export type DiagramShape = "box" | "round" | "pill" | "diamond" | "cylinder" | "note";

// A node's colour role. Not a colour: the palette lives in svg.ts and follows
// the app's tokens, so a diagram stays legible if the palette changes.
export type DiagramTone = "default" | "primary" | "muted" | "warn";

export type DiagramEdgeKind = "solid" | "dashed" | "thick";
export type DiagramArrow = "to" | "both" | "none";

export interface DiagramNode {
  // Unique within the diagram. Edges, groups, focus and stages all address a
  // node by this, so a short slug ("q", "softmax") beats a number.
  id: string;
  // The label, one short phrase. Wrapped by the layout — never pre-broken with
  // newlines, and never a sentence: a node that needs a sentence wants a note.
  label: string;
  // A dimmer second line under the label: a tensor shape, a type, a count.
  sub?: string;
  shape?: DiagramShape;
  tone?: DiagramTone;
}

export interface DiagramEdge {
  // Optional, but the handle focus/stages/groups use to name this edge. Without
  // one it gets `${from}->${to}` (and a suffix when that repeats).
  id?: string;
  from: string;
  to: string;
  // A word or two on the arrow ("scaled dot-product", "×3"). Boxed so it stays
  // readable where it crosses a line.
  label?: string;
  kind?: DiagramEdgeKind;
  arrow?: DiagramArrow;
}

export interface DiagramGroup {
  id: string;
  // Drawn on the frame. A group with no label is just a box around things.
  label?: string;
  // The members. Node ids in flow / stack / tree; edge ids in sequence, where a
  // group frames the message rows it names ("repeat until converged").
  members: string[];
  // One level of nesting is enough for "the encoder block, inside the encoder".
  // A parent chain that loops is broken by validation.
  parent?: string;
  // Printed on the frame's corner: "× N", "×6 layers". The way a repeated block
  // is drawn once instead of six times.
  repeat?: string;
}

export interface DiagramNote {
  // What it points at: a node id, a group id or an edge id.
  attach: string;
  text: string;
  side?: "left" | "right";
}

// One path through the structure, kept lit while everything else dims. The
// answer to "I still don't follow — show me just that bit".
export interface DiagramFocus {
  // A walk through the graph. The edges between consecutive ids are resolved
  // here, so tracing a path is three node ids and not six edge ids. This is the
  // form to reach for.
  path?: string[];
  // Anything extra to keep lit that is not on the path.
  nodes?: string[];
  edges?: string[];
  // One line saying what is lit, shown under the diagram.
  label?: string;
}

// One step of a build-up. Cumulative: a stage shows everything it names plus
// everything the stages before it named. What it does not name yet is drawn as
// a ghost, so the reader can see the room being left for it and the picture
// never jumps.
export interface DiagramStage {
  // The step's name, on the stepper control.
  title: string;
  // One line under the diagram for this step.
  caption?: string;
  nodes?: string[];
  edges?: string[];
  // A highlight within this step, dimming what earlier stages introduced.
  focus?: DiagramFocus;
}

// Where the diagram came from, so the card can say "redrawn from Figure 1" and
// link back to the page. A redrawn figure must set this: the reader has to be
// able to check the simplification against the original.
export interface DiagramSource {
  // A figure id from the document's catalog, as in [fig:N].
  figure?: string;
  // 1-based page in the current document.
  page?: number;
}

export interface Diagram {
  // Bumped when a stored diagram's shape changes. Persisted, so a card written
  // by an older build says which shape it is.
  v: 1;
  layout: DiagramLayout;
  title?: string;
  direction?: DiagramDirection;
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
  groups?: DiagramGroup[];
  notes?: DiagramNote[];
  // The static highlight, for a diagram with no stages. Ignored when `stages`
  // is set — each stage carries its own.
  focus?: DiagramFocus;
  stages?: DiagramStage[];
  source?: DiagramSource;
  // One line under the picture: what to look at, not what it is.
  caption?: string;
}

export const DIAGRAM_VERSION = 1 as const;

// An edit to a diagram already on screen. The reason it exists: when the reader
// says they still do not follow, the fix is to light up one path or split the
// picture into steps — not to send a second picture they now have to line up
// against the first. Every field is optional and absent means "leave it".
export interface DiagramPatch {
  title?: string;
  caption?: string;
  // null clears the highlight and puts everything back at full strength.
  focus?: DiagramFocus | null;
  // null drops the stages and shows the whole diagram at once.
  stages?: DiagramStage[] | null;
  // Added, or replaced in place when the id already exists. Position is not
  // preserved across a replace — layout is recomputed either way.
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
  groups?: DiagramGroup[];
  notes?: DiagramNote[];
  removeNodes?: string[];
  removeEdges?: string[];
  removeGroups?: string[];
}
