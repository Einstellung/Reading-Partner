// Turning what the model sent into a diagram that can be drawn, and telling it
// what it got wrong.
//
// The model will refer to a node it never declared, reuse an id, point a group
// at a member that is not there, and write a label the length of a paragraph.
// None of that may reach the layout — a dangling edge is a line to nowhere and a
// duplicate id silently loses a box. So every diagram goes through here first:
// what can be repaired is repaired, what cannot is dropped, and every repair is
// reported back to the model in the tool result so the next call is better. The
// reader never sees a broken picture and the model never has to guess why.
//
// Repair, not rejection. A diagram with one bad edge out of nine is worth
// drawing without that edge; refusing the whole thing would put the model in a
// retry loop while the reader waits.

import type {
  Diagram,
  DiagramEdge,
  DiagramFocus,
  DiagramGroup,
  DiagramNode,
  DiagramNote,
  DiagramStage,
} from "./types";
import { DIAGRAM_VERSION } from "./types";

// A label past this is prose. Clipped rather than dropped: the reader gets the
// beginning, and the model is told to move it into a note.
const MAX_LABEL = 60;
const MAX_SUB = 32;
const MAX_EDGE_LABEL = 40;
const MAX_NOTE = 120;
// Past this a picture is not a simplification of anything. The cap is on what
// gets drawn, and the overflow is reported so the model can split the diagram or
// stage it instead.
const MAX_NODES = 40;
const MAX_EDGES = 60;
const MAX_STAGES = 8;

export interface NormalizeResult {
  diagram: Diagram;
  // What was repaired, in the model's words. Empty when the input was clean.
  problems: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// The closed vocabularies. They are checked here rather than in the tool's JSON
// schema on purpose: a schema of nested unions is what providers disagree about
// most, and an invented value should cost a default and a note, not a rejected
// tool call in the middle of a lesson.
const SHAPES = ["box", "round", "pill", "diamond", "cylinder", "note"] as const;
const TONES = ["default", "primary", "muted", "warn"] as const;
const EDGE_KINDS = ["solid", "dashed", "thick"] as const;
const ARROWS = ["to", "both", "none"] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const v = str(value);
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

// The id an edge is addressed by. An explicit one wins; otherwise "from->to",
// suffixed when a pair repeats so two edges between the same nodes stay
// separately addressable by focus and stages.
export function edgeId(edge: DiagramEdge, taken: Set<string>): string {
  const base = str(edge.id) || `${edge.from}->${edge.to}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}#${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Every edge with its resolved id, in order. The one place that answers "what is
// this edge called", so focus, stages, groups and the drawing all agree.
export function withEdgeIds(diagram: Diagram): { id: string; edge: DiagramEdge }[] {
  const taken = new Set<string>();
  const out: { id: string; edge: DiagramEdge }[] = [];
  for (const edge of diagram.edges ?? []) {
    const id = edgeId(edge, taken);
    taken.add(id);
    out.push({ id, edge });
  }
  return out;
}

function normalizeNodes(input: unknown, problems: string[]): DiagramNode[] {
  const raw = arr<Partial<DiagramNode>>(input);
  const seen = new Set<string>();
  const out: DiagramNode[] = [];
  for (const n of raw) {
    const id = str(n?.id);
    if (!id) {
      problems.push("A node had no id and was dropped.");
      continue;
    }
    if (seen.has(id)) {
      problems.push(`Two nodes share the id "${id}"; the second was dropped.`);
      continue;
    }
    const label = str(n?.label) || id;
    if (label.length > MAX_LABEL) {
      problems.push(
        `Node "${id}" has a ${label.length}-character label; it was clipped. A node label is a phrase — put the sentence in a note instead.`,
      );
    }
    const shape = oneOf(n?.shape, SHAPES);
    const tone = oneOf(n?.tone, TONES);
    if (n?.shape && !shape) problems.push(`Node "${id}" asked for shape "${String(n.shape)}"; drew a box.`);
    if (n?.tone && !tone) problems.push(`Node "${id}" asked for tone "${String(n.tone)}"; drew it plain.`);
    seen.add(id);
    out.push({
      id,
      label: clip(label, MAX_LABEL),
      ...(str(n?.sub) ? { sub: clip(str(n.sub), MAX_SUB) } : {}),
      ...(shape ? { shape } : {}),
      ...(tone ? { tone } : {}),
    });
  }
  if (out.length > MAX_NODES) {
    problems.push(
      `${out.length} nodes is past the ${MAX_NODES} this can draw legibly; the rest were dropped. Split the diagram, or use stages.`,
    );
    return out.slice(0, MAX_NODES);
  }
  return out;
}

function normalizeEdges(input: unknown, ids: Set<string>, problems: string[]): DiagramEdge[] {
  const raw = arr<Partial<DiagramEdge>>(input);
  const out: DiagramEdge[] = [];
  for (const e of raw) {
    const from = str(e?.from);
    const to = str(e?.to);
    if (!ids.has(from) || !ids.has(to)) {
      const missing = !ids.has(from) ? from || "(empty)" : to || "(empty)";
      problems.push(
        `Edge ${from || "?"} -> ${to || "?"} names "${missing}", which is not a node in this diagram; the edge was dropped.`,
      );
      continue;
    }
    const kind = oneOf(e?.kind, EDGE_KINDS);
    const arrow = oneOf(e?.arrow, ARROWS);
    out.push({
      ...(str(e?.id) ? { id: str(e.id) } : {}),
      from,
      to,
      ...(str(e?.label) ? { label: clip(str(e.label), MAX_EDGE_LABEL) } : {}),
      ...(kind ? { kind } : {}),
      ...(arrow ? { arrow } : {}),
    });
  }
  if (out.length > MAX_EDGES) {
    problems.push(`${out.length} edges is past the ${MAX_EDGES} this can draw; the rest were dropped.`);
    return out.slice(0, MAX_EDGES);
  }
  return out;
}

// Groups keep only the members that exist, and a parent chain that loops is
// broken at the loop rather than hanging the bounding-box pass.
function normalizeGroups(
  input: unknown,
  known: Set<string>,
  problems: string[],
): DiagramGroup[] {
  const raw = arr<Partial<DiagramGroup>>(input);
  const seen = new Set<string>();
  const out: DiagramGroup[] = [];
  for (const g of raw) {
    const id = str(g?.id);
    if (!id) {
      problems.push("A group had no id and was dropped.");
      continue;
    }
    if (seen.has(id)) {
      problems.push(`Two groups share the id "${id}"; the second was dropped.`);
      continue;
    }
    const members = arr<unknown>(g?.members).map(str).filter(Boolean);
    const kept = members.filter((m) => known.has(m));
    if (kept.length !== members.length) {
      const lost = members.filter((m) => !known.has(m));
      problems.push(`Group "${id}" names ${lost.join(", ")}, which are not in this diagram.`);
    }
    if (kept.length === 0) {
      problems.push(`Group "${id}" has no members that exist; it was dropped.`);
      continue;
    }
    seen.add(id);
    out.push({
      id,
      members: kept,
      ...(str(g?.label) ? { label: clip(str(g.label), MAX_LABEL) } : {}),
      ...(str(g?.repeat) ? { repeat: clip(str(g.repeat), 16) } : {}),
      ...(str(g?.parent) ? { parent: str(g.parent) } : {}),
    });
  }
  // A parent that does not exist, or a cycle, becomes no parent at all.
  const byId = new Map(out.map((g) => [g.id, g]));
  for (const g of out) {
    if (!g.parent) continue;
    if (!byId.has(g.parent)) {
      problems.push(`Group "${g.id}" has parent "${g.parent}", which is not a group; ignored.`);
      delete g.parent;
      continue;
    }
    const walked = new Set<string>([g.id]);
    let cursor = byId.get(g.parent);
    while (cursor) {
      if (walked.has(cursor.id)) {
        problems.push(`Groups ${[...walked].join(" -> ")} nest in a loop; the parent was ignored.`);
        delete g.parent;
        break;
      }
      walked.add(cursor.id);
      cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    }
  }
  return out;
}

function normalizeFocus(
  input: unknown,
  nodes: Set<string>,
  edges: Set<string>,
  where: string,
  problems: string[],
): DiagramFocus | undefined {
  if (!input || typeof input !== "object") return undefined;
  const f = input as Partial<DiagramFocus>;
  const keep = (list: unknown, pool: Set<string>, what: string): string[] => {
    const given = arr<unknown>(list).map(str).filter(Boolean);
    const kept = given.filter((id) => pool.has(id));
    if (kept.length !== given.length) {
      problems.push(
        `${where} highlights ${what} ${given.filter((id) => !pool.has(id)).join(", ")}, which are not in this diagram.`,
      );
    }
    return kept;
  };
  const path = keep(f.path, nodes, "nodes");
  const nodeIds = keep(f.nodes, nodes, "nodes");
  const edgeIds = keep(f.edges, edges, "edges");
  const label = str(f.label);
  if (path.length === 0 && nodeIds.length === 0 && edgeIds.length === 0) {
    if (f.path || f.nodes || f.edges) {
      problems.push(`${where} highlights nothing that exists; the highlight was dropped.`);
    }
    return undefined;
  }
  return {
    ...(path.length ? { path } : {}),
    ...(nodeIds.length ? { nodes: nodeIds } : {}),
    ...(edgeIds.length ? { edges: edgeIds } : {}),
    ...(label ? { label: clip(label, MAX_NOTE) } : {}),
  };
}

function normalizeStages(
  input: unknown,
  nodes: Set<string>,
  edges: Set<string>,
  problems: string[],
): DiagramStage[] | undefined {
  const raw = arr<Partial<DiagramStage>>(input);
  if (raw.length === 0) return undefined;
  const out: DiagramStage[] = [];
  raw.slice(0, MAX_STAGES).forEach((s, i) => {
    const where = `Stage ${i + 1}`;
    const keep = (list: unknown, pool: Set<string>): string[] =>
      arr<unknown>(list).map(str).filter((id) => id !== "" && pool.has(id));
    out.push({
      title: clip(str(s?.title) || `Step ${i + 1}`, 28),
      ...(str(s?.caption) ? { caption: clip(str(s.caption), MAX_NOTE) } : {}),
      nodes: keep(s?.nodes, nodes),
      edges: keep(s?.edges, edges),
      ...(() => {
        const f = normalizeFocus(s?.focus, nodes, edges, where, problems);
        return f ? { focus: f } : {};
      })(),
    });
  });
  if (raw.length > MAX_STAGES) {
    problems.push(`${raw.length} stages is more than the ${MAX_STAGES} the stepper shows; the rest were dropped.`);
  }
  // A single stage is a diagram with a stepper that does nothing.
  if (out.length === 1) {
    problems.push("One stage is not a build-up; it was dropped and the whole diagram is shown.");
    return undefined;
  }
  // The last stage has to end up showing everything, or the reader is left with
  // a picture that never completed. Anything never named is added to it.
  const named = new Set<string>();
  for (const s of out) {
    for (const id of s.nodes ?? []) named.add(id);
    for (const id of s.edges ?? []) named.add(id);
  }
  const missingNodes = [...nodes].filter((id) => !named.has(id));
  const missingEdges = [...edges].filter((id) => !named.has(id));
  if (missingNodes.length || missingEdges.length) {
    const last = out[out.length - 1];
    last.nodes = [...(last.nodes ?? []), ...missingNodes];
    last.edges = [...(last.edges ?? []), ...missingEdges];
  }
  return out;
}

function normalizeNotes(input: unknown, known: Set<string>, problems: string[]): DiagramNote[] {
  const out: DiagramNote[] = [];
  for (const n of arr<Partial<DiagramNote>>(input)) {
    const attach = str(n?.attach);
    const text = str(n?.text);
    if (!text) continue;
    if (!known.has(attach)) {
      problems.push(`A note points at "${attach || "(nothing)"}", which is not in this diagram; it was dropped.`);
      continue;
    }
    const side = oneOf(n?.side, ["left", "right"] as const);
    out.push({ attach, text: clip(text, MAX_NOTE), ...(side ? { side } : {}) });
  }
  return out;
}

// The whole pass. Takes anything (the model's JSON, a stored payload from an
// older build) and returns something drawable plus what had to be changed.
export function normalizeDiagram(input: unknown): NormalizeResult {
  const problems: string[] = [];
  const raw = (input && typeof input === "object" ? input : {}) as Partial<Diagram>;

  const nodes = normalizeNodes(raw.nodes, problems);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = normalizeEdges(raw.edges, nodeIds, problems);

  const layout =
    raw.layout === "stack" || raw.layout === "sequence" || raw.layout === "tree"
      ? raw.layout
      : "flow";
  if (raw.layout && raw.layout !== layout) {
    problems.push(`"${String(raw.layout)}" is not a layout; drew it as a flow.`);
  }

  const draft: Diagram = { v: DIAGRAM_VERSION, layout, nodes, edges };
  const edgeIds = new Set(withEdgeIds(draft).map((e) => e.id));
  // Groups address nodes everywhere except in a sequence, where they frame
  // message rows and so address edges.
  const groupPool = layout === "sequence" ? edgeIds : nodeIds;
  const groups = normalizeGroups(raw.groups, groupPool, problems);

  // A stack draws its bands from its groups, so a node in no band has nowhere to
  // be. Rather than dropping it, it gets a band of its own at the end — the
  // reader sees every node the model asked for, and the model is told.
  if (layout === "stack") {
    const banded = new Set(groups.flatMap((g) => g.members));
    const orphans = nodes.filter((n) => !banded.has(n.id)).map((n) => n.id);
    if (orphans.length > 0) {
      problems.push(
        `In a stack every node belongs to a band, and a band is a group: ${orphans.join(", ")} were in none, so each got a band of its own. Declare the bands as groups, top to bottom.`,
      );
      for (const id of orphans) groups.push({ id: `band:${id}`, members: [id] });
    }
  }

  const known = new Set([...nodeIds, ...edgeIds, ...groups.map((g) => g.id)]);
  const notes = normalizeNotes(raw.notes, known, problems);
  const stages = normalizeStages(raw.stages, nodeIds, edgeIds, problems);
  const focus = normalizeFocus(raw.focus, nodeIds, edgeIds, "The highlight", problems);
  if (stages && focus) {
    problems.push("A staged diagram takes its highlight from each stage; the top-level one was ignored.");
  }

  const direction =
    raw.direction === "right" || raw.direction === "up" || raw.direction === "down"
      ? raw.direction
      : undefined;

  const rawSource = raw.source && typeof raw.source === "object" ? raw.source : undefined;
  const page = Number(rawSource?.page);
  const source = rawSource
    ? {
        ...(str(rawSource.figure) ? { figure: str(rawSource.figure) } : {}),
        ...(Number.isFinite(page) && page > 0 ? { page: Math.round(page) } : {}),
      }
    : undefined;

  if (nodes.length === 0) problems.push("The diagram has no nodes; there is nothing to draw.");

  return {
    diagram: {
      v: DIAGRAM_VERSION,
      layout,
      ...(str(raw.title) ? { title: clip(str(raw.title), MAX_LABEL) } : {}),
      ...(direction ? { direction } : {}),
      nodes,
      ...(edges.length ? { edges } : {}),
      ...(groups.length ? { groups } : {}),
      ...(notes.length ? { notes } : {}),
      ...(stages ? { stages } : focus ? { focus } : {}),
      ...(source && (source.figure || source.page) ? { source } : {}),
      ...(str(raw.caption) ? { caption: clip(str(raw.caption), MAX_NOTE) } : {}),
    },
    problems,
  };
}
