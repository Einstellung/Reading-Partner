// The toast list. Radix runs one countdown per toast and they can finish in any
// order, so removal has to go by id.

import { expect, test } from "bun:test";
import {
  addToast,
  removeToast,
  type ToastItem,
} from "../../../src/ui/components/common/toast-list";

const A: ToastItem = { id: "a", kind: "warn", message: "one" };
const B: ToastItem = { id: "b", kind: "error", message: "two" };

test("a toast is appended, so the newest is at the bottom of the stack", () => {
  expect(addToast(addToast([], A), B)).toEqual([A, B]);
});

test("removal takes the entry with that id, whatever its position", () => {
  expect(removeToast([A, B], "a")).toEqual([B]);
});

test("a countdown that fires after its toast is gone changes nothing", () => {
  const list = removeToast([A, B], "a");
  expect(removeToast(list, "a")).toEqual([B]);
});

test("the list is replaced, not mutated", () => {
  const list = [A];
  addToast(list, B);
  removeToast(list, "a");
  expect(list).toEqual([A]);
});
