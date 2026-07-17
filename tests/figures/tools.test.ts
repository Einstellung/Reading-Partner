// view_figure tool: result shapes for vision / non-vision / not-found /
// render-failed, and the gated execute path. Rendering is faked, so no DOM.
// Run: bun test.

import { test, expect } from "bun:test";
import { buildFigureTools, figureToolResult } from "../../src/figures/tools";
import type { Figure } from "../../src/figures/types";

const FIG: Figure = { id: "3", page: 5, caption: "A schematic of the model", bbox: { x: 1, y: 2, width: 3, height: 4 } };
const IMG = { base64: "AAAA", mimeType: "image/jpeg" };

test("unknown figure returns a plain not-found message", () => {
  const r = figureToolResult(null, "9", true, null);
  expect(r.images).toBeUndefined();
  expect(r.text).toContain('No figure "9"');
});

test("a vision model gets the image plus caption text", () => {
  const r = figureToolResult(FIG, "3", true, IMG);
  expect(r.text).toContain("Figure 3 (p.5)");
  expect(r.images).toEqual([{ data: "AAAA", mimeType: "image/jpeg" }]);
});

test("a text-only model gets the caption and a note it can't see images", () => {
  const r = figureToolResult(FIG, "3", false, null);
  expect(r.images).toBeUndefined();
  expect(r.text).toContain("can't view images");
});

test("a failed render degrades to caption-only", () => {
  const r = figureToolResult(FIG, "3", true, null);
  expect(r.images).toBeUndefined();
  expect(r.text).toContain("could not be rendered");
});

test("no figures means no tool", () => {
  expect(buildFigureTools({ figures: [], modelSupportsImages: true, renderImage: async () => null })).toEqual([]);
});

test("execute renders and attaches the image for a vision model", async () => {
  let rendered = 0;
  const [tool] = buildFigureTools({
    figures: [FIG],
    modelSupportsImages: true,
    renderImage: async () => {
      rendered++;
      return IMG;
    },
  });
  const res = await tool.execute({ id: "Figure 3" }); // tolerant of the "Figure " prefix
  expect(rendered).toBe(1);
  expect(typeof res === "object" && res.images?.[0]?.data).toBe("AAAA");
});

test("execute never renders for a non-vision model", async () => {
  let rendered = 0;
  const [tool] = buildFigureTools({
    figures: [FIG],
    modelSupportsImages: false,
    renderImage: async () => {
      rendered++;
      return IMG;
    },
  });
  const res = await tool.execute({ id: "3" });
  expect(rendered).toBe(0);
  expect(typeof res === "object" && res.images).toBeUndefined();
});

test("execute on an unknown id reports not found without rendering", async () => {
  let rendered = 0;
  const [tool] = buildFigureTools({
    figures: [FIG],
    modelSupportsImages: true,
    renderImage: async () => {
      rendered++;
      return IMG;
    },
  });
  const res = await tool.execute({ id: "8" });
  expect(rendered).toBe(0);
  expect(typeof res === "object" && res.text).toContain('No figure "8"');
});
