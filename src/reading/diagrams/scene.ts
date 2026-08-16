// The geometry a diagram turns into: boxes with coordinates, edges with path
// data, group frames, notes. Everything downstream of layout works on a Scene
// and never sees the DSL again, which is what keeps the drawing (svg.ts) free of
// any opinion about where things go.
//
// A Scene is plain data with no colours in it. `tone` and `emphasis` say what a
// thing *is*; svg.ts decides what that looks like. So the same scene serialises
// to a file, renders as React, and could feed a deck export, without three
// palettes drifting apart.

import { measureLine, wrapText } from "./text";
import type { DiagramNode, DiagramShape, DiagramTone } from "./types";

// --- the metrics every layout shares ---------------------------------------

export const FONT_SIZE = 12.5;
export const SUB_FONT_SIZE = 10.5;
export const LINE_HEIGHT = 15;
export const SUB_LINE_HEIGHT = 13;
export const EDGE_FONT_SIZE = 10.5;
export const NOTE_FONT_SIZE = 10.5;
export const GROUP_FONT_SIZE = 10.5;

const PAD_X = 12;
const PAD_Y = 9;
const MIN_W = 54;
const MIN_H = 32;
// The width a label wraps at. Chosen so a node holding a five-character Chinese
// phrase or two English words is one line, and the whole diagram still fits the
// chat column without scrolling in the common case.
export const LABEL_WRAP_W = 128;

export const RANK_GAP = 46;
export const NODE_GAP = 20;
export const GROUP_PAD = 14;
export const GROUP_LABEL_H = 17;
export const CANVAS_PAD = 14;
// How far off the side of the diagram a skip or back edge runs.
export const RAIL_GAP = 22;

// How strongly a thing is drawn. The whole focus/stages mechanism reduces to
// this one field: layout never changes, only emphasis does.
//   full    drawn normally.
//   lit     the highlighted path — heavier and in the accent colour.
//   dim     present, but not what is being talked about right now.
//   ghost   not introduced yet by the current stage. Drawn faintly so the
//           reader can see the space being kept for it and nothing jumps when
//           it arrives.
export type Emphasis = "full" | "lit" | "dim" | "ghost";

export interface SceneBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  subLines: string[];
  shape: DiagramShape;
  tone: DiagramTone;
  emphasis: Emphasis;
}

export interface SceneEdge {
  id: string;
  // SVG path data. Every edge is one path, so the drawing does not have to know
  // whether it was a straight line, a curve or a rail around the side.
  d: string;
  // Where the arrowhead sits and which way it points, in degrees.
  head: { x: number; y: number; angle: number } | null;
  tail: { x: number; y: number; angle: number } | null;
  label: string;
  labelX: number;
  labelY: number;
  labelW: number;
  dashed: boolean;
  thick: boolean;
  emphasis: Emphasis;
}

export interface SceneGroup {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  repeat: string;
  emphasis: Emphasis;
}

export interface SceneNote {
  x: number;
  y: number;
  text: string;
  // Which end of the text sits at x.
  anchor: "start" | "end";
  emphasis: Emphasis;
}

// A participant's vertical line in a sequence diagram.
export interface SceneLifeline {
  id: string;
  x: number;
  top: number;
  bottom: number;
  emphasis: Emphasis;
}

export interface Scene {
  width: number;
  height: number;
  boxes: SceneBox[];
  edges: SceneEdge[];
  groups: SceneGroup[];
  notes: SceneNote[];
  lifelines: SceneLifeline[];
}

// --- node sizing -----------------------------------------------------------

export interface SizedNode {
  node: DiagramNode;
  w: number;
  h: number;
  lines: string[];
  subLines: string[];
}

// A node's box, big enough for its wrapped label. A diamond gets extra room
// because its corners take a bite out of every line, and a note is sized tighter
// because it is an aside, not a part.
export function sizeNode(node: DiagramNode, wrapWidth = LABEL_WRAP_W): SizedNode {
  const label = wrapText(node.label, { fontSize: FONT_SIZE, maxWidth: wrapWidth, maxLines: 3 });
  const sub = node.sub
    ? wrapText(node.sub, { fontSize: SUB_FONT_SIZE, maxWidth: wrapWidth, maxLines: 1 })
    : { lines: [], width: 0 };

  let w = Math.max(MIN_W, label.width, sub.width) + PAD_X * 2;
  let h =
    Math.max(MIN_H, label.lines.length * LINE_HEIGHT + (sub.lines.length ? SUB_LINE_HEIGHT : 0)) +
    PAD_Y * 2;

  if (node.shape === "diamond") {
    w = w * 1.45;
    h = h * 1.45;
  } else if (node.shape === "cylinder") {
    h += 8;
  }
  return { node, w: Math.round(w), h: Math.round(h), lines: label.lines, subLines: sub.lines };
}

// --- path helpers ----------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function pt(x: number, y: number): Point {
  return { x, y };
}

// The angle an arrowhead points, in degrees, going from a to b.
export function angleOf(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// A straight segment.
export function linePath(a: Point, b: Point): string {
  return `M ${round(a.x)} ${round(a.y)} L ${round(b.x)} ${round(b.y)}`;
}

// A cubic between two points, bulging along the axis they are separated on. The
// standard connector between adjacent ranks: vertical when the two are aligned,
// an S-curve when they are not, and never a diagonal cutting a corner.
export function curvePath(a: Point, b: Point, vertical: boolean): string {
  if (vertical) {
    const mid = (a.y + b.y) / 2;
    return `M ${round(a.x)} ${round(a.y)} C ${round(a.x)} ${round(mid)}, ${round(b.x)} ${round(mid)}, ${round(b.x)} ${round(b.y)}`;
  }
  const mid = (a.x + b.x) / 2;
  return `M ${round(a.x)} ${round(a.y)} C ${round(mid)} ${round(a.y)}, ${round(mid)} ${round(b.y)}, ${round(b.x)} ${round(b.y)}`;
}

// An elbow with rounded corners, through a list of waypoints. Used for the rail
// a skip or back edge takes around the side of the diagram, and for the
// parent-to-child connectors of a tree.
export function elbowPath(points: Point[], radius = 8): string {
  if (points.length < 2) return "";
  const parts = [`M ${round(points[0].x)} ${round(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const here = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(here.x - prev.x, here.y - prev.y);
    const outLen = Math.hypot(next.x - here.x, next.y - here.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      parts.push(`L ${round(here.x)} ${round(here.y)}`);
      continue;
    }
    const enter = {
      x: here.x + ((prev.x - here.x) / inLen) * r,
      y: here.y + ((prev.y - here.y) / inLen) * r,
    };
    const leave = {
      x: here.x + ((next.x - here.x) / outLen) * r,
      y: here.y + ((next.y - here.y) / outLen) * r,
    };
    parts.push(
      `L ${round(enter.x)} ${round(enter.y)}`,
      `Q ${round(here.x)} ${round(here.y)}, ${round(leave.x)} ${round(leave.y)}`,
    );
  }
  const last = points[points.length - 1];
  parts.push(`L ${round(last.x)} ${round(last.y)}`);
  return parts.join(" ");
}

// The width the edge-label chip needs, so the drawing can knock a hole in the
// line behind it instead of printing the text on top of it.
export function edgeLabelWidth(label: string): number {
  return label ? measureLine(label, EDGE_FONT_SIZE) + 8 : 0;
}

export function emptyScene(): Scene {
  return { width: 0, height: 0, boxes: [], edges: [], groups: [], notes: [], lifelines: [] };
}
