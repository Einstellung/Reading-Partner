// The sheets kept in reserve, and the line the reserve must not cross.
//
// A released sheet keeps its spine document mounted so that the next page of
// the same document costs a transform instead of a clone and a column layout
// (card-pool.ts). That changes how a page is drawn and when, never where the
// book breaks into pages: the table is cut once by the ruler and synced between
// devices, so a page that moved would move every [p.N] already written down
// (docs/64). The second half of this file pins the table.

import { describe, expect, test } from "bun:test";

import { CARD_POOL_LIMIT, createCardPool } from "../../../src/reading/epub/card-pool";
import { paginate, characterRuler } from "../../../src/reading/epub/paginate";
import { parseEpub } from "../../../src/reading/epub/parse";
import { buildEpub } from "./fixture";

interface FakeCard {
  id: string;
  spine: number | null;
  cleared: number;
  clear(): void;
}

function card(id: string, spine: number | null): FakeCard {
  return {
    id,
    spine,
    cleared: 0,
    clear() {
      this.cleared++;
      this.spine = null;
    },
  };
}

describe("the card pool", () => {
  test("an empty pool has nothing to hand out", () => {
    const pool = createCardPool<FakeCard>();
    expect(pool.take(0)).toBe(null);
    expect(pool.size()).toBe(0);
  });

  test("a page of a document already mounted gets that card back", () => {
    const pool = createCardPool<FakeCard>();
    const a = card("a", 0);
    const b = card("b", 3);
    const c = card("c", 0);
    pool.give(a);
    pool.give(b);
    pool.give(c);
    // The most recently released card holding the document, so the one that
    // just left the window is the one that comes back.
    expect(pool.take(0)?.id).toBe("c");
    expect(pool.take(3)?.id).toBe("b");
    expect(pool.take(0)?.id).toBe("a");
    expect(pool.size()).toBe(0);
  });

  test("a card handed out keeps what it holds: nothing is emptied on the way", () => {
    const pool = createCardPool<FakeCard>();
    const a = card("a", 2);
    pool.give(a);
    const out = pool.take(2);
    expect(out).toBe(a);
    expect(a.cleared).toBe(0);
    expect(a.spine).toBe(2);
  });

  test("a page of a document the pool does not hold takes the newest card", () => {
    const pool = createCardPool<FakeCard>();
    const a = card("a", 0);
    const b = card("b", 1);
    pool.give(a);
    pool.give(b);
    expect(pool.take(9)?.id).toBe("b");
    expect(pool.take(9)?.id).toBe("a");
  });

  test("the reserve is capped, and the card idle longest is the one emptied", () => {
    const pool = createCardPool<FakeCard>(2);
    const a = card("a", 0);
    const b = card("b", 1);
    const c = card("c", 2);
    pool.give(a);
    pool.give(b);
    pool.give(c);
    expect(pool.size()).toBe(2);
    expect(a.cleared).toBe(1);
    expect(b.cleared).toBe(0);
    expect(c.cleared).toBe(0);
    // The emptied card is gone from the pool, not handed out blank.
    expect(pool.take(0)?.id).toBe("c");
    expect(pool.take(0)?.id).toBe("b");
    expect(pool.take(0)).toBe(null);
  });

  test("the default cap keeps a scroll's worth of sheets and no more", () => {
    const pool = createCardPool<FakeCard>();
    const made = Array.from({ length: CARD_POOL_LIMIT + 2 }, (_, i) => card(`c${i}`, i));
    for (const c of made) pool.give(c);
    expect(pool.size()).toBe(CARD_POOL_LIMIT);
    expect(made.filter((c) => c.cleared > 0)).toHaveLength(2);
  });

  test("draining empties everything held and leaves the pool empty", () => {
    const pool = createCardPool<FakeCard>();
    const a = card("a", 0);
    const b = card("b", 1);
    pool.give(a);
    pool.give(b);
    pool.drain();
    expect(a.cleared).toBe(1);
    expect(b.cleared).toBe(1);
    expect(pool.size()).toBe(0);
    expect(pool.take(0)).toBe(null);
  });
});

// --- where the pages break ---------------------------------------------------

const LINE = "Sheets of paper carry the same words on every device. ";

function pagedBook(): Uint8Array {
  return buildEpub({
    docs: [
      { name: "c1.xhtml", body: `<p>${LINE.repeat(20)}</p>` },
      { name: "c2.xhtml", body: `<p>${LINE.repeat(12)}</p>` },
    ],
  });
}

describe("the pagination table", () => {
  test("breaks the book where it has always broken it", async () => {
    const pagination = await paginate(parseEpub(pagedBook()), characterRuler(400));
    expect(pagination.version).toBe(2);
    expect(pagination.geometry.width).toBe(816);
    expect(
      pagination.blocks.map((b) => [b.spine, b.charOffset, b.endOffset, b.cfi]),
    ).toEqual([
      [0, 0, 400, "epubcfi(/6/2[c0]!/4/2/1:0)"],
      [0, 400, 800, "epubcfi(/6/2[c0]!/4/2/1:400)"],
      [0, 800, 1081, "epubcfi(/6/2[c0]!/4/2/1:800)"],
      [1, 0, 400, "epubcfi(/6/4[c1]!/4/2/1:0)"],
      [1, 400, 649, "epubcfi(/6/4[c1]!/4/2/1:400)"],
    ]);
  });
});
