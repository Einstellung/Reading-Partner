// The shopping list's drawing order (src/info/meals/list-order.ts): settled on
// open, still while the screen is open.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  aislesOf,
  linesInOrder,
  orderShoppingLines,
  shoppingPreview,
  shoppingStatus,
} from "../../../src/info/meals/list-order";
import {
  addReaderItem,
  deriveShoppingList,
  markShoppingDone,
  setShoppingChecked,
  shoppingItemKey,
} from "../../../src/info/meals/shopping";
import type { ShoppingItem } from "../../../src/info/meals/types";
import { MON, shopping, week } from "./fixtures/week";

function listed() {
  return shopping({ items: deriveShoppingList(week(), MON) });
}

function reader(name: string): ShoppingItem {
  return {
    name,
    en: name,
    qty: "one bottle",
    category: "other",
    keeps: "pantry",
    freezeOnArrival: false,
    neededBy: "",
  };
}

test("a fresh order walks the aisles and sinks the ticked lines", () => {
  const state = listed();
  const first = orderShoppingLines(state);
  const bokChoy = shoppingItemKey({ name: "上海青", category: "produce" });
  expect(first.filter((k) => k.startsWith("produce"))[0]).toBe(bokChoy);

  const ticked = setShoppingChecked(state, bokChoy, true);
  const next = orderShoppingLines(ticked);
  const produce = next.filter((k) => k.startsWith("produce"));
  expect(produce[produce.length - 1]).toBe(bokChoy);
});

test("a line does not move while the screen is open", () => {
  const state = listed();
  const open = orderShoppingLines(state);
  const bokChoy = shoppingItemKey({ name: "上海青", category: "produce" });
  const ticked = setShoppingChecked(state, bokChoy, true);
  // The screen hands back the order it opened with, so the tick changes the box
  // and the count and nothing else.
  expect(orderShoppingLines(ticked, open)).toEqual(open);
});

test("a line added by talking joins the end of its aisle", () => {
  const state = listed();
  const open = orderShoppingLines(state);
  const added = addReaderItem(state, reader("washing up liquid"));
  const next = orderShoppingLines(added, open);
  expect(next.length).toBe(open.length + 1);
  expect(next.slice(0, open.length)).toEqual(open);
  const ordered = linesInOrder(added, next);
  expect(ordered[ordered.length - 1]?.name).toBe("washing up liquid");
});

test("the aisles keep the order the snapshot fixed", () => {
  const state = listed();
  const order = orderShoppingLines(state);
  const aisles = aislesOf(linesInOrder(state, order));
  expect(aisles.map((a) => a.label)).toEqual(["Produce", "Protein", "Dairy", "Frozen", "Grains", "Pantry"]);
  const flat = aisles.flatMap((a) => a.items.map(shoppingItemKey));
  expect(flat).toEqual(order);
});

test("the status line counts before the trip and names the day after it", () => {
  const state = listed();
  const lines = linesInOrder(state, orderShoppingLines(state));
  expect(shoppingStatus(state, lines)).toBe(`${lines.length} left`);

  const done = markShoppingDone(state, MON);
  expect(shoppingStatus(done, linesInOrder(done, orderShoppingLines(done)))).toBe("Bought · Monday");

  const later = addReaderItem(done, reader("milk"));
  const afterLines = linesInOrder(later, orderShoppingLines(later));
  expect(shoppingStatus(later, afterLines)).toBe("Bought · Monday · 1 to get");
});

test("the preview shows three and says how many more", () => {
  const state = listed();
  const lines = linesInOrder(state, orderShoppingLines(state));
  const preview = shoppingPreview(state, lines);
  expect(preview.items.length).toBe(3);
  expect(preview.more).toBe(`and ${lines.length - 3} more`);

  // After the trip it is what is still to be picked up, and when there is none
  // it says how the trip went.
  const done = markShoppingDone(state, MON);
  const doneLines = linesInOrder(done, orderShoppingLines(done));
  expect(shoppingPreview(done, doneLines)).toEqual({
    items: [],
    more: `${doneLines.length} you didn't get`,
  });
});
