// The diagram chat card (src/ui/components/diagram/DiagramCard.tsx): that the
// registry covers its kind, that a drawn diagram is durable, and that what
// reaches the page is the picture the layout computed rather than anything the
// component decided for itself. Rendered to static markup — the card holds one
// piece of view state and no effects, so no DOM is needed.
// Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_REGISTRY } from "../../../src/ui/components/cardRegistry";
import { DiagramChatCard } from "../../../src/ui/components/diagram/DiagramCard";
import { isPersistableCardKind } from "../../../src/ui/components/chat/chatParts";
import { normalizeDiagram } from "../../../src/reading/diagrams/normalize";
import type { DiagramCardData } from "../../../src/reading/diagrams/cards";

function card(input: unknown, stage?: number): DiagramCardData {
  return {
    kind: "diagram",
    diagram: normalizeDiagram(input).diagram,
    ...(stage === undefined ? {} : { stage }),
  };
}

function render(payload: DiagramCardData): string {
  return renderToStaticMarkup(
    <DiagramChatCard payload={payload} dispatch={() => {}} surface="call" />,
  );
}

const ATTENTION = {
  layout: "flow",
  title: "缩放点积注意力",
  nodes: [
    { id: "x", label: "输入 X", sub: "[B, T, C]" },
    { id: "q", label: "Q" },
    { id: "k", label: "K" },
    { id: "out", label: "注意力输出" },
  ],
  edges: [
    { from: "x", to: "q" },
    { from: "x", to: "k" },
    { from: "q", to: "out" },
    { from: "k", to: "out" },
  ],
  caption: "同一个输入的三个投影。",
  source: { figure: "2", page: 4 },
};

const STAGED = {
  ...ATTENTION,
  stages: [
    { title: "投影", nodes: ["x"], caption: "先看输入。" },
    { title: "Q 和 K", nodes: ["q", "k"], edges: ["x->q", "x->k"], caption: "投影出 Q 和 K。" },
    { title: "合成", nodes: ["out"], edges: ["q->out", "k->out"], caption: "加权求和。" },
  ],
};

test("the registry covers the diagram kind", () => {
  expect(CARD_REGISTRY.diagram).toBe(DiagramChatCard);
});

// A diagram is part of the explanation around it: prose pointing at a picture
// that is no longer there is worse than never having drawn it.
test("a drawn diagram is durable", () => {
  expect(isPersistableCardKind("diagram")).toBe(true);
});

test("the labels the model wrote reach the page, Chinese included", () => {
  const html = render(card(ATTENTION));
  for (const label of ["输入 X", "[B, T, C]", "注意力输出", "缩放点积注意力"]) {
    expect(html).toContain(label);
  }
});

test("the picture is an inline svg with no external reference", () => {
  const html = render(card(ATTENTION));
  expect(html).toContain("<svg");
  expect(html).toContain('viewBox="0 0');
  expect(html.replace(/xmlns="[^"]*"/g, "")).not.toMatch(/https?:\/\//);
  expect(html).not.toContain("<img");
});

test("the caption and the source it was redrawn from are shown", () => {
  const html = render(card(ATTENTION));
  expect(html).toContain("同一个输入的三个投影。");
  expect(html).toContain("Redrawn from Figure 2, p.4");
});

test("an unstaged diagram has no stepper", () => {
  const html = render(card(ATTENTION));
  expect(html).not.toContain("<button");
  expect(html).not.toContain("aria-current");
});

test("a staged diagram gets one step control per stage, numbered and named", () => {
  const html = render(card(STAGED));
  expect(html).toContain("1. 投影");
  expect(html).toContain("2. Q 和 K");
  expect(html).toContain("3. 合成");
  expect(html.match(/aria-current="step"/g)).toHaveLength(1);
});

test("the card opens on the step the payload remembers, not back at the start", () => {
  expect(render(card(STAGED, 2))).toContain("加权求和。");
  expect(render(card(STAGED, 0))).toContain("先看输入。");
});

test("a remembered step past the end is clamped rather than blanking the card", () => {
  expect(render(card(STAGED, 99))).toContain("加权求和。");
});

test("a diagram with nothing in it renders nothing at all", () => {
  expect(render(card({ layout: "flow", nodes: [] }))).toBe("");
});

test("a label carrying markup is escaped by the render, not embedded", () => {
  const html = render(
    card({
      layout: "flow",
      nodes: [{ id: "a", label: "<script>alert(1)</script>" }],
    }),
  );
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

// React 18 renders a hyphenated SVG attribute but warns about every one, so the
// tree's names are camel-cased for React and must still come out hyphenated in
// the markup (docs/pitfall/136). Asserting the output is the only way to catch a
// mapping that quietly dropped an attribute instead of renaming it.
test("svg attributes survive the trip through React with their real names", () => {
  const html = render(card(ATTENTION));
  for (const attr of ["stroke-width=", "text-anchor=", "font-size=", "font-family="]) {
    expect(html).toContain(attr);
  }
  expect(html).not.toContain("strokeWidth");
  expect(html).not.toContain("textAnchor");
});
