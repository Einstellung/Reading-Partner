import { describe, expect, test } from "bun:test";
import { roomsUsingSource } from "../../../../src/ui/components/info/sources-page";
import type { Lab } from "../../../../src/info/labs/types";

function lab(id: string, name: string, sources: string[], status: Lab["status"] = "active"): Lab {
  return {
    id,
    name,
    kind: "lab",
    status,
    charter: { scope: "", questions: [], topicId: null },
    sources,
    createdAt: 0,
  };
}

describe("roomsUsingSource", () => {
  test("names only the rooms that claimed the source", () => {
    const labs = [lab("lab-1", "Embodied AI", ["s1"]), lab("lab-2", "Macro", ["s2"])];
    expect(roomsUsingSource(labs, "s1")).toEqual(["Embodied AI"]);
    expect(roomsUsingSource(labs, "s2")).toEqual(["Macro"]);
  });

  test("a source two rooms claim names both, in stored order", () => {
    const labs = [lab("lab-1", "Embodied AI", ["s1"]), lab("lab-2", "Agents", ["s1"])];
    expect(roomsUsingSource(labs, "s1")).toEqual(["Embodied AI", "Agents"]);
  });

  test("an unclaimed source is read by every open room", () => {
    const labs = [lab("lab-1", "Embodied AI", ["s1"]), lab("lab-2", "Macro", [])];
    expect(roomsUsingSource(labs, "s9")).toEqual(["Embodied AI", "Macro"]);
  });

  test("archived rooms never appear", () => {
    const labs = [lab("lab-1", "Closed", ["s1"], "archived"), lab("lab-2", "Macro", ["s1"])];
    expect(roomsUsingSource(labs, "s1")).toEqual(["Macro"]);
    expect(roomsUsingSource(labs, "s9")).toEqual(["Macro"]);
  });

  test("no open room means no chips", () => {
    expect(roomsUsingSource([], "s1")).toEqual([]);
    expect(roomsUsingSource([lab("lab-1", "Closed", ["s1"], "archived")], "s1")).toEqual([]);
  });
});
