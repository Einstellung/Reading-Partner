// The layout's invariants. These are the properties that decide whether a
// diagram is readable at all, so they are asserted over whole diagrams rather
// than by pinning coordinates — a pinned coordinate breaks on every tuning pass
// and tells you nothing about whether the picture is legible.
//
// The load-bearing one is "the geometry does not move between stages". The whole
// reason focus and stages are views over one node set, instead of separate
// diagrams, is that the reader is meant to be watching one picture change rather
// than reading a new one each step. If that stops holding, the feature is gone
// whatever else still passes.

import { expect, test } from "bun:test";
import { layoutDiagram, resolveEmphasis, resolveFocus } from "../../../src/reading/diagrams/layout";
import { normalizeDiagram } from "../../../src/reading/diagrams/normalize";
import { measureLine } from "../../../src/reading/diagrams/text";
import { FONT_SIZE, type Scene } from "../../../src/reading/diagrams/scene";
import type { Diagram } from "../../../src/reading/diagrams/types";

function build(input: unknown): Diagram {
  return normalizeDiagram(input).diagram;
}

const FLOW = build({
  layout: "flow",
  nodes: [
    { id: "x", label: "Input X", sub: "[B, T, C]", shape: "pill" },
    { id: "wq", label: "W_Q" },
    { id: "wk", label: "W_K" },
    { id: "wv", label: "W_V" },
    { id: "q", label: "Q", tone: "primary" },
    { id: "k", label: "K" },
    { id: "v", label: "V" },
    { id: "scores", label: "QK / sqrt(d_k)" },
    { id: "sm", label: "softmax" },
    { id: "out", label: "Attention output", shape: "pill" },
  ],
  edges: [
    { from: "x", to: "wq" }, { from: "x", to: "wk" }, { from: "x", to: "wv" },
    { from: "wq", to: "q" }, { from: "wk", to: "k" }, { from: "wv", to: "v" },
    { from: "q", to: "scores" }, { from: "k", to: "scores" },
    { from: "scores", to: "sm" }, { from: "sm", to: "out", label: "weights" },
    { from: "v", to: "out" },
  ],
  groups: [{ id: "proj", label: "Linear projections", members: ["wq", "wk", "wv"] }],
});

const STACK = build({
  layout: "stack",
  direction: "up",
  nodes: [
    { id: "in", label: "输入嵌入 + 位置编码", shape: "pill" },
    { id: "mha", label: "多头注意力", tone: "primary" },
    { id: "an1", label: "Add & Norm" },
    { id: "ff", label: "前馈网络" },
    { id: "an2", label: "Add & Norm" },
  ],
  groups: [
    { id: "b0", members: ["in"] },
    { id: "b1", label: "Sub-layer 1", members: ["mha"] },
    { id: "b2", members: ["an1"] },
    { id: "b3", label: "Sub-layer 2", members: ["ff"] },
    { id: "b4", members: ["an2"], repeat: "× 6" },
  ],
  edges: [
    { from: "in", to: "mha" }, { from: "mha", to: "an1" },
    { from: "an1", to: "ff" }, { from: "ff", to: "an2" },
    { from: "in", to: "an1", kind: "dashed", label: "residual" },
    { from: "an1", to: "an2", kind: "dashed", label: "residual" },
  ],
});

const SEQUENCE = build({
  layout: "sequence",
  nodes: [
    { id: "r", label: "读者" },
    { id: "app", label: "App" },
    { id: "ai", label: "AI" },
  ],
  edges: [
    { from: "r", to: "app", label: "问一个问题" },
    { from: "app", to: "ai", label: "系统提示 + 全书" },
    { from: "ai", to: "ai", label: "看图" },
    { from: "ai", to: "r", label: "讲解" },
  ],
  groups: [{ id: "g", label: "一个回合", members: ["app->ai", "ai->ai"] }],
});

const TREE = build({
  layout: "tree",
  nodes: [
    { id: "att", label: "注意力机制" },
    { id: "self", label: "自注意力" },
    { id: "cross", label: "交叉注意力" },
    { id: "sparse", label: "稀疏注意力" },
    { id: "mha", label: "多头" },
    { id: "flash", label: "FlashAttention", sub: "IO 感知" },
    { id: "local", label: "局部窗口" },
  ],
  edges: [
    { from: "att", to: "self" }, { from: "att", to: "cross" }, { from: "att", to: "sparse" },
    { from: "self", to: "mha" }, { from: "self", to: "flash" }, { from: "sparse", to: "local" },
  ],
});

const ALL: [string, Diagram][] = [
  ["flow", FLOW],
  ["stack", STACK],
  ["sequence", SEQUENCE],
  ["tree", TREE],
];

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function geometry(scene: Scene): string {
  return JSON.stringify([
    scene.width,
    scene.height,
    scene.boxes.map((b) => [b.id, b.x, b.y, b.w, b.h]),
    scene.groups.map((g) => [g.id, g.x, g.y, g.w, g.h]),
    scene.edges.map((e) => [e.id, e.d]),
  ]);
}

test.each(ALL)("%s: no two boxes overlap", (_name, diagram) => {
  const { boxes } = layoutDiagram(diagram);
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) hits.push(`${boxes[i].id} over ${boxes[j].id}`);
    }
  }
  expect(hits).toEqual([]);
});

test.each(ALL)("%s: every box holds its own text", (_name, diagram) => {
  for (const box of layoutDiagram(diagram).boxes) {
    for (const line of box.lines) {
      // The text is centred, so the box has to be at least as wide as the line.
      expect(measureLine(line, FONT_SIZE)).toBeLessThanOrEqual(box.w);
    }
    expect(box.h).toBeGreaterThanOrEqual(box.lines.length * 12);
  }
});

test.each(ALL)("%s: nothing is drawn outside the canvas", (_name, diagram) => {
  const scene = layoutDiagram(diagram);
  for (const box of [...scene.boxes, ...scene.groups]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(scene.width);
    expect(box.y + box.h).toBeLessThanOrEqual(scene.height);
  }
});

test("a group frame encloses its members", () => {
  const scene = layoutDiagram(FLOW);
  const frame = scene.groups.find((g) => g.id === "proj");
  expect(frame).toBeDefined();
  for (const id of ["wq", "wk", "wv"]) {
    const box = scene.boxes.find((b) => b.id === id)!;
    expect(box.x).toBeGreaterThanOrEqual(frame!.x);
    expect(box.y).toBeGreaterThanOrEqual(frame!.y);
    expect(box.x + box.w).toBeLessThanOrEqual(frame!.x + frame!.w);
    expect(box.y + box.h).toBeLessThanOrEqual(frame!.y + frame!.h);
  }
});

// The regression this pins: the frame's bounds were folded together with the
// origin, which stretched every group up to the top of the diagram and swallowed
// the nodes above it.
test("a group frame does not swallow nodes that are not its members", () => {
  const scene = layoutDiagram(FLOW);
  const frame = scene.groups.find((g) => g.id === "proj")!;
  const outsider = scene.boxes.find((b) => b.id === "x")!;
  expect(overlaps(frame, outsider)).toBe(false);
});

test("an arrow points down the page: a target never sits above its source", () => {
  const scene = layoutDiagram(FLOW);
  const at = new Map(scene.boxes.map((b) => [b.id, b]));
  for (const [from, to] of [["x", "wq"], ["wq", "q"], ["q", "scores"], ["scores", "sm"]]) {
    expect(at.get(to)!.y).toBeGreaterThan(at.get(from)!.y);
  }
});

test("a stack lays its bands out in group order, first band at the bottom when up", () => {
  const scene = layoutDiagram(STACK);
  const at = new Map(scene.boxes.map((b) => [b.id, b]));
  const order = ["in", "mha", "an1", "ff", "an2"];
  for (let i = 1; i < order.length; i++) {
    expect(at.get(order[i])!.y).toBeLessThan(at.get(order[i - 1])!.y);
  }
});

test("a sequence puts every participant on the top row and gives each a lifeline", () => {
  const scene = layoutDiagram(SEQUENCE);
  expect(scene.lifelines.map((l) => l.id)).toEqual(["r", "app", "ai"]);
  const tops = new Set(scene.boxes.map((b) => b.y));
  expect(tops.size).toBe(1);
  for (const l of scene.lifelines) expect(l.bottom).toBeGreaterThan(l.top);
});

test("a sequence keeps messages in the order they were written", () => {
  const scene = layoutDiagram(SEQUENCE);
  const ys = scene.edges.map((e) => Number(/M ([\d.]+) ([\d.]+)/.exec(e.d)![2]));
  for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
});

test("a tree centres a parent over its children", () => {
  const scene = layoutDiagram(TREE);
  const at = new Map(scene.boxes.map((b) => [b.id, b]));
  const centre = (id: string) => at.get(id)!.x + at.get(id)!.w / 2;
  const kids = ["self", "cross", "sparse"].map(centre);
  expect(centre("att")).toBeCloseTo((Math.min(...kids) + Math.max(...kids)) / 2, 0);
});

// --- the invariant the feature rests on ------------------------------------

const STAGED = build({
  ...FLOW,
  stages: [
    { title: "Project", nodes: ["x", "wq", "wk", "wv"], edges: ["x->wq", "x->wk", "x->wv"] },
    { title: "Q, K, V", nodes: ["q", "k", "v"], edges: ["wq->q", "wk->k", "wv->v"] },
    { title: "Score", nodes: ["scores", "sm"], edges: ["q->scores", "k->scores", "scores->sm"] },
    { title: "Combine", nodes: ["out"], edges: ["sm->out", "v->out"] },
  ],
});

test("stepping through the stages never moves anything", () => {
  const first = geometry(layoutDiagram(STAGED, { stage: 0 }));
  for (const stage of [1, 2, 3]) {
    expect(geometry(layoutDiagram(STAGED, { stage }))).toBe(first);
  }
  // And the whole diagram, unstaged, is laid out identically too — a stage is a
  // view over the finished picture, never a smaller picture.
  expect(geometry(layoutDiagram(FLOW))).toBe(first);
});

test("a highlight never moves anything either", () => {
  const lit = build({ ...FLOW, focus: { path: ["x", "wq", "q", "scores"] } });
  expect(geometry(layoutDiagram(lit))).toBe(geometry(layoutDiagram(FLOW)));
});

test("a stage shows what it and its predecessors named, and ghosts the rest", () => {
  const { nodes } = resolveEmphasis(STAGED, { stage: 1 });
  expect(nodes.get("x")).toBe("full");
  expect(nodes.get("wq")).toBe("full");
  expect(nodes.get("q")).toBe("full");
  expect(nodes.get("scores")).toBe("ghost");
  expect(nodes.get("out")).toBe("ghost");
});

test("the last stage leaves nothing ghosted", () => {
  const { nodes, edges } = resolveEmphasis(STAGED, { stage: 3 });
  expect([...nodes.values()].filter((e) => e === "ghost")).toEqual([]);
  expect([...edges.values()].filter((e) => e === "ghost")).toEqual([]);
});

test("an edge is a ghost while either end still is", () => {
  // Stage 0 names no edge into `q`, and `q` itself is not introduced yet.
  const { edges } = resolveEmphasis(STAGED, { stage: 0 });
  expect(edges.get("wq->q")).toBe("ghost");
  expect(edges.get("x->wq")).toBe("full");
});

test("a highlight lights its path and dims everything else", () => {
  const lit = build({ ...FLOW, focus: { path: ["x", "wq", "q", "scores"] } });
  const { nodes, edges } = resolveEmphasis(lit);
  expect(nodes.get("x")).toBe("lit");
  expect(nodes.get("wq")).toBe("lit");
  expect(nodes.get("k")).toBe("dim");
  expect(edges.get("x->wq")).toBe("lit");
  expect(edges.get("x->wk")).toBe("dim");
});

test("a path resolves the edges between its stops, in either direction", () => {
  // wq -> q is written that way round; asking for the walk backwards still finds it.
  const back = resolveFocus(FLOW, { path: ["q", "wq", "x"] });
  expect([...back.edges].sort()).toEqual(["wq->q", "x->wq"]);
});

test("a stage's own highlight dims what the earlier stages introduced", () => {
  const staged = build({
    ...FLOW,
    stages: [
      { title: "one", nodes: ["x", "wq", "wk"], edges: ["x->wq", "x->wk"] },
      { title: "two", nodes: ["q", "k"], edges: ["wq->q", "wk->k"], focus: { path: ["wq", "q"] } },
    ],
  });
  const { nodes } = resolveEmphasis(staged, { stage: 1 });
  expect(nodes.get("wq")).toBe("lit");
  expect(nodes.get("wk")).toBe("dim");
});

test("the caption follows the stage the reader is on", () => {
  const staged = build({
    ...FLOW,
    caption: "the whole thing",
    stages: [
      { title: "one", caption: "first this", nodes: ["x"] },
      { title: "two", caption: "then this", nodes: ["wq", "wk", "wv"] },
    ],
  });
  expect(resolveEmphasis(staged, { stage: 0 }).caption).toBe("first this");
  expect(resolveEmphasis(staged, { stage: 1 }).caption).toBe("then this");
});

// --- graphs that would otherwise hang or fold ------------------------------

test("a cycle is laid out rather than looped over forever", () => {
  const cyclic = build({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }],
  });
  const scene = layoutDiagram(cyclic);
  expect(scene.boxes).toHaveLength(3);
  expect(scene.edges).toHaveLength(3);
});

test("a tree given a cycle still terminates and draws every node", () => {
  const cyclic = build({
    layout: "tree",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }],
  });
  expect(layoutDiagram(cyclic).boxes).toHaveLength(2);
});

test("a diagram with no edges still places its nodes side by side", () => {
  const bare = build({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
  });
  const scene = layoutDiagram(bare);
  expect(scene.boxes).toHaveLength(3);
  expect(new Set(scene.boxes.map((b) => b.y)).size).toBe(1);
});

test("an empty diagram is an empty scene, not a crash", () => {
  const scene = layoutDiagram(build({ layout: "flow", nodes: [] }));
  expect(scene.width).toBe(0);
  expect(scene.boxes).toEqual([]);
});

test("a stage index out of range is clamped rather than blanking the picture", () => {
  expect(geometry(layoutDiagram(STAGED, { stage: 99 }))).toBe(geometry(layoutDiagram(STAGED, { stage: 3 })));
  expect(geometry(layoutDiagram(STAGED, { stage: -5 }))).toBe(geometry(layoutDiagram(STAGED, { stage: 0 })));
});

test("layout is deterministic", () => {
  for (const [, diagram] of ALL) {
    expect(geometry(layoutDiagram(diagram))).toBe(geometry(layoutDiagram(diagram)));
  }
});
