// The streaming reply's tool-call trace (src/ui/components/common/toolTrace), shared
// by the reading companion and the info companion. Pure. Run: bun test.

import { expect, test } from "bun:test";
import { appendRunningTool, resolveToolStatus } from "../../../src/ui/components/common/toolTrace";

test("a started tool is appended as running", () => {
  expect(appendRunningTool(undefined, "read_pages", "Reading pages")).toEqual([
    { name: "read_pages", label: "Reading pages", state: "running" },
  ]);
});

test("a successful tool is dropped", () => {
  const tools = appendRunningTool(undefined, "read_pages", "Reading pages");
  expect(resolveToolStatus(tools, "read_pages", false)).toEqual([]);
});

test("a failed tool stays visible as an error", () => {
  const tools = appendRunningTool(undefined, "read_pages", "Reading pages");
  expect(resolveToolStatus(tools, "read_pages", true)).toEqual([
    { name: "read_pages", label: "Reading pages", state: "error" },
  ]);
});

test("the last running status of that name is the one resolved", () => {
  let tools = appendRunningTool(undefined, "read_pages", "first");
  tools = appendRunningTool(tools, "read_pages", "second");
  expect(resolveToolStatus(tools, "read_pages", false)).toEqual([
    { name: "read_pages", label: "first", state: "running" },
  ]);
});

test("an already-errored status is not resolved again", () => {
  const tools = resolveToolStatus(appendRunningTool(undefined, "x", "X"), "x", true)!;
  expect(resolveToolStatus(tools, "x", false)).toBeNull();
});

test("no match leaves the caller's message alone", () => {
  expect(resolveToolStatus([], "read_pages", false)).toBeNull();
  expect(resolveToolStatus(undefined, "read_pages", true)).toBeNull();
});
