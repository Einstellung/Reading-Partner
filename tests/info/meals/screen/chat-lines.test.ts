// The meals words the chat and the home card draw, in the reader's language:
// the line after the plan card's Apply, the receipt's profile fields, and the
// shopping card's status (src/info/meals/screen/view.ts, list-order.ts).
// Run: scripts/t.sh tests/info/meals/screen/chat-lines.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { appliedLine, profileFieldsLine } from "../../../../src/info/meals/screen/view";
import { shoppingPreview, shoppingStatus } from "../../../../src/info/meals/screen/list-order";
import type { ShoppingItem, ShoppingState } from "../../../../src/info/meals/plan/types";

let before: Locale;
beforeEach(() => {
  before = getLocale();
});
afterEach(() => setLocale(before));

const WED = "2026-10-14";

test("the applied line is the reader's language and carries the list's counts", () => {
  setLocale("zh-CN");
  expect(appliedLine({ adjustment: false, changed: [], toBuy: 61, freeze: 2 })).toBe(
    "已存好这一周 · 采购单 61 样 · 2 样到家冷冻",
  );
  const change = appliedLine({
    adjustment: true,
    changed: [{ date: WED, meal: "lunch" }],
    toBuy: 3,
    freeze: 0,
  });
  expect(change).toContain("午餐");
  expect(change).toContain("采购单 3 样");
  expect(change).not.toMatch(/[A-Za-z]/);
  setLocale("en");
  expect(appliedLine({ adjustment: false, changed: [], toBuy: 61, freeze: 0 })).toBe(
    "Saved the week · 61 to buy",
  );
});

test("a profile receipt names the fields as the reader calls them", () => {
  setLocale("zh-CN");
  expect(profileFieldsLine(["weightKg", "notes"])).toBe("体重、备注");
  // A name the profile does not have is not printed raw.
  expect(profileFieldsLine(["nonsense"])).toBe("");
});

function line(name: string): ShoppingItem {
  return { name, en: name, qty: "1", category: "other", keeps: "d1-2", freezeOnArrival: false, neededBy: WED } as ShoppingItem;
}

test("the shopping card's status and preview follow the language", () => {
  setLocale("zh-CN");
  const lines = ["a", "b", "c", "d", "e"].map(line);
  const state = { checked: {}, added: [], removed: [] } as unknown as ShoppingState;
  expect(shoppingStatus(state, lines)).not.toMatch(/left/);
  expect(shoppingPreview(state, lines).more).toBe("还有 2 样");
});
