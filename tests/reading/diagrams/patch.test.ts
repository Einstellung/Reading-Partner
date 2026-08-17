// Editing a diagram already on screen. The cases that matter are the two the
// feature exists for — put a highlight on it, break it into stages — plus the
// merges that must not lose anything.

import { expect, test } from "bun:test";
import { normalizeDiagram } from "../../../src/reading/diagrams/normalize";
import { applyDiagramPatch, describePatch } from "../../../src/reading/diagrams/patch";
import type { Diagram } from "../../../src/reading/diagrams/types";

const base: Diagram = normalizeDiagram({
  layout: "flow",
  title: "Attention",
  nodes: [
    { id: "x", label: "Input" },
    { id: "q", label: "Q" },
    { id: "k", label: "K" },
    { id: "out", label: "Output" },
  ],
  edges: [
    { from: "x", to: "q" },
    { from: "x", to: "k" },
    { from: "q", to: "out" },
    { from: "k", to: "out" },
  ],
  groups: [{ id: "proj", label: "Projections", members: ["q", "k"] }],
}).diagram;

test("a highlight can be put on and taken off again", () => {
  const lit = applyDiagramPatch(base, { focus: { path: ["x", "q", "out"] } });
  expect(lit.focus?.path).toEqual(["x", "q", "out"]);
  expect(applyDiagramPatch(lit, { focus: null }).focus).toBeUndefined();
});

test("stages can be added to a finished diagram and dropped again", () => {
  const staged = applyDiagramPatch(base, {
    stages: [
      { title: "one", nodes: ["x"] },
      { title: "two", nodes: ["q", "k"] },
    ],
  });
  expect(staged.stages).toHaveLength(2);
  expect(applyDiagramPatch(staged, { stages: null }).stages).toBeUndefined();
});

test("a node with an id already there is replaced, not duplicated", () => {
  const next = applyDiagramPatch(base, { nodes: [{ id: "q", label: "Query", tone: "primary" }] });
  expect(next.nodes).toHaveLength(4);
  expect(next.nodes.find((n) => n.id === "q")).toEqual({ id: "q", label: "Query", tone: "primary" });
});

test("a new node is appended", () => {
  const next = applyDiagramPatch(base, { nodes: [{ id: "v", label: "V" }] });
  expect(next.nodes.map((n) => n.id)).toEqual(["x", "q", "k", "out", "v"]);
});

test("an edge merges on the id it is addressed by, without one being given", () => {
  const next = applyDiagramPatch(base, { edges: [{ from: "x", to: "q", label: "project" }] });
  expect(next.edges).toHaveLength(4);
  expect(next.edges!.find((e) => e.from === "x" && e.to === "q")!.label).toBe("project");
});

test("removing a node takes its edges and its group membership with it", () => {
  const next = applyDiagramPatch(base, { removeNodes: ["k"] });
  expect(next.nodes.map((n) => n.id)).toEqual(["x", "q", "out"]);
  expect(next.edges!.some((e) => e.from === "k" || e.to === "k")).toBe(false);
  expect(next.groups!.find((g) => g.id === "proj")!.members).toEqual(["q"]);
});

test("a group emptied by a removal goes rather than leaving a frame round nothing", () => {
  const next = applyDiagramPatch(base, { removeNodes: ["q", "k"] });
  expect(next.groups).toEqual([]);
});

test("an edge can be removed by its id", () => {
  const next = applyDiagramPatch(base, { removeEdges: ["x->k"] });
  expect(next.edges!.some((e) => e.from === "x" && e.to === "k")).toBe(false);
  expect(next.edges).toHaveLength(3);
});

test("what a patch left alone is left alone", () => {
  const next = applyDiagramPatch(base, { caption: "look here" });
  expect(next.nodes).toEqual(base.nodes);
  expect(next.edges).toEqual(base.edges);
  expect(next.title).toBe("Attention");
  expect(next.caption).toBe("look here");
});

test("the original is not touched", () => {
  const before = JSON.stringify(base);
  applyDiagramPatch(base, { removeNodes: ["q"], nodes: [{ id: "z", label: "Z" }] });
  expect(JSON.stringify(base)).toBe(before);
});

// The patch result goes back through normalize, so an edit that leaves a
// dangling reference is caught by the same pass a fresh diagram takes rather
// than by a second set of rules in the patcher.
test("an edge added in the same patch that removes its node goes with it", () => {
  const next = applyDiagramPatch(base, {
    removeNodes: ["out"],
    edges: [{ from: "q", to: "out" }],
  });
  expect(next.edges!.some((e) => e.to === "out")).toBe(false);
});

test("an edit that would dangle is cleaned up by the pass that follows it", () => {
  const broken = applyDiagramPatch(base, { edges: [{ from: "q", to: "nonexistent" }] });
  const { diagram, problems } = normalizeDiagram(broken);
  expect(diagram.edges!.some((e) => e.to === "nonexistent")).toBe(false);
  expect(problems.some((p) => p.includes("nonexistent"))).toBe(true);
});

test("the account of an edit names what changed", () => {
  expect(describePatch({ focus: { path: ["a"] } })).toBe("set the highlight");
  expect(describePatch({ focus: null })).toBe("cleared the highlight");
  expect(describePatch({})).toBe("nothing");
  expect(describePatch({ nodes: [{ id: "a", label: "A" }], removeEdges: ["x->y"] })).toBe(
    "1 node(s) added or replaced, 1 edge(s) removed",
  );
});
