// Which workflow artifacts scripts/prune-artifacts.ts deletes: the current
// major.minor line and the three lines before it that occur are kept, older
// ones go, an unreadable version is never deleted. Run: bun test.

import { expect, test } from "bun:test";
import { artifactsToDelete, keptLines, lineOf } from "../../scripts/prune-artifacts";

const a = (id: number, version: string | null) => ({ id, version });

test("lineOf reads major.minor and rejects what is not a version", () => {
  expect(lineOf("0.21.6")).toEqual([0, 21]);
  expect(lineOf("v1.2.0-beta.1")).toEqual([1, 2]);
  expect(lineOf("0.21")).toBeNull();
  expect(lineOf("")).toBeNull();
  expect(lineOf(null)).toBeNull();
});

test("keeps the current line and three before it, deletes older", () => {
  const artifacts = [
    a(1, "0.21.6"),
    a(2, "0.20.5"),
    a(3, "0.19.1"),
    a(4, "0.18.0"),
    a(5, "0.17.2"),
    a(6, "0.16.0"),
  ];
  expect(artifactsToDelete("0.21.6", artifacts).sort()).toEqual([5, 6]);
});

test("every patch of a kept line stays", () => {
  const artifacts = [a(1, "0.21.0"), a(2, "0.21.3"), a(3, "0.21.6"), a(4, "0.20.1"), a(5, "0.20.6")];
  expect(artifactsToDelete("0.21.6", artifacts)).toEqual([]);
});

test("across a major the older lines come from the lines that occur, not subtraction", () => {
  const artifacts = [
    a(1, "1.2.0"),
    a(2, "1.1.3"),
    a(3, "1.0.0"),
    a(4, "0.21.6"),
    a(5, "0.20.1"),
    a(6, "0.9.0"),
  ];
  expect(keptLines("1.2.0", artifacts.map((x) => x.version))).toEqual(["1.2", "1.1", "1.0", "0.21"]);
  expect(artifactsToDelete("1.2.0", artifacts).sort()).toEqual([5, 6]);
});

test("gaps between lines are skipped over, not counted", () => {
  const artifacts = [a(1, "0.21.0"), a(2, "0.15.0"), a(3, "0.12.0"), a(4, "0.10.0"), a(5, "0.9.0")];
  expect(artifactsToDelete("0.21.0", artifacts)).toEqual([5]);
});

test("the current line counts as one of the four even with no artifacts of its own", () => {
  const artifacts = [a(1, "0.20.0"), a(2, "0.19.0"), a(3, "0.18.0"), a(4, "0.17.0")];
  expect(artifactsToDelete("0.21.0", artifacts)).toEqual([4]);
});

test("an artifact whose version could not be read is kept", () => {
  const artifacts = [a(1, null), a(2, "garbage"), a(3, "0.10.0"), a(4, "0.21.0")];
  expect(artifactsToDelete("0.21.0", artifacts)).toEqual([]);
  const withOlder = [...artifacts, a(5, "0.20.0"), a(6, "0.19.0"), a(7, "0.18.0")];
  expect(artifactsToDelete("0.21.0", withOlder)).toEqual([3]);
});

test("a build newer than the current line is kept", () => {
  const artifacts = [a(1, "0.22.0"), a(2, "0.21.0"), a(3, "0.20.0"), a(4, "0.19.0"), a(5, "0.18.0")];
  expect(artifactsToDelete("0.21.0", artifacts)).toEqual([]);
});

test("an unreadable current version refuses instead of deleting", () => {
  expect(() => artifactsToDelete("dev", [a(1, "0.1.0")])).toThrow();
});
