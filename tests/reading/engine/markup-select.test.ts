// The markup tools' selection handler: a pen's text selection becomes a mark on
// line boxes, the fields otherwise as the annotation plugin's own handler
// writes them.

import { expect, test } from "bun:test";
import type { PdfAnnotationObject, PdfPageGeometry, Rect } from "@embedpdf/models";
import { AnnotationPluginPackage } from "@embedpdf/plugin-annotation";

import { MARKUP_TOOL_OVERRIDES, markupToolOverrides } from "../../../src/reading/engine/convert";
import { markupSelectionHandler, type MarkupSelectionState } from "../../../src/reading/engine/markup-select";

// Two lines of four glyphs: loose boxes 40 tall on a 20 pitch, ink 10.
function page(): PdfPageGeometry {
  const runs = [0, 1].map((row) => {
    const y = row * 20;
    const glyphs = [0, 1, 2, 3].map((i) => ({ x: i * 10, y, width: 10, height: 40, flags: 0, tightX: i * 10, tightY: y + 15, tightWidth: 10, tightHeight: 10 }));
    return { rect: { x: 0, y, width: 40, height: 40 }, charStart: row * 4, glyphs, fontSize: 1 };
  });
  return { runs } as unknown as PdfPageGeometry;
}

const loose: Rect[] = [
  { origin: { x: 10, y: 0 }, size: { width: 30, height: 40 } },
  { origin: { x: 0, y: 20 }, size: { width: 20, height: 40 } },
];

function run(state: MarkupSelectionState | null, selectAfterCreate = false) {
  const created: { page: number; obj: PdfAnnotationObject }[] = [];
  const selected: string[] = [];
  const handler = markupSelectionHandler(() => state);
  handler.handle(
    {
      documentId: "doc",
      getTool: () => ({ defaults: { opacity: 0.4 } as Partial<PdfAnnotationObject>, behavior: { selectAfterCreate } }),
      createAnnotation: (page, obj) => void created.push({ page, obj }),
      selectAnnotation: (_page, id) => void selected.push(id),
    },
    [{ pageIndex: 0, rect: { origin: { x: 0, y: 0 }, size: { width: 40, height: 60 } }, segmentRects: loose }],
    async () => "words",
  );
  return { created, selected };
}

test("a pen's selection is written on line boxes, with the tool's defaults and the words", async () => {
  const { created, selected } = run({ selection: { start: { page: 0, index: 1 }, end: { page: 0, index: 5 } }, geometry: { 0: page() } });
  await Promise.resolve();
  await Promise.resolve();
  expect(created.length).toBe(1);
  const obj = created[0].obj as unknown as { opacity: number; rect: Rect; segmentRects: Rect[]; custom: { text: string } };
  expect(obj.opacity).toBe(0.4);
  expect(obj.custom.text).toBe("words");
  // Each line its own ink band, no taller than the pitch, neither touching the other.
  expect(obj.segmentRects.length).toBe(2);
  const [a, b] = obj.segmentRects;
  expect(a.origin.x).toBe(10);
  expect(a.size.width).toBe(30);
  expect(a.size.height).toBeLessThanOrEqual(15);
  expect(a.origin.y + a.size.height).toBeLessThanOrEqual(b.origin.y);
  expect(obj.rect).toEqual({ origin: { x: 0, y: a.origin.y }, size: { width: 40, height: b.origin.y + b.size.height - a.origin.y } });
  expect(selected).toEqual([]);
});

test("without the selection plugin's state the plugin's own rects are kept", async () => {
  const { created, selected } = run(null, true);
  await Promise.resolve();
  await Promise.resolve();
  expect((created[0].obj as unknown as { segmentRects: Rect[] }).segmentRects).toEqual(loose);
  expect(selected).toEqual([created[0].obj.id]);
});

test("both markup tools carry the handler, and nothing else about them changes", () => {
  const handler = markupSelectionHandler(() => null);
  const tools = markupToolOverrides(handler);
  expect(tools.map((t) => t.id)).toEqual(MARKUP_TOOL_OVERRIDES.map((t) => t.id));
  for (const [k, tool] of tools.entries()) {
    expect(tool.selectionHandler).toBe(handler);
    expect(tool.defaults).toEqual(MARKUP_TOOL_OVERRIDES[k].defaults);
  }
});

test("the annotation plugin keeps the handler when it merges the overrides into its tools", () => {
  const handler = markupSelectionHandler(() => null);
  const pkg = AnnotationPluginPackage as unknown as {
    initialState: (core: unknown, config: unknown) => { tools: { id: string; selectionHandler?: unknown; defaults: { opacity?: number } }[] };
  };
  const { tools } = pkg.initialState(null, { tools: markupToolOverrides(handler) });
  for (const id of ["highlight", "underline"]) {
    const tool = tools.find((t) => t.id === id)!;
    expect(tool.selectionHandler).toBe(handler);
    expect(tool.defaults.opacity).toBe(0.4);
  }
});
