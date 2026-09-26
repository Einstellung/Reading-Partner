import { describe, expect, test } from "bun:test";
import {
  followers,
  slideOffsets,
  type TreeNode,
} from "../../../../src/ui/components/phone/slide-into-place";

interface Node extends TreeNode {
  name: string;
  parentElement: Node | null;
  nextElementSibling: Node | null;
}

function tree(name: string, kids: Node[] = []): Node {
  const n: Node = { name, parentElement: null, nextElementSibling: null };
  kids.forEach((k, i) => {
    k.parentElement = n;
    k.nextElementSibling = kids[i + 1] ?? null;
  });
  return n;
}

describe("followers", () => {
  test("later siblings, then the later siblings of each ancestor, up to the scroller", () => {
    const a = tree("a");
    const b = tree("b");
    const c = tree("c");
    const books = tree("books", [a, b, c]);
    const heading = tree("articles-heading");
    const x = tree("x");
    const articles = tree("articles", [x]);
    const scroller = tree("scroller", [books, heading, articles]);
    tree("screen", [tree("header"), scroller, tree("footer")]);
    const names = followers(b, (n) => n === scroller).map((n) => n.name);
    expect(names).toEqual(["c", "articles-heading", "articles"]);
  });

  test("the last item has nothing after it", () => {
    const a = tree("a");
    const list = tree("list", [a]);
    expect(followers(a, (n) => n === list)).toEqual([]);
  });

  test("stops at the root when no scroller is found", () => {
    const a = tree("a");
    const b = tree("b");
    tree("root", [a, b]);
    expect(followers(a, () => false).map((n) => n.name)).toEqual(["b"]);
  });
});

describe("slideOffsets", () => {
  test("each element starts where it was", () => {
    const before = [
      { left: 200, top: 0 },
      { left: 0, top: 120 },
    ];
    const after = [
      { left: 0, top: 0 },
      { left: 200, top: 0 },
    ];
    expect(slideOffsets(before, after)).toEqual([
      { dx: 200, dy: 0 },
      { dx: -200, dy: 120 },
    ]);
  });

  test("an element that did not move gets a zero offset", () => {
    expect(slideOffsets([{ left: 4, top: 8 }], [{ left: 4, top: 8 }])).toEqual([{ dx: 0, dy: 0 }]);
  });
});
