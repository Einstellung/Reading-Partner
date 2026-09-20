// The repairs the app runs once on the way up
// (src/reading/session/startup-repairs). Run: bun test.

import { expect, test } from "bun:test";
import {
  runStartupRepairs,
  type StartupRepairIo,
} from "../../../src/reading/session/startup-repairs";

function fakeIo(over: Partial<StartupRepairIo> = {}): StartupRepairIo {
  return {
    repairTopicPaths: async () => false,
    repairLibraryNames: async () => false,
    ...over,
  };
}

test("a launch with nothing to repair is no reason to re-read the shelf", async () => {
  expect(await runStartupRepairs(fakeIo())).toBe(false);
});

test("a repair that rewrote something is a reason to re-read the shelf", async () => {
  expect(await runStartupRepairs(fakeIo({ repairTopicPaths: async () => true }))).toBe(true);
  expect(await runStartupRepairs(fakeIo({ repairLibraryNames: async () => true }))).toBe(true);
});

test("a repair that throws takes neither the other one nor the launch down", async () => {
  const io = fakeIo({
    repairTopicPaths: async () => {
      throw new Error("disk gone");
    },
    repairLibraryNames: async () => true,
  });
  expect(await runStartupRepairs(io)).toBe(false);
});
