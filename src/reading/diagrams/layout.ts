// Where everything goes. The model never writes a coordinate; every number in
// the picture is computed here.
//
// One rule runs through all four algorithms and is the reason the DSL looks the
// way it does: **layout sees the whole diagram, always**. A stage does not lay
// out its own subset and a focus does not lay out its path — both only set
// `emphasis` on things that were already placed. So the boxes hold still while
// the reader steps through the build-up or asks for one path to be lit, and what
// they are looking at stays the same picture instead of becoming a new one they
// have to re-read. Relayout per stage was the alternative and it makes the
// diagram jump on every step, which defeats the whole point of staging it.

import {
  angleOf,
  CANVAS_PAD,
  curvePath,
  edgeLabelWidth,
  elbowPath,
  emptyScene,
  GROUP_LABEL_H,
  GROUP_PAD,
  linePath,
  NODE_GAP,
  RAIL_GAP,
  RANK_GAP,
  sizeNode,
  type Emphasis,
  type Point,
  type Scene,
  type SceneBox,
  type SceneEdge,
  type SceneGroup,
  type SceneLifeline,
  type SceneNote,
  type SizedNode,
} from "./scene";
import { withEdgeIds } from "./normalize";
import type { Diagram, DiagramEdge, DiagramFocus } from "./types";

export interface LayoutOptions {
  // Which stage is showing, 0-based. Ignored when the diagram has no stages.
  stage?: number;
}

// --- emphasis --------------------------------------------------------------

// The nodes and edges a focus lights up. `path` is the ergonomic half: the model
// names the stops and the edges between consecutive stops are found here, in
// either direction — a reader tracing "where does Q come from" walks the arrows
// backwards, and refusing that would make them spell out edge ids.
export function resolveFocus(
  diagram: Diagram,
  focus: DiagramFocus,
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([...(focus.nodes ?? []), ...(focus.path ?? [])]);
  const edges = new Set<string>(focus.edges ?? []);
  const all = withEdgeIds(diagram);
  const path = focus.path ?? [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const hit =
      all.find((e) => e.edge.from === a && e.edge.to === b) ??
      all.find((e) => e.edge.from === b && e.edge.to === a);
    if (hit) edges.add(hit.id);
  }
  return { nodes, edges };
}

export interface EmphasisMap {
  nodes: Map<string, Emphasis>;
  edges: Map<string, Emphasis>;
  // The line under the picture for the current state: the stage's caption, the
  // focus label, or the diagram's own caption.
  caption: string;
}

const RANK_OF: Record<Emphasis, number> = { ghost: 0, dim: 1, full: 2, lit: 3 };

// Every node's and edge's strength for the state being drawn. The one place the
// stage/focus rules are written down; the layouts only read the answer.
export function resolveEmphasis(diagram: Diagram, opts: LayoutOptions = {}): EmphasisMap {
  const nodes = new Map<string, Emphasis>();
  const edges = new Map<string, Emphasis>();
  const allEdges = withEdgeIds(diagram);
  const stages = diagram.stages;

  // What exists yet. With stages, everything the stages up to and including the
  // current one named; without, everything.
  let introducedNodes: Set<string> | null = null;
  let introducedEdges: Set<string> | null = null;
  let focus = diagram.focus;
  let caption = diagram.caption ?? "";

  if (stages && stages.length > 0) {
    const index = Math.min(Math.max(opts.stage ?? 0, 0), stages.length - 1);
    introducedNodes = new Set();
    introducedEdges = new Set();
    for (let i = 0; i <= index; i++) {
      for (const id of stages[i].nodes ?? []) introducedNodes.add(id);
      for (const id of stages[i].edges ?? []) introducedEdges.add(id);
    }
    focus = stages[index].focus;
    caption = stages[index].caption ?? caption;
  }

  const lit = focus ? resolveFocus(diagram, focus) : null;
  if (focus?.label) caption = focus.label;

  for (const n of diagram.nodes) {
    if (introducedNodes && !introducedNodes.has(n.id)) nodes.set(n.id, "ghost");
    else if (!lit) nodes.set(n.id, "full");
    else nodes.set(n.id, lit.nodes.has(n.id) ? "lit" : "dim");
  }
  for (const { id, edge } of allEdges) {
    // An edge whose ends are not both on screen yet is not on screen either,
    // whatever the stage said — otherwise a stage that names an edge but not its
    // node draws a line into nothing.
    const endsIn =
      nodes.get(edge.from) !== "ghost" && nodes.get(edge.to) !== "ghost";
    if ((introducedEdges && !introducedEdges.has(id)) || !endsIn) edges.set(id, "ghost");
    else if (!lit) edges.set(id, "full");
    else edges.set(id, lit.edges.has(id) ? "lit" : "dim");
  }
  return { nodes, edges, caption };
}

// A group is as strong as its strongest member: a frame around a lit path stays
// visible, a frame around nothing yet stays a ghost.
function groupEmphasis(members: string[], from: Map<string, Emphasis>): Emphasis {
  let best: Emphasis = "ghost";
  for (const m of members) {
    const e = from.get(m);
    if (e && RANK_OF[e] > RANK_OF[best]) best = e;
  }
  return best;
}

// --- shared plumbing -------------------------------------------------------

interface Placed extends SizedNode {
  x: number;
  y: number;
}

function boxOf(p: Placed, emphasis: Emphasis): SceneBox {
  return {
    id: p.node.id,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    lines: p.lines,
    subLines: p.subLines,
    shape: p.node.shape ?? "box",
    tone: p.node.tone ?? "default",
    emphasis,
  };
}

function edgeStyle(edge: DiagramEdge) {
  return {
    dashed: edge.kind === "dashed",
    thick: edge.kind === "thick",
    arrow: edge.arrow ?? "to",
  };
}

// Shift every coordinate so the diagram starts at the padding, and report the
// canvas it needs. Every layout ends with this rather than trying to place its
// first element at the right spot.
function frame(scene: Omit<Scene, "width" | "height">): Scene {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const b of [...scene.boxes, ...scene.groups]) {
    see(b.x, b.y);
    see(b.x + b.w, b.y + b.h);
  }
  for (const l of scene.lifelines) {
    see(l.x, l.top);
    see(l.x, l.bottom);
  }
  for (const n of scene.notes) {
    see(n.anchor === "start" ? n.x : n.x - 140, n.y - 10);
    see(n.anchor === "start" ? n.x + 140 : n.x, n.y + 4);
  }
  for (const e of scene.edges) {
    for (const m of e.d.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
      see(Number(m[1]), Number(m[2]));
    }
    if (e.label) {
      see(e.labelX - e.labelW / 2, e.labelY - 8);
      see(e.labelX + e.labelW / 2, e.labelY + 8);
    }
  }
  if (!Number.isFinite(minX)) return { ...scene, width: 0, height: 0 };

  const dx = CANVAS_PAD - minX;
  const dy = CANVAS_PAD - minY;
  const move = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: o.x + dx, y: o.y + dy });
  return {
    boxes: scene.boxes.map(move),
    groups: scene.groups.map(move),
    notes: scene.notes.map(move),
    lifelines: scene.lifelines.map((l) => ({ ...l, x: l.x + dx, top: l.top + dy, bottom: l.bottom + dy })),
    edges: scene.edges.map((e) => ({
      ...e,
      d: shiftPath(e.d, dx, dy),
      labelX: e.labelX + dx,
      labelY: e.labelY + dy,
      head: e.head ? { ...e.head, x: e.head.x + dx, y: e.head.y + dy } : null,
      tail: e.tail ? { ...e.tail, x: e.tail.x + dx, y: e.tail.y + dy } : null,
    })),
    width: Math.round(maxX - minX + CANVAS_PAD * 2),
    height: Math.round(maxY - minY + CANVAS_PAD * 2),
  };
}

// Translate a path's coordinate pairs. Every path this module emits is built
// from `x y` pairs after a command letter, so a pairwise substitution is exact —
// there are no arc flags or shorthand commands in play.
function shiftPath(d: string, dx: number, dy: number): string {
  return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_all, x: string, y: string) => {
    const nx = Math.round((Number(x) + dx) * 10) / 10;
    const ny = Math.round((Number(y) + dy) * 10) / 10;
    return `${nx} ${ny}`;
  });
}

// Notes hang off whatever they are attached to, on the side with more room.
function layoutNotes(
  diagram: Diagram,
  anchors: Map<string, { x: number; y: number; w: number; h: number }>,
  emphasis: Map<string, Emphasis>,
): SceneNote[] {
  const out: SceneNote[] = [];
  for (const note of diagram.notes ?? []) {
    const a = anchors.get(note.attach);
    if (!a) continue;
    const right = note.side !== "left";
    out.push({
      x: right ? a.x + a.w + 10 : a.x - 10,
      y: a.y + a.h / 2 + 3,
      text: note.text,
      anchor: right ? "start" : "end",
      emphasis: emphasis.get(note.attach) ?? "full",
    });
  }
  return out;
}

// --- flow ------------------------------------------------------------------

// Which edges point backwards, found with a depth-first walk. Ranking a cyclic
// graph without this never terminates, and a diagram with a feedback loop in it
// is exactly the kind a reader asks for help with.
function findBackEdges(
  nodes: string[],
  edges: { id: string; edge: DiagramEdge }[],
): Set<string> {
  const out = new Map<string, { id: string; to: string }[]>();
  for (const n of nodes) out.set(n, []);
  for (const { id, edge } of edges) out.get(edge.from)?.push({ id, to: edge.to });

  const back = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const walk = (node: string) => {
    state.set(node, 1);
    for (const { id, to } of out.get(node) ?? []) {
      const s = state.get(to) ?? 0;
      if (s === 1) back.add(id);
      else if (s === 0) walk(to);
    }
    state.set(node, 2);
  };
  for (const n of nodes) if ((state.get(n) ?? 0) === 0) walk(n);
  return back;
}

// Longest-path ranking over the forward edges: a node sits one rank below its
// deepest predecessor, so an arrow never points backwards up the page.
function rankNodes(
  nodes: string[],
  edges: { id: string; edge: DiagramEdge }[],
  back: Set<string>,
): Map<string, number> {
  const forward = edges.filter((e) => !back.has(e.id));
  const indeg = new Map<string, number>(nodes.map((n) => [n, 0]));
  const out = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const { edge } of forward) {
    indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
    out.get(edge.from)?.push(edge.to);
  }
  const rank = new Map<string, number>(nodes.map((n) => [n, 0]));
  const queue = nodes.filter((n) => (indeg.get(n) ?? 0) === 0);
  while (queue.length) {
    const n = queue.shift()!;
    for (const next of out.get(n) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(n) ?? 0) + 1));
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }
  return rank;
}

// Order the nodes inside each rank so the lines between ranks cross as little as
// possible: repeated barycentre sweeps, then a pass that pulls each group's
// members back together, because a frame drawn round a scattered set of boxes
// swallows everything between them.
function orderRanks(
  ranks: string[][],
  edges: { edge: DiagramEdge }[],
  groupOf: Map<string, string>,
): string[][] {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const { edge } of edges) {
    if (!preds.has(edge.to)) preds.set(edge.to, []);
    if (!succs.has(edge.from)) succs.set(edge.from, []);
    preds.get(edge.to)!.push(edge.from);
    succs.get(edge.from)!.push(edge.to);
  }
  const order = ranks.map((r) => [...r]);
  const posIn = (rank: string[]) => new Map(rank.map((id, i) => [id, i]));

  const sweep = (from: Map<string, string[]>, ascending: boolean) => {
    const indices = ascending
      ? order.map((_, i) => i).slice(1)
      : order.map((_, i) => i).slice(0, -1).reverse();
    for (const i of indices) {
      const neighbourPos = posIn(order[ascending ? i - 1 : i + 1]);
      const here = posIn(order[i]);
      const key = new Map<string, number>();
      for (const id of order[i]) {
        const ns = (from.get(id) ?? []).map((n) => neighbourPos.get(n)).filter((v): v is number => v !== undefined);
        key.set(id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : here.get(id)!);
      }
      order[i].sort((a, b) => key.get(a)! - key.get(b)! || here.get(a)! - here.get(b)!);
    }
  };

  for (let pass = 0; pass < 3; pass++) {
    sweep(preds, true);
    sweep(succs, false);
  }

  // Group compaction: sort by the group's average position first, own position
  // second, so members end up adjacent without otherwise disturbing the order.
  for (const rank of order) {
    const here = posIn(rank);
    const groupKey = new Map<string, number>();
    const counts = new Map<string, { sum: number; n: number }>();
    for (const id of rank) {
      const g = groupOf.get(id);
      if (!g) continue;
      const c = counts.get(g) ?? { sum: 0, n: 0 };
      c.sum += here.get(id)!;
      c.n += 1;
      counts.set(g, c);
    }
    for (const id of rank) {
      const g = groupOf.get(id);
      groupKey.set(id, g ? counts.get(g)!.sum / counts.get(g)!.n : here.get(id)!);
    }
    rank.sort((a, b) => groupKey.get(a)! - groupKey.get(b)! || here.get(a)! - here.get(b)!);
  }
  return order;
}

function layoutFlow(diagram: Diagram, emph: EmphasisMap): Scene {
  const dir = diagram.direction ?? "down";
  const horizontal = dir === "right";
  const sized = diagram.nodes.map((n) => sizeNode(n));
  const byId = new Map(sized.map((s) => [s.node.id, s]));
  const ids = sized.map((s) => s.node.id);
  const edges = withEdgeIds(diagram);

  // The innermost group a node is in, for keeping members side by side.
  const groupOf = new Map<string, string>();
  for (const g of diagram.groups ?? []) for (const m of g.members) groupOf.set(m, g.id);

  const back = findBackEdges(ids, edges);
  const rank = rankNodes(ids, edges, back);
  const rankCount = Math.max(0, ...ids.map((id) => (rank.get(id) ?? 0) + 1));
  const ranks: string[][] = Array.from({ length: rankCount }, () => []);
  for (const id of ids) ranks[rank.get(id) ?? 0].push(id);
  const ordered = orderRanks(ranks, edges, groupOf);

  // Along the rank axis: each rank takes the depth of its tallest member, plus a
  // gap that widens where a group frame starts or ends so the frame has room.
  const alongSize = (s: SizedNode) => (horizontal ? s.w : s.h);
  const acrossSize = (s: SizedNode) => (horizontal ? s.h : s.w);
  const alongStart: number[] = [];
  let cursor = 0;
  for (let r = 0; r < ordered.length; r++) {
    if (r > 0) {
      const before = new Set(ordered[r - 1].map((id) => groupOf.get(id)).filter(Boolean));
      const now = new Set(ordered[r].map((id) => groupOf.get(id)).filter(Boolean));
      const boundary = [...now].some((g) => !before.has(g!)) || [...before].some((g) => !now.has(g!));
      cursor += RANK_GAP + (boundary ? GROUP_PAD + GROUP_LABEL_H : 0);
    }
    alongStart.push(cursor);
    cursor += Math.max(0, ...ordered[r].map((id) => alongSize(byId.get(id)!)));
  }
  const alongTotal = cursor;

  // Across the rank: packed with a gap, widened between neighbours that belong
  // to different groups, then each rank centred on the widest one.
  const acrossPos = new Map<string, number>();
  const rankWidth: number[] = [];
  for (const rankIds of ordered) {
    let x = 0;
    for (let i = 0; i < rankIds.length; i++) {
      if (i > 0) {
        const differ = groupOf.get(rankIds[i - 1]) !== groupOf.get(rankIds[i]);
        x += NODE_GAP + (differ ? GROUP_PAD : 0);
      }
      acrossPos.set(rankIds[i], x);
      x += acrossSize(byId.get(rankIds[i])!);
    }
    rankWidth.push(x);
  }
  const acrossTotal = Math.max(0, ...rankWidth);
  ordered.forEach((rankIds, r) => {
    const shift = (acrossTotal - rankWidth[r]) / 2;
    for (const id of rankIds) acrossPos.set(id, acrossPos.get(id)! + shift);
  });

  // Logical -> real coordinates.
  const placed = new Map<string, Placed>();
  for (const s of sized) {
    const r = rank.get(s.node.id) ?? 0;
    const along = alongStart[r] + (Math.max(0, ...ordered[r].map((id) => alongSize(byId.get(id)!))) - alongSize(s)) / 2;
    const across = acrossPos.get(s.node.id) ?? 0;
    const flipped = dir === "up" ? alongTotal - along - alongSize(s) : along;
    placed.set(s.node.id, {
      ...s,
      x: horizontal ? flipped : across,
      y: horizontal ? across : flipped,
    });
  }

  const groups = layoutGroups(diagram, placed, emph);
  const boxes = sized.map((s) => boxOf(placed.get(s.node.id)!, emph.nodes.get(s.node.id) ?? "full"));
  const bounds = boundsOf([...boxes, ...groups]);
  const sceneEdges = routeFlowEdges(edges, placed, rank, back, dir, emph, bounds);

  const anchors = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const b of boxes) anchors.set(b.id, b);
  for (const g of groups) anchors.set(g.id, g);
  return frame({ boxes, edges: sceneEdges, groups, notes: layoutNotes(diagram, anchors, emph.nodes), lifelines: [] });
}

// The box around a set of boxes. Deliberately not clamped to the origin: a
// group frame is computed from its members' bounds, and folding 0 into the
// minimum stretched every frame up to the top of the diagram, swallowing the
// nodes above it.
function boundsOf(rects: { x: number; y: number; w: number; h: number }[]) {
  if (rects.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    minY: Math.min(...rects.map((r) => r.y)),
    maxX: Math.max(...rects.map((r) => r.x + r.w)),
    maxY: Math.max(...rects.map((r) => r.y + r.h)),
  };
}

// Group frames: the bounding box of the members plus padding, computed
// innermost-first so a parent frame encloses its children's frames and not just
// their boxes.
function layoutGroups(
  diagram: Diagram,
  placed: Map<string, Placed>,
  emph: EmphasisMap,
): SceneGroup[] {
  const groups = diagram.groups ?? [];
  if (groups.length === 0) return [];
  const depth = new Map<string, number>();
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    let d = 0;
    let cursor = g.parent ? byId.get(g.parent) : undefined;
    const guard = new Set<string>([g.id]);
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      d += 1;
      cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    }
    depth.set(g.id, d);
  }

  const rects = new Map<string, SceneGroup>();
  for (const g of [...groups].sort((a, b) => depth.get(b.id)! - depth.get(a.id)!)) {
    const parts: { x: number; y: number; w: number; h: number }[] = [];
    for (const m of g.members) {
      const p = placed.get(m);
      if (p) parts.push(p);
    }
    for (const child of groups) if (child.parent === g.id && rects.has(child.id)) parts.push(rects.get(child.id)!);
    if (parts.length === 0) continue;
    const b = boundsOf(parts);
    const labelled = g.label ? GROUP_LABEL_H : 0;
    rects.set(g.id, {
      id: g.id,
      x: b.minX - GROUP_PAD,
      y: b.minY - GROUP_PAD - labelled,
      w: b.maxX - b.minX + GROUP_PAD * 2,
      h: b.maxY - b.minY + GROUP_PAD * 2 + labelled,
      label: g.label ?? "",
      repeat: g.repeat ?? "",
      emphasis: groupEmphasis(g.members, emph.nodes),
    });
  }
  // Outermost first, so a nested frame paints over its parent.
  return groups
    .filter((g) => rects.has(g.id))
    .sort((a, b) => depth.get(a.id)! - depth.get(b.id)!)
    .map((g) => rects.get(g.id)!);
}

// Anchor points on a box for a given flow direction.
function exitPoint(p: Placed, dir: string): Point {
  if (dir === "right") return { x: p.x + p.w, y: p.y + p.h / 2 };
  if (dir === "up") return { x: p.x + p.w / 2, y: p.y };
  return { x: p.x + p.w / 2, y: p.y + p.h };
}
function entryPoint(p: Placed, dir: string): Point {
  if (dir === "right") return { x: p.x, y: p.y + p.h / 2 };
  if (dir === "up") return { x: p.x + p.w / 2, y: p.y + p.h };
  return { x: p.x + p.w / 2, y: p.y };
}

function routeFlowEdges(
  edges: { id: string; edge: DiagramEdge }[],
  placed: Map<string, Placed>,
  rank: Map<string, number>,
  back: Set<string>,
  dir: string,
  emph: EmphasisMap,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): SceneEdge[] {
  const horizontal = dir === "right";
  // Edges that cannot go straight down take a rail around the side. The longer
  // the jump the further out it runs, so two rails never sit on top of each
  // other — which is what a residual connection and a feedback loop drawn on the
  // same diagram would otherwise do.
  const railEdges = edges.filter(({ id, edge }) => {
    if (back.has(id)) return true;
    return Math.abs((rank.get(edge.to) ?? 0) - (rank.get(edge.from) ?? 0)) > 1;
  });
  const railLane = new Map<string, number>();
  [...railEdges]
    .sort(
      (a, b) =>
        Math.abs((rank.get(b.edge.to) ?? 0) - (rank.get(b.edge.from) ?? 0)) -
        Math.abs((rank.get(a.edge.to) ?? 0) - (rank.get(a.edge.from) ?? 0)),
    )
    .forEach((e, i) => railLane.set(e.id, i));

  const out: SceneEdge[] = [];
  for (const { id, edge } of edges) {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    if (!a || !b) continue;
    const style = edgeStyle(edge);
    const emphasis = emph.edges.get(id) ?? "full";
    const label = edge.label ?? "";
    let d: string;
    let head: Point;
    let approach: Point;
    let tail: Point | null = null;
    let tailFrom: Point | null = null;

    const lane = railLane.get(id);
    if (lane !== undefined) {
      // Out of the side, along the rail, back in from the same side.
      const offset = RAIL_GAP + lane * 15;
      if (horizontal) {
        const railY = bounds.maxY + offset;
        const from = { x: a.x + a.w / 2, y: a.y + a.h };
        const to = { x: b.x + b.w / 2, y: b.y + b.h };
        d = elbowPath([from, { x: from.x, y: railY }, { x: to.x, y: railY }, to]);
        head = to;
        approach = { x: to.x, y: railY };
        tail = from;
        tailFrom = { x: from.x, y: railY };
      } else {
        const railX = bounds.maxX + offset;
        const from = { x: a.x + a.w, y: a.y + a.h / 2 };
        const to = { x: b.x + b.w, y: b.y + b.h / 2 };
        d = elbowPath([from, { x: railX, y: from.y }, { x: railX, y: to.y }, to]);
        head = to;
        approach = { x: railX, y: to.y };
        tail = from;
        tailFrom = { x: railX, y: from.y };
      }
    } else {
      const from = exitPoint(a, dir);
      const to = entryPoint(b, dir);
      const aligned = horizontal ? Math.abs(from.y - to.y) < 1 : Math.abs(from.x - to.x) < 1;
      d = aligned ? linePath(from, to) : curvePath(from, to, !horizontal);
      head = to;
      approach = aligned
        ? from
        : horizontal
          ? { x: (from.x + to.x) / 2, y: to.y }
          : { x: to.x, y: (from.y + to.y) / 2 };
      tail = from;
      tailFrom = aligned
        ? to
        : horizontal
          ? { x: (from.x + to.x) / 2, y: from.y }
          : { x: from.x, y: (from.y + to.y) / 2 };
    }

    const mid = midOfPath(d);
    out.push({
      id,
      d,
      head: style.arrow === "none" ? null : { x: head.x, y: head.y, angle: angleOf(approach, head) },
      tail:
        style.arrow === "both" && tail && tailFrom
          ? { x: tail.x, y: tail.y, angle: angleOf(tailFrom, tail) }
          : null,
      label,
      labelX: mid.x,
      labelY: mid.y,
      labelW: edgeLabelWidth(label),
      dashed: style.dashed,
      thick: style.thick,
      emphasis,
    });
  }
  return out;
}

// The middle of a path, for hanging its label on. Taken from the path's own
// points rather than from the endpoints, so a label on a rail sits on the rail
// and not in the middle of the diagram it is routed around.
function midOfPath(d: string): Point {
  const points = [...d.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length <= 2) {
    const a = points[0];
    const b = points[points.length - 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  const i = Math.floor(points.length / 2);
  const a = points[i - 1];
  const b = points[i];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// --- stack -----------------------------------------------------------------

// Bands, one per group, in the order the groups were declared. Edges between
// adjacent bands are short arrows; anything that skips a band rides a rail down
// the side, which is how a residual connection is drawn.
function layoutStack(diagram: Diagram, emph: EmphasisMap): Scene {
  const up = diagram.direction === "up";
  const sized = new Map(diagram.nodes.map((n) => [n.id, sizeNode(n)]));
  const bands = (diagram.groups ?? []).filter((g) => g.members.some((m) => sized.has(m)));

  const bandWidth = (members: string[]) => {
    const ms = members.map((m) => sized.get(m)).filter((s): s is SizedNode => !!s);
    return ms.reduce((sum, s) => sum + s.w, 0) + Math.max(0, ms.length - 1) * NODE_GAP;
  };
  const innerWidth = Math.max(0, ...bands.map((b) => bandWidth(b.members)));

  const placed = new Map<string, Placed>();
  const groups: SceneGroup[] = [];
  let y = 0;
  const order = up ? [...bands].reverse() : bands;
  for (const band of order) {
    const members = band.members.map((m) => sized.get(m)).filter((s): s is SizedNode => !!s);
    const rowH = Math.max(0, ...members.map((s) => s.h));
    const labelled = band.label ? GROUP_LABEL_H : 0;
    let x = GROUP_PAD + (innerWidth - bandWidth(band.members)) / 2;
    for (const s of members) {
      placed.set(s.node.id, { ...s, x, y: y + GROUP_PAD + labelled + (rowH - s.h) / 2 });
      x += s.w + NODE_GAP;
    }
    groups.push({
      id: band.id,
      x: 0,
      y,
      w: innerWidth + GROUP_PAD * 2,
      h: rowH + GROUP_PAD * 2 + labelled,
      label: band.label ?? "",
      repeat: band.repeat ?? "",
      emphasis: groupEmphasis(band.members, emph.nodes),
    });
    y += rowH + GROUP_PAD * 2 + labelled + RANK_GAP * 0.7;
  }

  // A node's band index, so an edge knows whether it is a step or a skip.
  const bandOf = new Map<string, number>();
  order.forEach((band, i) => band.members.forEach((m) => bandOf.set(m, i)));

  const boxes = [...placed.values()].map((p) => boxOf(p, emph.nodes.get(p.node.id) ?? "full"));
  const bounds = boundsOf([...boxes, ...groups]);
  const edges = withEdgeIds(diagram);
  const sceneEdges: SceneEdge[] = [];
  let lane = 0;
  for (const { id, edge } of edges) {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    if (!a || !b) continue;
    const style = edgeStyle(edge);
    const label = edge.label ?? "";
    const step = Math.abs((bandOf.get(edge.to) ?? 0) - (bandOf.get(edge.from) ?? 0));
    let d: string;
    let head: Point;
    let approach: Point;
    if (step <= 1) {
      const downward = b.y > a.y;
      const from = { x: a.x + a.w / 2, y: downward ? a.y + a.h : a.y };
      const to = { x: b.x + b.w / 2, y: downward ? b.y : b.y + b.h };
      d = Math.abs(from.x - to.x) < 1 ? linePath(from, to) : curvePath(from, to, true);
      head = to;
      approach = { x: to.x, y: (from.y + to.y) / 2 };
    } else {
      const railX = bounds.maxX + RAIL_GAP + lane * 15;
      lane += 1;
      const from = { x: a.x + a.w, y: a.y + a.h / 2 };
      const to = { x: b.x + b.w, y: b.y + b.h / 2 };
      d = elbowPath([from, { x: railX, y: from.y }, { x: railX, y: to.y }, to]);
      head = to;
      approach = { x: railX, y: to.y };
    }
    const mid = midOfPath(d);
    sceneEdges.push({
      id,
      d,
      head: style.arrow === "none" ? null : { x: head.x, y: head.y, angle: angleOf(approach, head) },
      tail: null,
      label,
      labelX: mid.x,
      labelY: mid.y,
      labelW: edgeLabelWidth(label),
      dashed: style.dashed,
      thick: style.thick,
      emphasis: emph.edges.get(id) ?? "full",
    });
  }

  const anchors = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const b of boxes) anchors.set(b.id, b);
  for (const g of groups) anchors.set(g.id, g);
  return frame({ boxes, edges: sceneEdges, groups, notes: layoutNotes(diagram, anchors, emph.nodes), lifelines: [] });
}

// --- tree ------------------------------------------------------------------

// A subtree is as wide as its children need or its own box needs, whichever is
// more, and a node is centred on its own subtree. That sizing-first pass is what
// keeps siblings from overlapping without a contour walk.
function layoutTree(diagram: Diagram, emph: EmphasisMap): Scene {
  const horizontal = diagram.direction === "right";
  const sized = diagram.nodes.map((n) => sizeNode(n));
  const byId = new Map(sized.map((s) => [s.node.id, s]));
  const edges = withEdgeIds(diagram);

  // First parent wins; any further edge into a node is a cross link, drawn
  // dashed rather than dropped.
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  const crossLinks: { id: string; edge: DiagramEdge }[] = [];
  // Whether `maybe` is already above `of`. Checked before an edge is accepted as
  // a parent link rather than repaired afterwards: the recursions below walk
  // `children`, so a cycle broken in `parent` alone leaves them running forever.
  const isAncestor = (maybe: string, of: string): boolean => {
    const seen = new Set<string>();
    let cursor: string | undefined = of;
    while (cursor && !seen.has(cursor)) {
      if (cursor === maybe) return true;
      seen.add(cursor);
      cursor = parent.get(cursor);
    }
    return false;
  };
  for (const { id, edge } of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    // A node keeps its first parent. A second edge into it, a self-loop, or an
    // edge that would close a cycle is real but is not hierarchy, so it is drawn
    // dashed across the tree instead of dropped.
    if (parent.has(edge.to) || edge.to === edge.from || isAncestor(edge.to, edge.from)) {
      crossLinks.push({ id, edge });
      continue;
    }
    parent.set(edge.to, edge.from);
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from)!.push(edge.to);
  }
  const roots = sized.filter((s) => !parent.has(s.node.id)).map((s) => s.node.id);

  const across = (s: SizedNode) => (horizontal ? s.h : s.w);
  const along = (s: SizedNode) => (horizontal ? s.w : s.h);

  const span = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children.get(id) ?? [];
    const own = across(byId.get(id)!);
    if (kids.length === 0) {
      span.set(id, own);
      return own;
    }
    const total = kids.reduce((sum, k) => sum + measure(k), 0) + (kids.length - 1) * NODE_GAP;
    const w = Math.max(own, total);
    span.set(id, w);
    return w;
  };
  for (const r of roots) measure(r);

  // Depth bands: every node at the same depth shares a line, so the hierarchy
  // reads as levels rather than as a scatter.
  const depth = new Map<string, number>();
  const setDepth = (id: string, d: number) => {
    depth.set(id, d);
    for (const k of children.get(id) ?? []) setDepth(k, d + 1);
  };
  for (const r of roots) setDepth(r, 0);
  const depthCount = Math.max(0, ...[...depth.values()].map((d) => d + 1));
  const depthSize: number[] = Array.from({ length: depthCount }, (_, d) =>
    Math.max(0, ...sized.filter((s) => depth.get(s.node.id) === d).map(along)),
  );
  const depthStart: number[] = [];
  let acc = 0;
  for (let d = 0; d < depthCount; d++) {
    depthStart.push(acc);
    acc += depthSize[d] + RANK_GAP;
  }

  const placed = new Map<string, Placed>();
  // Children are placed first, then the parent is centred between the outer
  // two — not over the middle of the block they occupy. With subtrees of unequal
  // width those are different points, and centring on the block leaves the
  // parent visibly off from the fan of arrows leaving it.
  const place = (id: string, left: number) => {
    const s = byId.get(id)!;
    const d = depth.get(id) ?? 0;
    const width = span.get(id)!;
    const kids = children.get(id) ?? [];
    const total = kids.reduce((sum, k) => sum + span.get(k)!, 0) + Math.max(0, kids.length - 1) * NODE_GAP;

    let cursor = left + (width - total) / 2;
    const kidCentres: number[] = [];
    for (const k of kids) {
      place(k, cursor);
      // Where the child's box actually landed, not the middle of the room it was
      // given: a child that leant towards its own outer children is no longer in
      // the middle of its subtree, and aiming the parent at the room instead of
      // at the box points it away from the arrow it draws.
      const box = placed.get(k)!;
      kidCentres.push(horizontal ? box.y + box.h / 2 : box.x + box.w / 2);
      cursor += span.get(k)! + NODE_GAP;
    }

    const own = across(s);
    const wanted = kidCentres.length
      ? (kidCentres[0] + kidCentres[kidCentres.length - 1]) / 2
      : left + width / 2;
    // Clamped inside its own subtree, so leaning towards the outer children can
    // never push a node over a sibling's.
    const centre = Math.min(Math.max(wanted, left + own / 2), left + width - own / 2);
    const a = depthStart[d] + (depthSize[d] - along(s)) / 2;
    placed.set(id, {
      ...s,
      x: horizontal ? a : centre - s.w / 2,
      y: horizontal ? centre - s.h / 2 : a,
    });
  };
  let rootCursor = 0;
  for (const r of roots) {
    place(r, rootCursor);
    rootCursor += span.get(r)! + NODE_GAP * 2;
  }

  const boxes = sized
    .filter((s) => placed.has(s.node.id))
    .map((s) => boxOf(placed.get(s.node.id)!, emph.nodes.get(s.node.id) ?? "full"));

  const sceneEdges: SceneEdge[] = [];
  for (const { id, edge } of edges) {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    if (!a || !b) continue;
    const cross = crossLinks.some((c) => c.id === id);
    const style = edgeStyle(edge);
    const from = horizontal ? { x: a.x + a.w, y: a.y + a.h / 2 } : { x: a.x + a.w / 2, y: a.y + a.h };
    const to = horizontal ? { x: b.x, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y };
    const d = cross
      ? curvePath(from, to, !horizontal)
      : horizontal
        ? elbowPath([from, { x: (from.x + to.x) / 2, y: from.y }, { x: (from.x + to.x) / 2, y: to.y }, to])
        : elbowPath([from, { x: from.x, y: (from.y + to.y) / 2 }, { x: to.x, y: (from.y + to.y) / 2 }, to]);
    const mid = midOfPath(d);
    sceneEdges.push({
      id,
      d,
      head: style.arrow === "none" ? null : { x: to.x, y: to.y, angle: horizontal ? 0 : 90 },
      tail: null,
      label: edge.label ?? "",
      labelX: mid.x,
      labelY: mid.y,
      labelW: edgeLabelWidth(edge.label ?? ""),
      dashed: style.dashed || cross,
      thick: style.thick,
      emphasis: emph.edges.get(id) ?? "full",
    });
  }

  const groups = layoutGroups(diagram, placed, emph);
  const anchors = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const b of boxes) anchors.set(b.id, b);
  for (const g of groups) anchors.set(g.id, g);
  return frame({ boxes, edges: sceneEdges, groups, notes: layoutNotes(diagram, anchors, emph.nodes), lifelines: [] });
}

// --- sequence --------------------------------------------------------------

const MSG_ROW = 34;
const SELF_ROW = 46;

// Participants across the top, messages down the page in the order they were
// written. The one layout where the order of `edges` is the content rather than
// a hint — time is the vertical axis.
function layoutSequence(diagram: Diagram, emph: EmphasisMap): Scene {
  const sized = diagram.nodes.map((n) => sizeNode(n));
  const byId = new Map(sized.map((s) => [s.node.id, s]));
  const index = new Map(sized.map((s, i) => [s.node.id, i]));
  const edges = withEdgeIds(diagram).filter(
    ({ edge }) => byId.has(edge.from) && byId.has(edge.to),
  );

  // A lane has to be wide enough for the widest message label crossing it, or
  // the text of one arrow lands on the next lifeline.
  const laneNeed = new Array(Math.max(0, sized.length - 1)).fill(0);
  for (const { edge } of edges) {
    const a = index.get(edge.from)!;
    const b = index.get(edge.to)!;
    if (a === b) continue;
    const span = Math.abs(b - a);
    const need = (edgeLabelWidth(edge.label ?? "") + 24) / span;
    for (let i = Math.min(a, b); i < Math.max(a, b); i++) laneNeed[i] = Math.max(laneNeed[i], need);
  }

  const headH = Math.max(0, ...sized.map((s) => s.h));
  const centre = new Map<string, number>();
  const placed = new Map<string, Placed>();
  let x = 0;
  sized.forEach((s, i) => {
    if (i > 0) x += Math.max(NODE_GAP * 2, laneNeed[i - 1]);
    placed.set(s.node.id, { ...s, x, y: (headH - s.h) / 2 });
    centre.set(s.node.id, x + s.w / 2);
    x += s.w;
  });

  const rowY = new Map<string, number>();
  let y = headH + 26;
  for (const { id, edge } of edges) {
    rowY.set(id, y);
    y += edge.from === edge.to ? SELF_ROW : MSG_ROW;
  }
  const bottom = y + 6;

  const sceneEdges: SceneEdge[] = [];
  for (const { id, edge } of edges) {
    const style = edgeStyle(edge);
    const ax = centre.get(edge.from)!;
    const bx = centre.get(edge.to)!;
    const ry = rowY.get(id)!;
    const label = edge.label ?? "";
    let d: string;
    let head: Point;
    let approach: Point;
    let labelAt: Point;
    if (edge.from === edge.to) {
      const loop = 26;
      d = elbowPath(
        [
          { x: ax, y: ry },
          { x: ax + loop, y: ry },
          { x: ax + loop, y: ry + 18 },
          { x: ax, y: ry + 18 },
        ],
        6,
      );
      head = { x: ax, y: ry + 18 };
      approach = { x: ax + loop, y: ry + 18 };
      labelAt = { x: ax + loop + edgeLabelWidth(label) / 2 + 6, y: ry + 9 };
    } else {
      d = linePath({ x: ax, y: ry }, { x: bx, y: ry });
      head = { x: bx, y: ry };
      approach = { x: ax, y: ry };
      labelAt = { x: (ax + bx) / 2, y: ry - 7 };
    }
    sceneEdges.push({
      id,
      d,
      head: style.arrow === "none" ? null : { x: head.x, y: head.y, angle: angleOf(approach, head) },
      tail:
        style.arrow === "both" && edge.from !== edge.to
          ? { x: ax, y: ry, angle: angleOf({ x: bx, y: ry }, { x: ax, y: ry }) }
          : null,
      label,
      labelX: labelAt.x,
      labelY: labelAt.y,
      labelW: edgeLabelWidth(label),
      dashed: style.dashed,
      thick: style.thick,
      emphasis: emph.edges.get(id) ?? "full",
    });
  }

  // In a sequence a group frames message rows, so its members are edge ids.
  const groups: SceneGroup[] = [];
  for (const g of diagram.groups ?? []) {
    const ys = g.members.map((m) => rowY.get(m)).filter((v): v is number => v !== undefined);
    if (ys.length === 0) continue;
    groups.push({
      id: g.id,
      x: -GROUP_PAD,
      y: Math.min(...ys) - GROUP_PAD - (g.label ? GROUP_LABEL_H : 0),
      w: x + GROUP_PAD * 2,
      h: Math.max(...ys) - Math.min(...ys) + GROUP_PAD * 2 + (g.label ? GROUP_LABEL_H : 0) + 10,
      label: g.label ?? "",
      repeat: g.repeat ?? "",
      emphasis: groupEmphasis(g.members, emph.edges),
    });
  }

  const lifelines: SceneLifeline[] = sized.map((s) => ({
    id: s.node.id,
    x: centre.get(s.node.id)!,
    top: headH,
    bottom,
    emphasis: emph.nodes.get(s.node.id) ?? "full",
  }));
  const boxes = sized.map((s) => boxOf(placed.get(s.node.id)!, emph.nodes.get(s.node.id) ?? "full"));
  const anchors = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const b of boxes) anchors.set(b.id, b);
  for (const g of groups) anchors.set(g.id, g);
  return frame({ boxes, edges: sceneEdges, groups, notes: layoutNotes(diagram, anchors, emph.nodes), lifelines });
}

// --- entry point -----------------------------------------------------------

// The whole diagram placed, for the stage being shown. Pure: same diagram and
// same stage in, same numbers out, no DOM, no measurement, no randomness.
export function layoutDiagram(diagram: Diagram, opts: LayoutOptions = {}): Scene {
  if (diagram.nodes.length === 0) return emptyScene();
  const emph = resolveEmphasis(diagram, opts);
  switch (diagram.layout) {
    case "stack":
      return layoutStack(diagram, emph);
    case "sequence":
      return layoutSequence(diagram, emph);
    case "tree":
      return layoutTree(diagram, emph);
    default:
      return layoutFlow(diagram, emph);
  }
}
