// The streaming reply's tool-call trace (src/ai/tool-status), shared
// by the reading companion and the info companion. Pure. Run: bun test.

import { expect, test } from "bun:test";
import {
  appendRunningTool,
  relabelRunningTool,
  resolveToolStatus,
} from "../../src/ai/tool-status";

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

// A long-running sub-agent gets one row, kept alive in place (docs/25). A second row
// per progress event would be the tool trace the sub-agent exists to keep out.
test("a running tool's label is rewritten in place, not appended", () => {
  const tools = appendRunningTool(undefined, "research_literature", "Searching the literature");
  expect(relabelRunningTool(tools, "research_literature", "Searching the literature (3/6)")).toEqual([
    { name: "research_literature", label: "Searching the literature (3/6)", state: "running" },
  ]);
});

test("the same label again, a finished tool and an absent one all leave the message alone", () => {
  const tools = appendRunningTool(undefined, "research_literature", "Searching the literature");
  expect(relabelRunningTool(tools, "research_literature", "Searching the literature")).toBeNull();
  expect(relabelRunningTool(tools, "read_pages", "Reading page 3")).toBeNull();
  const done = resolveToolStatus(tools, "research_literature", true)!;
  expect(relabelRunningTool(done, "research_literature", "Searching the literature (3/6)")).toBeNull();
});
