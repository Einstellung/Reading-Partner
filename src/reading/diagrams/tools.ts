// The two tools the model draws with.
//
// draw_diagram puts a picture in the conversation; update_diagram edits the one
// already there. The second is not a convenience — it is the whole reason the
// focus and stage machinery exists. When the reader says they still do not
// follow, sending a second picture makes them diff two diagrams; lighting up one
// path in the picture they are already looking at does not.
//
// The schema is flat strings rather than nested unions of literals, and every
// closed vocabulary is enforced in normalize.ts instead. Providers disagree most
// about anyOf/enum in tool schemas, and an invented shape name should cost a
// default and a line of feedback, not a rejected call in the middle of a lesson.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import { normalizeDiagram } from "./normalize";
import { applyDiagramPatch, describePatch } from "./patch";
import type { Diagram, DiagramPatch } from "./types";

export interface DiagramToolDeps {
  // Put a diagram in the conversation and return the id it can be edited by.
  draw(diagram: Diagram): string;
  // The diagram behind an id as it now stands, or null when there is none.
  read(id: string): Diagram | null;
  // Replace the diagram behind an id, in place.
  update(id: string, diagram: Diagram): void;
}

// The DSL as a tool schema. Written once and shared by both tools, so a field
// the model may set when drawing is a field it may set when editing.
const NODE = Type.Object({
  id: Type.String({ description: "Short unique slug. Edges, groups and highlights address the node by it." }),
  label: Type.String({ description: "One short phrase. Not a sentence; it is wrapped and boxed automatically." }),
  sub: Type.Optional(Type.String({ description: 'A dimmer second line: a tensor shape, a type, a count. e.g. "[B, T, C]".' })),
  shape: Type.Optional(
    Type.String({ description: 'box (default) | round | pill (start/end) | diamond (a decision) | cylinder (a store) | note.' }),
  ),
  tone: Type.Optional(
    Type.String({ description: "default | primary (the one to look at) | muted (background) | warn." }),
  ),
});

const EDGE = Type.Object({
  from: Type.String({ description: "Source node id." }),
  to: Type.String({ description: "Target node id." }),
  id: Type.Optional(Type.String({ description: 'Optional handle. Defaults to "from->to", which is what highlights and stages should use.' })),
  label: Type.Optional(Type.String({ description: "A word or two on the arrow." })),
  kind: Type.Optional(Type.String({ description: "solid (default) | dashed | thick." })),
  arrow: Type.Optional(Type.String({ description: "to (default) | both | none." })),
});

const GROUP = Type.Object({
  id: Type.String(),
  members: Type.Array(Type.String(), {
    description:
      "Node ids in a flow/stack/tree. In a stack this is one band, and every node must be in one. In a sequence these are EDGE ids, and the frame covers those message rows.",
  }),
  label: Type.Optional(Type.String({ description: "Printed on the frame." })),
  repeat: Type.Optional(Type.String({ description: 'Printed on the frame\'s corner: "× 6". How a repeated block is drawn once.' })),
  parent: Type.Optional(Type.String({ description: "Enclosing group id, for one level of nesting." })),
});

const NOTE = Type.Object({
  attach: Type.String({ description: "The node, edge or group id this hangs off." }),
  text: Type.String(),
  side: Type.Optional(Type.String({ description: "left | right (default)." })),
});

const FOCUS = Type.Object({
  path: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "A walk through the graph, as node ids in order. The edges between consecutive ids are lit automatically. This is the form to reach for.",
    }),
  ),
  nodes: Type.Optional(Type.Array(Type.String(), { description: "Extra node ids to keep lit." })),
  edges: Type.Optional(Type.Array(Type.String(), { description: "Extra edge ids to keep lit." })),
  label: Type.Optional(Type.String({ description: "One line under the picture saying what is lit." })),
});

const STAGE = Type.Object({
  title: Type.String({ description: "The step's name, on the stepper." }),
  caption: Type.Optional(Type.String({ description: "One line under the picture for this step." })),
  nodes: Type.Optional(Type.Array(Type.String(), { description: "Node ids this step introduces. Cumulative: earlier steps stay." })),
  edges: Type.Optional(Type.Array(Type.String(), { description: "Edge ids this step introduces." })),
  focus: Type.Optional(FOCUS),
});

const DIAGRAM = Type.Object({
  layout: Type.String({
    description:
      "flow (a directed graph in ranks — block diagram, data path, flowchart; the default and usually right) | stack (horizontal bands, one per group, for a layer cake; edges that skip a band draw as a rail down the side, which is how a residual connection looks) | sequence (lifelines and time-ordered messages; `nodes` are the participants and the order of `edges` is the order in time) | tree (a hierarchy).",
  }),
  nodes: Type.Array(NODE),
  title: Type.Optional(Type.String()),
  direction: Type.Optional(
    Type.String({
      description:
        'down (default) | right | up. Prefer "down" — a chat column is narrow, and a "right" flow with more than about five steps has to be scrolled sideways. "up" only means anything for a stack, where it puts the first band at the bottom.',
    }),
  ),
  edges: Type.Optional(Type.Array(EDGE)),
  groups: Type.Optional(Type.Array(GROUP)),
  notes: Type.Optional(Type.Array(NOTE)),
  focus: Type.Optional(FOCUS),
  stages: Type.Optional(Type.Array(STAGE, { description: "Two or more steps that build the diagram up. Omit for a diagram shown whole." })),
  source: Type.Optional(
    Type.Object({
      figure: Type.Optional(Type.String({ description: 'The figure this redraws, as its catalog id — "3" for [fig:3]. Set it whenever you are simplifying a figure from the book.' })),
      page: Type.Optional(Type.Number({ description: "1-based page in the current document." })),
    }),
  ),
  caption: Type.Optional(Type.String({ description: "One line under the picture: what to look at, not what it is." })),
});

// What came back to the model after a draw or an edit. Every repair is reported:
// a model that is not told its edge was dropped draws the same broken edge next
// time, and a model that is told fixes it in one turn.
function report(head: string, problems: string[]): string {
  if (problems.length === 0) return head;
  return `${head}\n\nAdjusted on the way in:\n${problems.map((p) => `- ${p}`).join("\n")}`;
}

export function buildDiagramTools(deps: DiagramToolDeps): AgentTool[] {
  return [
    {
      name: "draw_diagram",
      description:
        "Draw a structure diagram in the conversation: parts and how they connect, a flow, an order of messages, a hierarchy. " +
        "You describe the structure; the layout, sizing and line routing are computed, so never give coordinates and never write SVG. " +
        "Reach for this when a dense figure in the book needs redrawing simply, or when what you are explaining is a shape rather than a fact. " +
        "Two things make it worth more than prose: `focus`, which lights one path and dims the rest, and `stages`, which builds the same picture up in steps. " +
        "Do not draw a definition, a comparison or a list — prose or a Markdown table is faster to read.",
      parameters: Type.Object({ diagram: DIAGRAM }),
      execute: async (args) => {
        const { diagram, problems } = normalizeDiagram(args.diagram);
        if (diagram.nodes.length === 0) {
          return report("Nothing was drawn: the diagram had no usable nodes.", problems);
        }
        const id = deps.draw(diagram);
        const staged = diagram.stages?.length
          ? ` It has ${diagram.stages.length} stages and the reader can step through them.`
          : "";
        return report(
          `The diagram is now shown to the reader (id "${id}").${staged} ` +
            `To change it — to light up one path, to break it into stages, to add a part — call update_diagram with diagram_id "${id}". ` +
            `Do not call draw_diagram again for the same picture.`,
          problems,
        );
      },
    },
    {
      name: "update_diagram",
      description:
        "Change a diagram already on screen, in place. This is what to use when the reader says they still do not follow: " +
        "set `focus.path` to the one path they are stuck on and everything else dims, or set `stages` to build the same picture up in steps. " +
        "Also takes added or replaced nodes, edges and groups. Everything omitted is left alone. " +
        "Always prefer this to drawing a second diagram of the same thing.",
      parameters: Type.Object({
        diagram_id: Type.String({ description: "The id draw_diagram returned." }),
        focus: Type.Optional(FOCUS),
        clear_focus: Type.Optional(
          Type.Boolean({ description: "Put every part back at full strength and drop the highlight." }),
        ),
        stages: Type.Optional(Type.Array(STAGE)),
        clear_stages: Type.Optional(
          Type.Boolean({ description: "Drop the stepper and show the whole diagram at once." }),
        ),
        nodes: Type.Optional(Type.Array(NODE, { description: "Added, or replaced when the id already exists." })),
        edges: Type.Optional(Type.Array(EDGE)),
        groups: Type.Optional(Type.Array(GROUP)),
        notes: Type.Optional(Type.Array(NOTE, { description: "Replaces the whole set of notes." })),
        remove_nodes: Type.Optional(Type.Array(Type.String())),
        remove_edges: Type.Optional(Type.Array(Type.String())),
        remove_groups: Type.Optional(Type.Array(Type.String())),
        title: Type.Optional(Type.String()),
        caption: Type.Optional(Type.String()),
      }),
      execute: async (args) => {
        const id = String(args.diagram_id ?? "");
        const current = deps.read(id);
        if (!current) {
          return `No diagram "${id}" in this conversation. Draw one with draw_diagram first, and use the id it returns.`;
        }
        const patch: DiagramPatch = {
          ...(args.clear_focus ? { focus: null } : args.focus ? { focus: args.focus as DiagramPatch["focus"] } : {}),
          ...(args.clear_stages
            ? { stages: null }
            : args.stages
              ? { stages: args.stages as DiagramPatch["stages"] }
              : {}),
          ...(args.nodes ? { nodes: args.nodes as DiagramPatch["nodes"] } : {}),
          ...(args.edges ? { edges: args.edges as DiagramPatch["edges"] } : {}),
          ...(args.groups ? { groups: args.groups as DiagramPatch["groups"] } : {}),
          ...(args.notes ? { notes: args.notes as DiagramPatch["notes"] } : {}),
          ...(args.remove_nodes ? { removeNodes: (args.remove_nodes as string[]).map(String) } : {}),
          ...(args.remove_edges ? { removeEdges: (args.remove_edges as string[]).map(String) } : {}),
          ...(args.remove_groups ? { removeGroups: (args.remove_groups as string[]).map(String) } : {}),
          ...(typeof args.title === "string" ? { title: args.title } : {}),
          ...(typeof args.caption === "string" ? { caption: args.caption } : {}),
        };
        const what = describePatch(patch);
        if (what === "nothing") return `Nothing to change on diagram "${id}".`;
        // Back through the same pass a fresh diagram takes, so an edit cannot
        // reach the reader by a route that skips the checks.
        const { diagram, problems } = normalizeDiagram(applyDiagramPatch(current, patch));
        if (diagram.nodes.length === 0) {
          return report(`That edit would have emptied diagram "${id}", so it was not applied.`, problems);
        }
        deps.update(id, diagram);
        return report(`Diagram "${id}" updated: ${what}. The reader sees the change on the same picture.`, problems);
      },
    },
  ];
}
