import { describe, expect, test } from "bun:test";
import { asArray, asString, asText, extractJson, isObject } from "../../../src/platform/std/json";

describe("extractJson", () => {
  test("takes the first { to the last }", () => {
    expect(extractJson('prose {"a": {"b": 1}} more')).toBe('{"a": {"b": 1}}');
  });

  test("unwraps a markdown fence first", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractJson('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  test("null when there is no object", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("} backwards {")).toBeNull();
  });
});

describe("value readers", () => {
  test("isObject takes plain objects only", () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject("x")).toBe(false);
  });

  test("asArray answers an array or an empty one", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray("x")).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });

  test("asText trims, asString keeps the whitespace", () => {
    expect(asText("  hi  ")).toBe("hi");
    expect(asString("  hi  ")).toBe("  hi  ");
    expect(asText(7)).toBe("");
    expect(asString(7)).toBe("");
  });
});
