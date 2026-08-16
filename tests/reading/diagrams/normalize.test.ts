// What the model gets wrong, and what happens to it.
//
// Every case here is a repair rather than a rejection, and every repair reports
// itself. That pairing is the contract: the reader never sees a broken picture,
// and the model is told exactly what was changed so the next call is right. A
// silent repair would have the model drawing the same dangling edge forever.

import { expect, test } from "bun:test";
import { normalizeDiagram, withEdgeIds } from "../../../src/reading/diagrams/normalize";

const said = (problems: string[], text: string) => problems.some((p) => p.includes(text));

test("an edge to a node that does not exist is dropped and named", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }],
    edges: [{ from: "a", to: "ghost" }],
  });
  expect(diagram.edges ?? []).toEqual([]);
  expect(said(problems, "ghost")).toBe(true);
});

test("a repeated node id keeps the first and reports the second", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [
      { id: "a", label: "First" },
      { id: "a", label: "Second" },
    ],
  });
  expect(diagram.nodes).toHaveLength(1);
  expect(diagram.nodes[0].label).toBe("First");
  expect(said(problems, "share the id")).toBe(true);
});

test("a node with no id goes; a node with no label borrows its id", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ label: "nameless" }, { id: "b" }],
  });
  expect(diagram.nodes.map((n) => n.id)).toEqual(["b"]);
  expect(diagram.nodes[0].label).toBe("b");
  expect(said(problems, "no id")).toBe(true);
});

test("a paragraph in a node label is clipped and the model is told where it belongs", () => {
  const long = "This is a whole sentence that has no business being inside a box on a diagram at all";
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: long }],
  });
  expect(diagram.nodes[0].label.length).toBeLessThan(long.length);
  expect(diagram.nodes[0].label.endsWith("…")).toBe(true);
  expect(said(problems, "note")).toBe(true);
});

test("an invented shape or tone falls back rather than failing the call", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A", shape: "hexagon", tone: "rainbow" }],
  });
  expect(diagram.nodes[0].shape).toBeUndefined();
  expect(diagram.nodes[0].tone).toBeUndefined();
  expect(said(problems, "hexagon")).toBe(true);
  expect(said(problems, "rainbow")).toBe(true);
});

test("an unknown layout is drawn as a flow and reported", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "mindmap",
    nodes: [{ id: "a", label: "A" }],
  });
  expect(diagram.layout).toBe("flow");
  expect(said(problems, "mindmap")).toBe(true);
});

test("two edges between the same pair stay separately addressable", () => {
  const { diagram } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "b", label: "again" }],
  });
  expect(withEdgeIds(diagram).map((e) => e.id)).toEqual(["a->b", "a->b#2"]);
});

test("a group keeps only the members that exist, and an empty one goes", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }],
    groups: [
      { id: "g", members: ["a", "nope"] },
      { id: "empty", members: ["also-nope"] },
    ],
  });
  expect(diagram.groups).toHaveLength(1);
  expect(diagram.groups![0].members).toEqual(["a"]);
  expect(said(problems, "no members that exist")).toBe(true);
});

test("groups that nest in a loop lose the parent instead of hanging the layout", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    groups: [
      { id: "g1", members: ["a"], parent: "g2" },
      { id: "g2", members: ["b"], parent: "g1" },
    ],
  });
  // The repair is minimal: one link is cut, not both, and what is left is a
  // chain that terminates.
  const byId = new Map(diagram.groups!.map((g) => [g.id, g]));
  for (const g of diagram.groups!) {
    const seen = new Set([g.id]);
    let cursor = g.parent;
    while (cursor) {
      expect(seen.has(cursor)).toBe(false);
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent;
    }
  }
  expect(said(problems, "loop")).toBe(true);
});

test("in a stack a node in no band gets one, and the model is told the rule", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "stack",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    groups: [{ id: "band", members: ["a"] }],
  });
  const banded = new Set((diagram.groups ?? []).flatMap((g) => g.members));
  expect(banded.has("b")).toBe(true);
  expect(said(problems, "a band is a group")).toBe(true);
});

test("in a sequence a group frames edges, so a node id in one is not a member", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "sequence",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ from: "a", to: "b" }],
    groups: [{ id: "g", members: ["a->b", "a"] }],
  });
  expect(diagram.groups![0].members).toEqual(["a->b"]);
  expect(said(problems, "not in this diagram")).toBe(true);
});

test("a highlight naming nothing real is dropped rather than dimming everything", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }],
    focus: { path: ["nope", "also-nope"] },
  });
  expect(diagram.focus).toBeUndefined();
  expect(said(problems, "highlights nothing that exists")).toBe(true);
});

test("the last stage is completed so nothing is left a ghost forever", () => {
  const { diagram } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    stages: [
      { title: "one", nodes: ["a"] },
      { title: "two", nodes: ["b"], edges: ["a->b"] },
    ],
  });
  const last = diagram.stages![1];
  expect(last.nodes).toContain("c");
  expect(last.edges).toContain("b->c");
});

test("one stage is not a build-up and is dropped", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }],
    stages: [{ title: "only", nodes: ["a"] }],
  });
  expect(diagram.stages).toBeUndefined();
  expect(said(problems, "not a build-up")).toBe(true);
});

test("stages win over a top-level highlight, and the clash is reported", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    focus: { nodes: ["a"] },
    stages: [{ title: "one", nodes: ["a"] }, { title: "two", nodes: ["b"] }],
  });
  expect(diagram.focus).toBeUndefined();
  expect(diagram.stages).toHaveLength(2);
  expect(said(problems, "takes its highlight from each stage")).toBe(true);
});

test("a note pointing at nothing goes; one pointing at a group stays", () => {
  const { diagram, problems } = normalizeDiagram({
    layout: "flow",
    nodes: [{ id: "a", label: "A" }],
    groups: [{ id: "g", members: ["a"] }],
    notes: [
      { attach: "g", text: "about the group" },
      { attach: "nowhere", text: "about nothing" },
    ],
  });
  expect(diagram.notes).toHaveLength(1);
  expect(said(problems, "nowhere")).toBe(true);
});

test("a diagram with no nodes says so instead of drawing an empty box", () => {
  const { diagram, problems } = normalizeDiagram({ layout: "flow", nodes: [] });
  expect(diagram.nodes).toEqual([]);
  expect(said(problems, "nothing to draw")).toBe(true);
});

test("garbage in is an empty diagram out, not a throw", () => {
  for (const input of [null, undefined, 42, "flow", [], { nodes: "not an array" }]) {
    expect(() => normalizeDiagram(input)).not.toThrow();
    expect(normalizeDiagram(input).diagram.nodes).toEqual([]);
  }
});

test("a clean diagram is reported clean", () => {
  const { problems } = normalizeDiagram({
    layout: "flow",
    title: "Fine",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ from: "a", to: "b", label: "then" }],
  });
  expect(problems).toEqual([]);
});

test("normalizing twice changes nothing the second time", () => {
  const once = normalizeDiagram({
    layout: "stack",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    groups: [{ id: "g", members: ["a"] }],
    edges: [{ from: "a", to: "b" }],
  }).diagram;
  const twice = normalizeDiagram(once);
  expect(twice.diagram).toEqual(once);
  expect(twice.problems).toEqual([]);
});
