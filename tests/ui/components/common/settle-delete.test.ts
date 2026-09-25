// A confirmed delete from a list: a failure is told to the reader and the list
// is reread either way.

import { expect, test } from "bun:test";

import { deleteFailedLine, settleDelete } from "../../../../src/ui/components/common/settle-delete";

test("a delete that works rereads the list and says nothing", async () => {
  const calls: string[] = [];
  const ok = await settleDelete({
    act: async () => void calls.push("act"),
    refresh: async () => void calls.push("refresh"),
    failed: "Could not delete the book",
    onFail: (line) => calls.push(`fail:${line}`),
  });
  expect(ok).toBe(true);
  expect(calls).toEqual(["act", "refresh"]);
});

test("a delete that throws is told to the reader and the list is still reread", async () => {
  const calls: string[] = [];
  const ok = await settleDelete({
    act: async () => {
      calls.push("act");
      throw new Error("disk full");
    },
    refresh: () => void calls.push("refresh"),
    failed: "Could not delete “Physics”",
    onFail: (line) => calls.push(`fail:${line}`),
  });
  expect(ok).toBe(false);
  expect(calls).toEqual(["act", "fail:Could not delete “Physics”: disk full", "refresh"]);
});

test("a thrown non-Error still makes a line", () => {
  expect(deleteFailedLine("Could not remove the source", "nope")).toBe("Could not remove the source: nope");
});
