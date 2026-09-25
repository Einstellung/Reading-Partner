// Deleting a retell takes its talk first (src/reading/delete/delete-retell.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  deleteRetellWithTalk,
  type DeleteRetellDeps,
} from "../../../src/reading/delete/delete-retell";

function deps(calls: string[], outline: string | null): DeleteRetellDeps {
  return {
    outlineIdOfRetell: async () => outline,
    deleteTalkOutline: async (id) => {
      calls.push(`outline ${id}`);
    },
    deleteRetell: async (id) => {
      calls.push(`retell ${id}`);
    },
  };
}

test("the outline goes before the retell it came out of", async () => {
  const calls: string[] = [];
  await deleteRetellWithTalk("r1", deps(calls, "o1"));
  expect(calls).toEqual(["outline o1", "retell r1"]);
});

test("a retell with no talk is deleted alone", async () => {
  const calls: string[] = [];
  await deleteRetellWithTalk("r1", deps(calls, null));
  expect(calls).toEqual(["retell r1"]);
});

test("an outline that will not delete keeps the retell", async () => {
  const calls: string[] = [];
  const d = deps(calls, "o1");
  d.deleteTalkOutline = async () => {
    throw new Error("no");
  };
  await expect(deleteRetellWithTalk("r1", d)).rejects.toThrow("no");
  expect(calls).toEqual([]);
});
