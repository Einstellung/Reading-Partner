// The drawing. Mostly one thing: a diagram is model output rendered as markup,
// so the escaping is the boundary and not a tidiness question. The rest pins the
// paint order and that emphasis is opacity on a group rather than a second
// geometry — which is what lets the same scene serve every stage.

import { expect, test } from "bun:test";
import { layoutDiagram } from "../../../src/reading/diagrams/layout";
import { normalizeDiagram } from "../../../src/reading/diagrams/normalize";
import { sceneToSvg, serializeSvg, type SvgNode } from "../../../src/reading/diagrams/svg";

function draw(input: unknown, stage?: number): string {
  const { diagram } = normalizeDiagram(input);
  return serializeSvg(
    sceneToSvg(layoutDiagram(diagram, stage === undefined ? {} : { stage }), {
      title: diagram.title,
    }),
  );
}

const SIMPLE = {
  layout: "flow",
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  edges: [{ from: "a", to: "b" }],
};

test("a label carrying markup is escaped, not embedded", () => {
  const svg = draw({
    layout: "flow",
    title: '</svg><script>alert("x")</script>',
    nodes: [
      { id: "a", label: "<script>alert(1)</script>" },
      { id: "b", label: 'a & b "quoted"' },
    ],
    edges: [{ from: "a", to: "b", label: "<img onerror=x>" }],
  });
  expect(svg).not.toContain("<script>");
  expect(svg).not.toContain("<img");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain("&amp;");
  // The one <svg> tag is the one this module opened, and it is closed once.
  expect(svg.match(/<svg/g)).toHaveLength(1);
  expect(svg.match(/<\/svg>/g)).toHaveLength(1);
});

test("an attribute value cannot break out of its quotes", () => {
  const node: SvgNode = { tag: "rect", attrs: { id: 'x" onload="alert(1)' } };
  expect(serializeSvg(node)).toBe('<rect id="x&quot; onload=&quot;alert(1)"/>');
});

test("the picture is a self-contained SVG document with no external reference", () => {
  const svg = draw(SIMPLE);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  // The xmlns is a namespace name, not an address anything is fetched from; any
  // other URL in here would be.
  expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\//);
  expect(svg).not.toContain("<image");
  expect(svg).not.toContain("url(");
});

test("it carries a title for anything reading it aloud", () => {
  const svg = draw({ ...SIMPLE, title: "How attention works" });
  expect(svg).toContain("<title>How attention works</title>");
  expect(svg).toContain('role="img"');
});

test("dimming and ghosting are opacity, and nothing else moves", () => {
  // A third node, so the highlight has something to dim: a focus that names
  // every node lights the lot and dims nothing.
  const three = {
    layout: "flow",
    nodes: [...SIMPLE.nodes, { id: "c", label: "C" }],
    edges: [...SIMPLE.edges, { from: "a", to: "c" }],
  };
  const plain = draw(three);
  const lit = draw({ ...three, focus: { path: ["a", "b"] } });
  expect(plain).not.toContain("opacity");
  expect(lit).toContain("opacity");
  // Every path in the plain drawing is still there, at the same coordinates.
  for (const d of plain.match(/ d="[^"]+"/g) ?? []) expect(lit).toContain(d);
});

test("a ghost is fainter than a dim", () => {
  const staged = draw(
    {
      ...SIMPLE,
      nodes: [...SIMPLE.nodes, { id: "c", label: "C" }],
      edges: [...SIMPLE.edges, { from: "b", to: "c" }],
      stages: [
        { title: "one", nodes: ["a"] },
        { title: "two", nodes: ["b"], edges: ["a->b"] },
      ],
    },
    0,
  );
  const values = [...staged.matchAll(/opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  expect(Math.min(...values)).toBeLessThan(0.15);
});

test("boxes are painted after edges, so a line never crosses a label", () => {
  const svg = draw(SIMPLE);
  // The first <rect ... rx= is a node box; every <path d="M is an edge.
  expect(svg.indexOf('<path d="M')).toBeLessThan(svg.indexOf("<rect"));
});

test("an edge label gets a chip behind it rather than printing over the line", () => {
  const svg = draw({ ...SIMPLE, edges: [{ from: "a", to: "b", label: "then" }] });
  expect(svg).toContain(">then<");
  expect(svg).toContain('fill="#ffffff"');
});

test("a node's tone changes its colour and nothing else", () => {
  const plain = draw({ layout: "flow", nodes: [{ id: "a", label: "A" }] });
  const primary = draw({ layout: "flow", nodes: [{ id: "a", label: "A", tone: "primary" }] });
  expect(primary).toContain("#6c4fd0");
  expect(primary.match(/viewBox="[^"]+"/)![0]).toBe(plain.match(/viewBox="[^"]+"/)![0]);
});

test("every shape draws as something", () => {
  for (const shape of ["box", "round", "pill", "diamond", "cylinder", "note"]) {
    const svg = draw({ layout: "flow", nodes: [{ id: "a", label: "A", shape }] });
    expect(svg).toMatch(/<(rect|polygon|path)/);
  }
});

test("serialising is deterministic", () => {
  expect(draw(SIMPLE)).toBe(draw(SIMPLE));
});
