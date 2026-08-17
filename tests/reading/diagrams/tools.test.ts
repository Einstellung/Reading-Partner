// The two tools, driven through a stand-in for the chat rows they write to.

import { expect, test } from "bun:test";
import { buildDiagramTools } from "../../../src/reading/diagrams/tools";
import type { Diagram } from "../../../src/reading/diagrams/types";

function harness() {
  const drawn = new Map<string, Diagram>();
  let n = 0;
  const tools = buildDiagramTools({
    draw: (diagram) => {
      const id = `diagram-${++n}`;
      drawn.set(id, diagram);
      return id;
    },
    read: (id) => drawn.get(id) ?? null,
    update: (id, diagram) => {
      drawn.set(id, diagram);
    },
  });
  const call = (name: string, args: Record<string, unknown>) =>
    tools.find((t) => t.name === name)!.execute(args as never) as Promise<string>;
  return { drawn, tools, call };
}

const SIMPLE = {
  layout: "flow",
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

test("both tools are mounted", () => {
  expect(harness().tools.map((t) => t.name)).toEqual(["draw_diagram", "update_diagram"]);
});

test("drawing returns the id the model must use to edit it", async () => {
  const h = harness();
  const said = await h.call("draw_diagram", { diagram: SIMPLE });
  expect(said).toContain("diagram-1");
  expect(said).toContain("update_diagram");
  expect(h.drawn.get("diagram-1")!.nodes).toHaveLength(3);
});

test("the model is told not to draw the same picture twice", async () => {
  const said = await harness().call("draw_diagram", { diagram: SIMPLE });
  expect(said).toContain("Do not call draw_diagram again");
});

test("repairs are reported back with the id", async () => {
  const said = await harness().call("draw_diagram", {
    diagram: { ...SIMPLE, edges: [...SIMPLE.edges, { from: "a", to: "nope" }] },
  });
  expect(said).toContain("Adjusted on the way in");
  expect(said).toContain("nope");
});

test("a diagram with nothing in it draws nothing and says why", async () => {
  const h = harness();
  const said = await h.call("draw_diagram", { diagram: { layout: "flow", nodes: [] } });
  expect(said).toContain("Nothing was drawn");
  expect(h.drawn.size).toBe(0);
});

test("a staged diagram tells the model the reader can step through it", async () => {
  const said = await harness().call("draw_diagram", {
    diagram: {
      ...SIMPLE,
      stages: [
        { title: "one", nodes: ["a"] },
        { title: "two", nodes: ["b", "c"] },
      ],
    },
  });
  expect(said).toContain("2 stages");
});

test("editing puts a highlight on the diagram already there", async () => {
  const h = harness();
  await h.call("draw_diagram", { diagram: SIMPLE });
  const said = await h.call("update_diagram", {
    diagram_id: "diagram-1",
    focus: { path: ["a", "b"], label: "just this bit" },
  });
  expect(said).toContain("set the highlight");
  expect(h.drawn.get("diagram-1")!.focus?.path).toEqual(["a", "b"]);
  expect(h.drawn.size).toBe(1);
});

test("editing can break a finished diagram into steps", async () => {
  const h = harness();
  await h.call("draw_diagram", { diagram: SIMPLE });
  await h.call("update_diagram", {
    diagram_id: "diagram-1",
    stages: [
      { title: "one", nodes: ["a"], edges: [] },
      { title: "two", nodes: ["b"], edges: ["a->b"] },
    ],
  });
  const after = h.drawn.get("diagram-1")!;
  expect(after.stages).toHaveLength(2);
  // The last stage is completed, so nothing is left ghosted for good.
  expect(after.stages![1].nodes).toContain("c");
});

test("clear_focus and clear_stages put it back", async () => {
  const h = harness();
  await h.call("draw_diagram", { diagram: { ...SIMPLE, focus: { path: ["a", "b"] } } });
  await h.call("update_diagram", { diagram_id: "diagram-1", clear_focus: true });
  expect(h.drawn.get("diagram-1")!.focus).toBeUndefined();
});

test("an unknown id is refused with what to do instead", async () => {
  const said = await harness().call("update_diagram", { diagram_id: "nope", focus: { path: ["a"] } });
  expect(said).toContain("No diagram");
  expect(said).toContain("draw_diagram");
});

test("an edit that changes nothing says so rather than rewriting the card", async () => {
  const h = harness();
  await h.call("draw_diagram", { diagram: SIMPLE });
  expect(await h.call("update_diagram", { diagram_id: "diagram-1" })).toContain("Nothing to change");
});

test("an edit that would empty the diagram is refused and the old one stands", async () => {
  const h = harness();
  await h.call("draw_diagram", { diagram: SIMPLE });
  const said = await h.call("update_diagram", {
    diagram_id: "diagram-1",
    remove_nodes: ["a", "b", "c"],
  });
  expect(said).toContain("not applied");
  expect(h.drawn.get("diagram-1")!.nodes).toHaveLength(3);
});

test("an edit goes through the same checks a fresh diagram does", async () => {
  const h = harness();
  await h.call("draw_diagram", { diagram: SIMPLE });
  const said = await h.call("update_diagram", {
    diagram_id: "diagram-1",
    edges: [{ from: "a", to: "missing" }],
  });
  expect(said).toContain("missing");
  expect(h.drawn.get("diagram-1")!.edges!.some((e) => e.to === "missing")).toBe(false);
});

test("the tool descriptions tell the model not to write SVG or coordinates", () => {
  const draw = harness().tools[0];
  expect(draw.description).toContain("never write SVG");
  expect(draw.description).toContain("never give coordinates");
});
