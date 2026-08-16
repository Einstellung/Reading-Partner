// The drawing. A Scene in, a tree of SVG elements out.
//
// The tree is plain data rather than JSX because it has two consumers that must
// not drift: the card renders it as React (DiagramFigure.tsx maps this tree to
// elements, and nothing else), and `serializeSvg` writes it as a standalone file
// for tests and for anything that needs a picture without a browser. One
// geometry, one element tree, two emitters that each do nothing but translate.
//
// Colours are literal hex, not var(--token). The palette is the app's own values
// from styles.css, copied here on purpose: a serialised file has no stylesheet
// to resolve a variable against, and a diagram that renders differently in the
// app than in the file it was checked against is a diagram nobody has checked.

import {
  EDGE_FONT_SIZE,
  FONT_SIZE,
  GROUP_FONT_SIZE,
  LINE_HEIGHT,
  NOTE_FONT_SIZE,
  SUB_FONT_SIZE,
  SUB_LINE_HEIGHT,
  type Emphasis,
  type Scene,
  type SceneBox,
  type SceneEdge,
} from "./scene";
import { FONT_STACK } from "./text";
import type { DiagramTone } from "./types";

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  // Text content. Only ever set on <text>/<tspan>; escaped by both emitters.
  text?: string;
  children?: SvgNode[];
}

// The app's palette (src/styles.css), as literals. `line` is what an edge is
// drawn in; `ink` is text.
const PALETTE = {
  ink: "#1b1b1b",
  inkSoft: "#555555",
  line: "#9a9a9a",
  surface: "#ffffff",
  border: "#d3d3d3",
  accent: "#6c4fd0",
  accentInk: "#3f2f8a",
  accentSurface: "#f4f1fd",
  muted: "#f5f5f4",
  mutedBorder: "#dcdcdc",
  warn: "#b03a2e",
  warnSurface: "#fdf5f3",
  warnBorder: "#e6c3bd",
  groupBorder: "#cfcbe4",
  groupInk: "#8a7fd0",
} as const;

// How strongly a thing is painted. `dim` is the "everything except the path you
// asked about" state and `ghost` is "not introduced by this stage yet" — both
// are opacity on a group rather than a second palette, so one element tree
// serves every state and the geometry underneath is provably identical.
const OPACITY: Record<Emphasis, number> = { full: 1, lit: 1, dim: 0.3, ghost: 0.11 };

function toneColours(tone: DiagramTone): { fill: string; stroke: string; ink: string } {
  switch (tone) {
    case "primary":
      return { fill: PALETTE.accentSurface, stroke: PALETTE.accent, ink: PALETTE.accentInk };
    case "muted":
      return { fill: PALETTE.muted, stroke: PALETTE.mutedBorder, ink: PALETTE.inkSoft };
    case "warn":
      return { fill: PALETTE.warnSurface, stroke: PALETTE.warnBorder, ink: PALETTE.warn };
    default:
      return { fill: PALETTE.surface, stroke: PALETTE.border, ink: PALETTE.ink };
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- shapes ----------------------------------------------------------------

function shapeNode(box: SceneBox, fill: string, stroke: string, width: number): SvgNode {
  const { x, y, w, h } = box;
  const common = { fill, stroke, "stroke-width": width };
  switch (box.shape) {
    case "pill":
      return { tag: "rect", attrs: { x, y, width: w, height: h, rx: h / 2, ...common } };
    case "round":
      return { tag: "rect", attrs: { x, y, width: w, height: h, rx: 14, ...common } };
    case "diamond":
      return {
        tag: "polygon",
        attrs: {
          points: `${round(x + w / 2)},${round(y)} ${round(x + w)},${round(y + h / 2)} ${round(x + w / 2)},${round(y + h)} ${round(x)},${round(y + h / 2)}`,
          ...common,
        },
      };
    case "cylinder": {
      const r = 6;
      const d =
        `M ${round(x)} ${round(y + r)} ` +
        `A ${round(w / 2)} ${r} 0 0 1 ${round(x + w)} ${round(y + r)} ` +
        `L ${round(x + w)} ${round(y + h - r)} ` +
        `A ${round(w / 2)} ${r} 0 0 1 ${round(x)} ${round(y + h - r)} Z`;
      return { tag: "path", attrs: { d, ...common } };
    }
    case "note": {
      const fold = 10;
      const d =
        `M ${round(x)} ${round(y)} L ${round(x + w - fold)} ${round(y)} ` +
        `L ${round(x + w)} ${round(y + fold)} L ${round(x + w)} ${round(y + h)} ` +
        `L ${round(x)} ${round(y + h)} Z`;
      return { tag: "path", attrs: { d, ...common } };
    }
    default:
      return { tag: "rect", attrs: { x, y, width: w, height: h, rx: 6, ...common } };
  }
}

// The label block, centred in the box. The sub-line sits under the label in the
// softer ink, which is what makes a tensor shape read as an annotation on the
// box rather than as part of its name.
function boxText(box: SceneBox, ink: string): SvgNode[] {
  const total = box.lines.length * LINE_HEIGHT + (box.subLines.length ? SUB_LINE_HEIGHT : 0);
  let y = box.y + box.h / 2 - total / 2 + LINE_HEIGHT * 0.78;
  const cx = box.x + box.w / 2;
  const out: SvgNode[] = [];
  for (const line of box.lines) {
    out.push({
      tag: "text",
      attrs: {
        x: round(cx),
        y: round(y),
        "text-anchor": "middle",
        "font-size": FONT_SIZE,
        fill: ink,
      },
      text: line,
    });
    y += LINE_HEIGHT;
  }
  for (const line of box.subLines) {
    out.push({
      tag: "text",
      attrs: {
        x: round(cx),
        y: round(y - LINE_HEIGHT + SUB_LINE_HEIGHT),
        "text-anchor": "middle",
        "font-size": SUB_FONT_SIZE,
        fill: PALETTE.inkSoft,
      },
      text: line,
    });
  }
  return out;
}

function arrowHead(x: number, y: number, angle: number, colour: string): SvgNode {
  return {
    tag: "path",
    attrs: {
      d: "M 0 0 L -8.5 -3.4 L -8.5 3.4 Z",
      fill: colour,
      transform: `translate(${round(x)} ${round(y)}) rotate(${round(angle)})`,
    },
  };
}

function edgeNodes(edge: SceneEdge): SvgNode[] {
  const lit = edge.emphasis === "lit";
  const colour = lit ? PALETTE.accent : PALETTE.line;
  const width = lit ? 2.1 : edge.thick ? 2 : 1.3;
  const out: SvgNode[] = [
    {
      tag: "path",
      attrs: {
        d: edge.d,
        fill: "none",
        stroke: colour,
        "stroke-width": width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...(edge.dashed ? { "stroke-dasharray": "5 4" } : {}),
      },
    },
  ];
  if (edge.head) out.push(arrowHead(edge.head.x, edge.head.y, edge.head.angle, colour));
  if (edge.tail) out.push(arrowHead(edge.tail.x, edge.tail.y, edge.tail.angle, colour));
  if (edge.label) {
    // A filled chip behind the text: the label sits on the line, and without the
    // chip the two overprint into something unreadable.
    out.push({
      tag: "rect",
      attrs: {
        x: round(edge.labelX - edge.labelW / 2),
        y: round(edge.labelY - 7.5),
        width: round(edge.labelW),
        height: 15,
        rx: 4,
        fill: PALETTE.surface,
      },
    });
    out.push({
      tag: "text",
      attrs: {
        x: round(edge.labelX),
        y: round(edge.labelY + 3.5),
        "text-anchor": "middle",
        "font-size": EDGE_FONT_SIZE,
        fill: lit ? PALETTE.accentInk : PALETTE.inkSoft,
      },
      text: edge.label,
    });
  }
  return out;
}

// Wrap a thing in a group carrying its opacity. Everything that can be dimmed
// goes through here, so "dim it" is one attribute and never a second geometry.
function layer(emphasis: Emphasis, children: SvgNode[]): SvgNode {
  const o = OPACITY[emphasis];
  return { tag: "g", attrs: o === 1 ? {} : { opacity: o }, children };
}

// --- the whole picture -----------------------------------------------------

export interface SvgOptions {
  // A description for assistive technology. The card passes the diagram's title
  // and caption; without it the picture is announced as nothing at all.
  title?: string;
}

export function sceneToSvg(scene: Scene, opts: SvgOptions = {}): SvgNode {
  const children: SvgNode[] = [];
  if (opts.title) children.push({ tag: "title", attrs: {}, text: opts.title });

  // Paint order: frames, then lifelines, then edges, then boxes, then notes. The
  // boxes go over the edges so a line running behind a box is hidden by it
  // rather than drawn across its label.
  for (const g of scene.groups) {
    children.push(
      layer(g.emphasis, [
        {
          tag: "rect",
          attrs: {
            x: g.x,
            y: g.y,
            width: g.w,
            height: g.h,
            rx: 10,
            fill: "none",
            stroke: PALETTE.groupBorder,
            "stroke-width": 1,
            "stroke-dasharray": "4 4",
          },
        },
        ...(g.label
          ? [
              {
                tag: "text",
                attrs: {
                  x: round(g.x + 11),
                  y: round(g.y + 13),
                  "font-size": GROUP_FONT_SIZE,
                  fill: PALETTE.groupInk,
                },
                text: g.label,
              } as SvgNode,
            ]
          : []),
        ...(g.repeat
          ? [
              {
                tag: "text",
                attrs: {
                  x: round(g.x + g.w - 11),
                  y: round(g.y + 13),
                  "text-anchor": "end",
                  "font-size": GROUP_FONT_SIZE,
                  fill: PALETTE.groupInk,
                },
                text: g.repeat,
              } as SvgNode,
            ]
          : []),
      ]),
    );
  }

  for (const l of scene.lifelines) {
    children.push(
      layer(l.emphasis, [
        {
          tag: "line",
          attrs: {
            x1: round(l.x),
            y1: round(l.top),
            x2: round(l.x),
            y2: round(l.bottom),
            stroke: PALETTE.border,
            "stroke-width": 1,
            "stroke-dasharray": "3 4",
          },
        },
      ]),
    );
  }

  for (const e of scene.edges) children.push(layer(e.emphasis, edgeNodes(e)));

  for (const b of scene.boxes) {
    const tone = toneColours(b.tone);
    const lit = b.emphasis === "lit";
    children.push(
      layer(b.emphasis, [
        shapeNode(b, tone.fill, lit ? PALETTE.accent : tone.stroke, lit ? 2 : 1.2),
        ...boxText(b, tone.ink),
      ]),
    );
  }

  for (const n of scene.notes) {
    children.push(
      layer(n.emphasis, [
        {
          tag: "text",
          attrs: {
            x: round(n.x),
            y: round(n.y),
            "text-anchor": n.anchor,
            "font-size": NOTE_FONT_SIZE,
            fill: PALETTE.inkSoft,
          },
          text: n.text,
        },
      ]),
    );
  }

  return {
    tag: "svg",
    attrs: {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `0 0 ${scene.width} ${scene.height}`,
      width: scene.width,
      height: scene.height,
      "font-family": FONT_STACK,
      role: "img",
      ...(opts.title ? { "aria-label": opts.title } : {}),
    },
    children,
  };
}

// --- serialisation ---------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The element tree as a standalone SVG document. Every label the model wrote
// passes through escapeXml here — a diagram is model output rendered as markup,
// so the escaping is not tidiness, it is the boundary.
export function serializeSvg(node: SvgNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
  const inner =
    (node.text ? escapeXml(node.text) : "") +
    (node.children ?? []).map(serializeSvg).join("");
  return inner ? `<${node.tag}${attrs}>${inner}</${node.tag}>` : `<${node.tag}${attrs}/>`;
}
