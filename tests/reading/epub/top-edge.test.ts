// Where a flow column says the reader is, from what lies under its top edge.
// The hit tests are a webview's; which answer counts is decided here.

import { describe, expect, test } from "bun:test";
import { epubCfi } from "../../../src/reading/epub/cfi";
import type { Pagination } from "../../../src/reading/epub/paginate";
import { PAGE_GEOMETRY } from "../../../src/reading/epub/page-geometry";
import { pageIndexOfCfi } from "../../../src/reading/epub/reader-logic";
import { topEdgeSteps } from "../../../src/reading/epub/top-edge";

// body: p /2, p /4, div /6 (the picture, /4/6/2), p /8
const doc = new DOMParser().parseFromString(
  "<html><head></head><body><p>one</p><p>two</p><div><img/></div><p>three</p></body></html>",
  "text/html",
);
const root = doc.documentElement;
const body = doc.body;
const img = doc.querySelector("img")!;
const three = doc.querySelectorAll("p")[2]!;

const pagination: Pagination = {
  version: 2,
  kind: "epub",
  source: "layout",
  geometry: { ...PAGE_GEOMETRY },
  spineCount: 1,
  blocks: [
    { spine: 0, charOffset: 0, endOffset: 3, cfi: "epubcfi(/6/2[c1]!/4/2/1:0)", label: null },
    { spine: 0, charOffset: 3, endOffset: 6, cfi: "epubcfi(/6/2[c1]!/4/4/1:0)", label: null },
    { spine: 0, charOffset: 6, endOffset: 11, cfi: "epubcfi(/6/2[c1]!/4/8/1:0)", label: null },
  ],
};

const points = [
  { x: 10, y: 1 },
  { x: 10, y: 9 },
];

describe("the place under the top edge", () => {
  test("a picture with no words under the edge is the page the picture is on", () => {
    const local = topEdgeSteps(root, points, { hit: () => img, caret: () => null });
    expect(local).toBe("/4/6/2");
    expect(pageIndexOfCfi(pagination, epubCfi(0, "c1", local!))).toBe(1);
  });

  test("words anywhere in the band outrank a picture above them", () => {
    const text = three.firstChild as Text;
    const local = topEdgeSteps(root, points, {
      hit: (_x, y) => (y === 1 ? img : three),
      caret: (_x, y) => (y === 1 ? null : { node: text, offset: 2 }),
    });
    expect(local).toBe("/4/8/1:2");
  });

  test("the body and the root are nowhere", () => {
    expect(topEdgeSteps(root, points, { hit: () => body, caret: () => null })).toBeNull();
    expect(topEdgeSteps(root, points, { hit: () => root, caret: () => null })).toBeNull();
  });
});
