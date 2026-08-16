// The SvgNode tree from reading/diagrams/svg.ts, as React elements.
//
// This is the whole component: a recursive map from one plain-data tag to one
// element. It holds no opinion about colour, size or placement — those are all
// decided in the .ts modules, which is what lets the same tree be serialised to
// a file and checked without a browser. If something looks wrong in the app, the
// file rendered from the same tree looks wrong in the same way.
//
// Text goes through React's children rather than through innerHTML, so a label
// the model wrote is escaped by React and never parsed as markup.

import { createElement, type ReactElement } from "react";

import type { SvgNode } from "../../../reading/diagrams/svg";

// SVG spells its attributes with hyphens (`stroke-width`, `text-anchor`) and so
// does the tree, because the serialiser writes real SVG. React 18 renders those
// correctly but warns "Invalid DOM property" for every one of them, which is a
// console full of noise on every diagram — React 19 accepts them, this project is
// on 18 (docs/pitfall/134). So they are camel-cased on the way in.
//
// `aria-*` and `data-*` are the exception in React's own API: those stay
// hyphenated, and camel-casing them would break the attribute instead of fixing
// a warning.
const reactAttrs = (attrs: Record<string, string | number>): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const name =
      key.startsWith("aria-") || key.startsWith("data-")
        ? key
        : key.replace(/-([a-z])/g, (_all, c: string) => c.toUpperCase());
    out[name] = value;
  }
  return out;
};

function toElement(node: SvgNode, key: number | string): ReactElement {
  const children = (node.children ?? []).map((child, i) => toElement(child, i));
  return createElement(
    node.tag,
    { key, ...reactAttrs(node.attrs) },
    ...(node.text !== undefined ? [node.text] : []),
    ...children,
  );
}

export function SvgFigure({ node }: { node: SvgNode }) {
  return toElement(node, "root");
}
