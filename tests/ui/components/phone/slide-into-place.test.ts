import { describe, expect, test } from "bun:test";
import {
  movingGroups,
  movingSlots,
  slideOffsets,
  type TreeNode,
} from "../../../../src/ui/components/phone/slide-into-place";

interface Node extends TreeNode {
  name: string;
  kids: Node[];
  gone: boolean;
  parentElement: Node | null;
  previousElementSibling: Node | null;
  nextElementSibling: Node | null;
}

function tree(name: string, kids: Node[] = []): Node {
  const n: Node = {
    name,
    kids: [],
    gone: false,
    parentElement: null,
    previousElementSibling: null,
    nextElementSibling: null,
  };
  setKids(n, kids);
  return n;
}

// What a render leaves: the container's children now, siblings relinked.
function setKids(n: Node, kids: Node[]) {
  n.kids = kids;
  kids.forEach((k, i) => {
    k.parentElement = n;
    k.previousElementSibling = kids[i - 1] ?? null;
    k.nextElementSibling = kids[i + 1] ?? null;
  });
}

const childrenOf = (n: Node) => (n.gone ? null : n.kids);
const names = (slots: (Node | null)[]) => slots.map((n) => n?.name ?? null);

function slotsOf(el: Node, stop: (n: Node) => boolean) {
  const groups = movingGroups(el, stop);
  return { groups, before: movingSlots(groups, childrenOf) };
}

const rowsOf = (count: number) => Array.from({ length: count }, (_, i) => tree(`node${i}`));

describe("movingGroups and movingSlots", () => {
  test("the siblings, then the siblings of each ancestor, up to the scroller", () => {
    const [a, b, c] = ["a", "b", "c"].map((n) => tree(n)) as [Node, Node, Node];
    const books = tree("books", [a, b, c]);
    const heading = tree("articles-heading");
    const articles = tree("articles", [tree("x")]);
    const top = tree("top");
    const scroller = tree("scroller", [top, books, heading, articles]);
    tree("screen", [tree("header"), scroller, tree("footer")]);
    const { groups, before } = slotsOf(b, (n) => n === scroller);
    expect(groups.map((g) => [g.parent.name, g.lead, g.trail])).toEqual([
      ["books", 1, 1],
      ["scroller", 1, 2],
    ]);
    expect(names(before)).toEqual(["a", "c", "top", "articles-heading", "articles"]);
  });

  test("an only child has nothing around it", () => {
    const a = tree("a");
    const list = tree("list", [a]);
    expect(movingGroups(a, (n) => n === list)).toEqual([]);
  });

  test("stops at the root when no scroller is found", () => {
    const a = tree("a");
    const b = tree("b");
    tree("root", [a, b]);
    expect(names(slotsOf(a, () => false).before)).toEqual(["b"]);
  });

  test("kept nodes: each element pairs with itself once the item is out", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((n) => tree(n)) as [Node, Node, Node, Node];
    const grid = tree("grid", [a, b, c, d]);
    const { groups, before } = slotsOf(b, (n) => n === grid);
    setKids(grid, [a, c, d]);
    expect(slotNames(groups)).toEqual(names(before));
  });

  test("reused nodes: the rows after the item are found by order, not by node", () => {
    // Rows keyed by position: dropping row 1 gives node 1 row 2's content,
    // node 2 row 3's, and removes the last node.
    const rows = rowsOf(4);
    const aside = tree("aside");
    setKids(rows[1]!, [aside]);
    const list = tree("list", rows);
    const { groups, before } = slotsOf(aside, (n) => n === list);
    expect(names(before)).toEqual(["node0", "node2", "node3"]);
    setKids(rows[1]!, []);
    setKids(list, rows.slice(0, 3));
    // Row 2 was drawn by node2 and is now drawn by node1, and so on.
    expect(slotNames(groups)).toEqual(["node0", "node1", "node2"]);
  });

  test("reused nodes, one row after the item: its content moved up a node", () => {
    const rows = rowsOf(3);
    const aside = tree("aside");
    setKids(rows[1]!, [aside]);
    const list = tree("list", rows);
    const { groups } = slotsOf(aside, (n) => n === list);
    setKids(list, rows.slice(0, 2));
    expect(slotNames(groups)).toEqual(["node0", "node1"]);
  });

  test("a container that stays keeps its own place out of both sides", () => {
    const [r0, r1, r2] = ["r0", "r1", "r2"].map((n) => tree(n)) as [Node, Node, Node];
    const card = tree("card", [r0, r1, r2]);
    const list = tree("list", [tree("above"), card, tree("below")]);
    const { groups } = slotsOf(r1, (n) => n === list);
    setKids(card, [r0, r2]);
    expect(slotNames(groups)).toEqual(["r0", "r2", "above", "below"]);
  });

  test("what sat in a container that left the document comes back empty", () => {
    const aside = tree("aside");
    const card = tree("card", [aside, tree("after")]);
    const list = tree("list", [card, tree("next")]);
    const { groups, before } = slotsOf(aside, (n) => n === list);
    expect(names(before)).toEqual(["after", "next"]);
    card.gone = true;
    setKids(list, [list.kids[1]!]);
    expect(slotNames(groups)).toEqual([null, "next"]);
  });

  test("a container left with fewer children does not hand one element to both sides", () => {
    const rows = rowsOf(5);
    const list = tree("list", rows);
    const { groups } = slotsOf(rows[2]!, (n) => n === list);
    setKids(list, rows.slice(0, 3));
    expect(slotNames(groups)).toEqual(["node0", "node1", null, "node2"]);
  });
});

function slotNames(groups: ReturnType<typeof movingGroups<Node>>) {
  return names(movingSlots(groups, childrenOf));
}

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
