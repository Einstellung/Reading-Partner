// The fixed paper (docs/63): its geometry, the zoom over it, the CSS the book
// may lay on it, the CFI arithmetic a page card resolves with, and the one
// migration a book ever goes through.

import { describe, expect, test } from "bun:test";
import {
  epubRangeCfi,
  parseEpubRangeCfi,
  rangeToCfi,
  resolvePoint,
  resolveRange,
  parseEpubCfi,
  compareLocal,
} from "../../../src/reading/epub/cfi";
import { cssUrls, rewriteCssUrls, sanitizeCss, sanitizeDeclarations } from "../../../src/reading/epub/css-sanitize";
import { remapEpubAnnotations } from "../../../src/reading/epub/migrate";
import {
  BODY_HEIGHT,
  BODY_WIDTH,
  MAX_ZOOM,
  MIN_ZOOM,
  PAGE_GEOMETRY,
  ZOOM_STEPS,
  atLockedZoom,
  columnOf,
  columnPosition,
  columnScrollTop,
  fitZoom,
  flipPosition,
  mountRange,
  openingEpubZoom,
  sameGeometry,
  visibleColumnRange,
  zoomStepDown,
  zoomStepUp,
} from "../../../src/reading/epub/page-geometry";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { parsePagination, storedVersionOf } from "../../../src/reading/epub/pagination-store";
import { parseEpub } from "../../../src/reading/epub/parse";
import { sanitize } from "../../../src/reading/epub/sanitize";
import { makeEpubSortIndex } from "../../../src/reading/epub/annotation";
import { buildEpub, prose } from "./fixture";

describe("the paper", () => {
  test("six by nine inches at 96 dpi, with the text block inside it", () => {
    expect(PAGE_GEOMETRY.width).toBe(576);
    expect(PAGE_GEOMETRY.height).toBe(864);
    expect(BODY_WIDTH).toBe(PAGE_GEOMETRY.width - 2 * PAGE_GEOMETRY.padX);
    expect(BODY_HEIGHT).toBe(PAGE_GEOMETRY.height - 2 * PAGE_GEOMETRY.padY);
    expect(sameGeometry({ ...PAGE_GEOMETRY })).toBe(true);
    expect(sameGeometry({ ...PAGE_GEOMETRY, fontSize: 17 })).toBe(false);
    expect(sameGeometry(undefined)).toBe(false);
  });

  test("a column is found from an x offset, forgiving a subpixel", () => {
    expect(columnOf(0)).toBe(0);
    expect(columnOf(BODY_WIDTH - 0.4)).toBe(1);
    expect(columnOf(BODY_WIDTH * 3 + 10)).toBe(3);
    expect(columnOf(-0.3)).toBe(0);
  });
});

describe("zoom", () => {
  test("the steps run in one direction and the buttons walk them", () => {
    expect([...ZOOM_STEPS]).toEqual([...ZOOM_STEPS].sort((a, b) => a - b));
    expect(zoomStepUp(1)).toBe(1.1);
    expect(zoomStepUp(1.05)).toBe(1.1);
    expect(zoomStepDown(1)).toBe(0.9);
    expect(zoomStepDown(0.95)).toBe(0.9);
    expect(zoomStepUp(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomStepDown(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  test("the fits are the PDF side's rule over this page", () => {
    expect(fitZoom("fit-width", { clientWidth: 1152, clientHeight: 500 })).toBe(2);
    expect(fitZoom("fit-page", { clientWidth: 1152, clientHeight: 864 })).toBe(1);
    expect(fitZoom("fit-page", { clientWidth: 288, clientHeight: 2000 })).toBe(0.5);
    expect(fitZoom("fit-width", { clientWidth: 0, clientHeight: 0 })).toBe(1);
  });

  test("a book opens at its saved zoom in the column and at fit-page in the flip", () => {
    expect(openingEpubZoom("vertical", 1.5)).toEqual({ kind: "scale", scale: 1.5 });
    expect(openingEpubZoom("vertical", "auto")).toEqual({ kind: "lock", lock: "fit-width" });
    expect(openingEpubZoom("vertical", undefined)).toEqual({ kind: "lock", lock: "fit-width" });
    expect(openingEpubZoom("paged", 1.5)).toEqual({ kind: "lock", lock: "fit-page" });
    expect(atLockedZoom({ kind: "lock", lock: "fit-width" }, "vertical")).toBe(true);
    expect(atLockedZoom({ kind: "lock", lock: "fit-width" }, "paged")).toBe(false);
    expect(atLockedZoom({ kind: "scale", scale: 1 }, "vertical")).toBe(false);
  });
});

describe("where the reader is on the desk", () => {
  test("the column's position round-trips through a scroll offset", () => {
    const at = columnPosition(columnScrollTop(3, 100, 1.5), 1.5, 10);
    expect(at.pageIndex).toBe(3);
    expect(at.pageY).toBeCloseTo(100, 6);
    expect(columnPosition(0, 1, 10)).toEqual({ pageIndex: 0, pageY: 0 });
    expect(columnPosition(1e9, 1, 10).pageIndex).toBe(9);
    expect(columnPosition(50, 1, 0)).toEqual({ pageIndex: 0, pageY: 0 });
  });

  test("the flip rests on the nearest slot", () => {
    expect(flipPosition(0, 800, 5)).toBe(0);
    expect(flipPosition(1200, 800, 5)).toBe(2);
    expect(flipPosition(9999, 800, 5)).toBe(4);
  });

  test("the sheets mounted are the visible ones and a margin", () => {
    const visible = visibleColumnRange(0, 1000, 1, 20);
    expect(visible.first).toBe(0);
    expect(visible.last).toBe(1);
    expect(mountRange(visible.first, visible.last, 20, 1)).toEqual({ from: 0, to: 2 });
    expect(mountRange(18, 19, 20, 2)).toEqual({ from: 16, to: 19 });
    expect(visibleColumnRange(0, 1000, 1, 0)).toEqual({ first: 0, last: -1 });
  });
});

describe("the book's CSS", () => {
  const resolve = (raw: string) => (raw.startsWith("img/") || raw.endsWith(".ttf") ? raw : null);

  test("what reaches out is dropped and what stays is written back canonically", () => {
    const css = `
      @import url("http://evil/x.css");
      @charset "utf-8";
      /* a comment */
      p { color: red; behavior: url(x.htc); background: url("http://evil/a.png") }
      .fixed { position: fixed; top: 0 }
      .sticky { position: -webkit-sticky !important }
      .ok { margin: 0 auto; background: url(img/a.png) }
      .expr { width: expression(alert(1)); height: 1em }
      @media (max-width: 600px) { p { font-size: 90% } @page { margin: 0 } }
      @font-face { font-family: "X"; src: url(x.ttf) format("truetype") }
      @font-face { font-family: "Y"; src: url(http://evil/y.ttf) }
      @keyframes spin { from { transform: rotate(0) } }
    `;
    const out = sanitizeCss(css, { resolveUrl: resolve });
    expect(out).not.toContain("@import");
    expect(out).not.toContain("behavior");
    expect(out).not.toContain("evil");
    expect(out).not.toContain("expression");
    expect(out).not.toContain("@keyframes");
    expect(out).not.toContain("@page");
    expect(out).toContain("p { color: red }");
    expect(out).toContain(".fixed { position: relative; top: 0 }");
    expect(out).toContain(".sticky { position: relative !important }");
    expect(out).toContain('.ok { margin: 0 auto; background: url("img/a.png") }');
    expect(out).toContain(".expr { height: 1em }");
    expect(out).toContain("@media (max-width: 600px) { p { font-size: 90% } }");
    expect(out).toContain('@font-face { font-family: "X"; src: url("x.ttf") format("truetype") }');
    expect(out).not.toContain('"Y"');
    // Output is input: the second pass changes nothing.
    expect(sanitizeCss(out, { resolveUrl: resolve })).toBe(out);
    expect(cssUrls(out)).toEqual(["img/a.png", "x.ttf"]);
    expect(rewriteCssUrls(out, (t) => `blob:${t}`)).toContain('url("blob:img/a.png")');
  });

  test("a style attribute is a declaration list under the same rules", () => {
    expect(sanitizeDeclarations("text-align:center; position:fixed; x:javascript:1", { resolveUrl: () => null })).toBe(
      "text-align: center; position: relative",
    );
    expect(sanitizeDeclarations("background: url(a.png)", { resolveUrl: () => null })).toBe("");
  });

  test("the sanitized document keeps its stylesheet, its links and its style attributes", () => {
    const source = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>
      <link rel="stylesheet" href="style.css"/><link rel="icon" href="http://x/i.png"/>
      <style>p { color: red } @import "x.css"; .a { position: fixed }</style>
      </head><body><p style="text-align: center; behavior: url(x)">hi</p></body></html>`;
    const once = sanitize(source, "OEBPS/c1.xhtml");
    expect(once).toContain('<link href="style.css" rel="stylesheet"/>');
    expect(once).not.toContain("icon");
    expect(once).toContain("<style>p { color: red }\n.a { position: relative }</style>");
    expect(once).toContain('<p style="text-align: center">hi</p>');
    expect(sanitize(once, "OEBPS/c1.xhtml")).toBe(once);
  });
});

describe("CFI arithmetic on a card's tree", () => {
  const book = parseEpub(
    buildEpub({ docs: [{ name: "c1.xhtml", body: `<p id="a">Hello <b>bold</b> world</p><p id="b">Second</p>` }] }),
  );
  const doc = book.docs[0];
  const root = doc.doc.documentElement;

  test("a point resolves to the node and offset it names, through adjacent text", () => {
    const p = parseEpubCfi("epubcfi(/6/2[c0]!/4/2/1:3)")!;
    const at = resolvePoint(root, p)!;
    expect(at.node.nodeType).toBe(3);
    expect((at.node as Text).data.slice(at.offset)).toBe("lo ");
    const after = resolvePoint(root, parseEpubCfi("epubcfi(/6/2[c0]!/4/2/3:1)")!)!;
    expect((after.node as Text).data).toBe(" world");
    expect(after.offset).toBe(1);
    expect(resolvePoint(root, parseEpubCfi("epubcfi(/6/2[c0]!/4/2/9:0)")!)).toBeNull();
    expect(resolvePoint(root, parseEpubCfi("epubcfi(/6/2[c0]!/4/40)")!)).toBeNull();
  });

  test("a range round-trips through its CFI, with the common parent factored out", () => {
    const a = root.querySelector("#a")!;
    const b = root.querySelector("#b")!;
    const range = doc.doc.createRange();
    range.setStart(a.firstChild!, 2);
    range.setEnd(b.firstChild!, 3);
    const cfi = rangeToCfi(range, 0, "c0")!;
    expect(cfi).toBe("epubcfi(/6/2[c0]!/4,/2/1:2,/4/1:3)");
    const parsed = parseEpubRangeCfi(cfi)!;
    expect(parsed.start).toEqual({ steps: [4, 2, 1], offset: 2 });
    const back = resolveRange(root, parsed)!;
    expect(back.toString()).toBe("llo bold worldSec");
    expect(epubRangeCfi(0, "c0", "/4/2/1:0", "/4/2/1:5")).toBe("epubcfi(/6/2[c0]!/4/2,/1:0,/1:5)");
  });

  test("document order of two local positions", () => {
    const at = (s: string) => parseEpubCfi(`epubcfi(/6/2!${s})`)!;
    expect(compareLocal(at("/4/2/1:3"), at("/4/2/1:5"))).toBeLessThan(0);
    expect(compareLocal(at("/4/2"), at("/4/2/1:5"))).toBeLessThan(0);
    expect(compareLocal(at("/4/4"), at("/4/2/3:0"))).toBeGreaterThan(0);
    expect(compareLocal(at("/4/2/1:5"), at("/4/2/1:5"))).toBe(0);
  });
});

describe("the one migration", () => {
  test("a version-1 table reads as absent, and its version is still known", () => {
    const v1 = { version: 1, kind: "epub", source: "synthetic", blockChars: 1800, spineCount: 1, blocks: [{}] };
    expect(parsePagination(v1)).toBeNull();
    expect(storedVersionOf(v1)).toBe(1);
    expect(storedVersionOf(null)).toBeNull();
  });

  test("a version-2 table without our geometry reads as absent too", async () => {
    const book = parseEpub(buildEpub({ docs: [{ name: "c1.xhtml", body: prose(3) }] }));
    const table = await paginate(book, characterRuler(500));
    expect(parsePagination(JSON.parse(JSON.stringify(table)))).not.toBeNull();
    expect(parsePagination({ ...table, geometry: { ...table.geometry, fonts: "other" } })).toBeNull();
  });

  test("marks keep their CFI and get the new table's page numbers", async () => {
    const book = parseEpub(buildEpub({ docs: [{ name: "c1.xhtml", body: prose(20, 300) }] }));
    const table = await paginate(book, characterRuler(400));
    expect(table.blocks.length).toBeGreaterThan(3);
    const late = table.blocks[3];
    const mark = {
      id: "m1",
      type: "highlight",
      position: { type: "FragmentSelector", conformsTo: "x", value: late.cfi, pageIndex: 0 },
      pageLabel: "1",
      sortIndex: "00000|0000000",
    };
    const pdfMark = { id: "m2", type: "highlight", position: { pageIndex: 4, rects: [] } };
    const out = remapEpubAnnotations([mark, pdfMark], book, table);
    expect(out.changed).toBe(true);
    const moved = out.annotations[0] as typeof mark;
    expect(moved.position.pageIndex).toBe(3);
    expect(moved.position.value).toBe(late.cfi);
    expect(moved.pageLabel).toBe("4");
    expect(moved.sortIndex).toBe(makeEpubSortIndex(0, late.charOffset));
    expect(out.annotations[1]).toBe(pdfMark);
    // Already right: nothing to write.
    expect(remapEpubAnnotations(out.annotations, book, table).changed).toBe(false);
  });
});
