// Editing a diagram the reader is already looking at.
//
// This exists because of one exchange: "I still don't get it." The wrong answer
// is a second picture — now there are two, they do not line up, and the reader
// has to work out what changed. The right answer is to light up the one path
// they are stuck on, or to split what is already there into steps. Both are
// edits to the diagram on screen, which is what a patch is.
//
// Merge semantics are deliberately boring: nodes, edges, groups and notes merge
// by id (an id already present is replaced, a new one is appended), the scalar
// fields replace, and `focus`/`stages` accept null to clear. Nothing here
// re-lays-out anything or knows what a coordinate is.

import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode, DiagramPatch } from "./types";
import { withEdgeIds } from "./normalize";

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const out = [...existing];
  for (const item of incoming) {
    const at = out.findIndex((e) => e.id === item.id);
    if (at >= 0) out[at] = item;
    else out.push(item);
  }
  return out;
}

// Edges merge on their resolved id (normalize.edgeId), so an edge the model
// declared without an id is still addressable as "from->to" — which is the name
// it was told to use everywhere else.
function mergeEdges(diagram: Diagram, incoming: DiagramEdge[]): DiagramEdge[] {
  const current = withEdgeIds(diagram);
  const out = [...(diagram.edges ?? [])];
  for (const edge of incoming) {
    const id = edge.id ?? `${edge.from}->${edge.to}`;
    const at = current.findIndex((e) => e.id === id);
    if (at >= 0) out[at] = edge;
    else out.push(edge);
  }
  return out;
}

// Apply an edit. Pure: a new diagram out, the old one untouched. The result is
// still raw — the caller runs it back through normalizeDiagram, so a patch that
// adds an edge to a node it also removed is caught by the same pass that catches
// it on a fresh diagram, rather than by a second set of rules here.
export function applyDiagramPatch(diagram: Diagram, patch: DiagramPatch): Diagram {
  const removedNodes = new Set(patch.removeNodes ?? []);
  const removedEdges = new Set(patch.removeEdges ?? []);
  const removedGroups = new Set(patch.removeGroups ?? []);

  let nodes: DiagramNode[] = diagram.nodes.filter((n) => !removedNodes.has(n.id));
  if (patch.nodes) nodes = mergeById(nodes, patch.nodes);

  let edges = patch.edges ? mergeEdges(diagram, patch.edges) : [...(diagram.edges ?? [])];
  if (removedEdges.size > 0 || removedNodes.size > 0) {
    const ids = withEdgeIds({ ...diagram, edges });
    edges = edges.filter((e, i) => {
      if (removedEdges.has(ids[i]?.id ?? "")) return false;
      return !removedNodes.has(e.from) && !removedNodes.has(e.to);
    });
  }

  let groups: DiagramGroup[] = (diagram.groups ?? []).filter((g) => !removedGroups.has(g.id));
  if (patch.groups) groups = mergeById(groups, patch.groups);
  // A group loses any member that was just removed; a group left empty goes with
  // it, so a patch never leaves an empty frame floating in the picture.
  if (removedNodes.size > 0) {
    groups = groups
      .map((g) => ({ ...g, members: g.members.filter((m) => !removedNodes.has(m)) }))
      .filter((g) => g.members.length > 0);
  }

  const next: Diagram = {
    ...diagram,
    nodes,
    edges,
    groups,
    ...(patch.notes ? { notes: patch.notes } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.caption !== undefined ? { caption: patch.caption } : {}),
  };

  if (patch.focus !== undefined) {
    if (patch.focus === null) delete next.focus;
    else next.focus = patch.focus;
  }
  if (patch.stages !== undefined) {
    if (patch.stages === null) delete next.stages;
    else next.stages = patch.stages;
  }
  return next;
}

// A one-line account of what an edit did, for the tool to hand back to the
// model. Not cosmetic: without it the model cannot tell a patch that landed from
// one that was normalised away, and it re-sends the whole diagram.
export function describePatch(patch: DiagramPatch): string {
  const bits: string[] = [];
  if (patch.focus === null) bits.push("cleared the highlight");
  else if (patch.focus) bits.push("set the highlight");
  if (patch.stages === null) bits.push("dropped the stages");
  else if (patch.stages) bits.push(`set ${patch.stages.length} stages`);
  if (patch.nodes?.length) bits.push(`${patch.nodes.length} node(s) added or replaced`);
  if (patch.edges?.length) bits.push(`${patch.edges.length} edge(s) added or replaced`);
  if (patch.groups?.length) bits.push(`${patch.groups.length} group(s) added or replaced`);
  if (patch.removeNodes?.length) bits.push(`${patch.removeNodes.length} node(s) removed`);
  if (patch.removeEdges?.length) bits.push(`${patch.removeEdges.length} edge(s) removed`);
  if (patch.removeGroups?.length) bits.push(`${patch.removeGroups.length} group(s) removed`);
  if (patch.title !== undefined) bits.push("retitled");
  if (patch.caption !== undefined) bits.push("recaptioned");
  return bits.length ? bits.join(", ") : "nothing";
}
