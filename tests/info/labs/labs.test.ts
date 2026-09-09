// The pure half of the lab list: reading a file, and answering which rooms a
// source is screened for. Run: scripts/t.sh tests/info/labs

import { expect, test } from "bun:test";
import {
  activeLabs,
  labsFileBody,
  labsForSource,
  newLabId,
  parseLabsFile,
  validateLab,
} from "../../../src/info/labs/labs";
import { LABS_VERSION, type Lab } from "../../../src/info/labs/types";

function lab(id: string, over: Partial<Lab> = {}): Lab {
  return {
    id,
    name: id,
    kind: "lab",
    status: "active",
    charter: { scope: "s", questions: ["q"], topicId: null },
    sources: [],
    createdAt: 1,
    ...over,
  };
}

test("a file round-trips through the body writer and the parser", () => {
  const labs = [lab("lab-1"), lab("lab-2", { status: "archived", archivedAt: 9 })];
  const parsed = parseLabsFile(JSON.parse(labsFileBody(labs)));
  expect(parsed?.labs).toEqual(labs);
  expect(parsed?.foreign).toEqual([]);
  expect(parsed?.repaired).toBe(false);
});

test("the body carries the version", () => {
  expect(JSON.parse(labsFileBody([])).version).toBe(LABS_VERSION);
});

test("bytes that are not a labs file at all read as null", () => {
  expect(parseLabsFile(null)).toBeNull();
  expect(parseLabsFile([lab("lab-1")])).toBeNull();
  expect(parseLabsFile({ version: 1 })).toBeNull();
  expect(parseLabsFile("{}")).toBeNull();
});

test("an entry this build cannot read is kept as foreign, not dropped", () => {
  const parsed = parseLabsFile({
    version: 1,
    labs: [lab("lab-1"), { id: "lab-2", kind: "bureau", name: "x" }],
  });
  expect(parsed?.labs.map((l) => l.id)).toEqual(["lab-1"]);
  expect(parsed?.foreign).toEqual([{ id: "lab-2", kind: "bureau", name: "x" }]);
  expect(parsed?.repaired).toBe(false);
});

test("an entry with no id, or a repeat of one, is left behind and flagged", () => {
  const parsed = parseLabsFile({
    version: 1,
    labs: [lab("lab-1"), { name: "no id" }, lab("lab-1", { name: "again" })],
  });
  expect(parsed?.labs.map((l) => l.name)).toEqual(["lab-1"]);
  expect(parsed?.repaired).toBe(true);
});

test("a lab keeps fields this build has never heard of", () => {
  const read = validateLab({ ...lab("lab-1"), spectrum: "x" });
  expect((read as unknown as { spectrum: string }).spectrum).toBe("x");
});

test("a charter of the wrong shape makes the entry foreign", () => {
  expect(validateLab({ ...lab("lab-1"), charter: { scope: 1, questions: [], topicId: null } })).toBeNull();
  expect(validateLab({ ...lab("lab-1"), charter: { scope: "s", questions: "q", topicId: null } })).toBeNull();
  expect(validateLab({ ...lab("lab-1"), sources: [1] })).toBeNull();
  expect(validateLab({ ...lab("lab-1"), status: "paused" })).toBeNull();
});

test("only open rooms are active", () => {
  const labs = [lab("lab-1"), lab("lab-2", { status: "archived" })];
  expect(activeLabs(labs).map((l) => l.id)).toEqual(["lab-1"]);
});

test("a claimed source is screened for its claimants alone", () => {
  const labs = [lab("lab-1", { sources: ["src-a"] }), lab("lab-2"), lab("lab-3", { sources: ["src-a"] })];
  expect(labsForSource(labs, "src-a").map((l) => l.id)).toEqual(["lab-1", "lab-3"]);
});

test("a source nobody claims is offered to every open room", () => {
  const labs = [lab("lab-1", { sources: ["src-a"] }), lab("lab-2"), lab("lab-3", { status: "archived" })];
  expect(labsForSource(labs, "src-b").map((l) => l.id)).toEqual(["lab-1", "lab-2"]);
});

test("an archived room's claim does not keep a source from the open ones", () => {
  const labs = [lab("lab-1", { sources: ["src-a"], status: "archived" }), lab("lab-2")];
  expect(labsForSource(labs, "src-a").map((l) => l.id)).toEqual(["lab-2"]);
});

test("no rooms at all is no labs to screen for", () => {
  expect(labsForSource([], "src-a")).toEqual([]);
});

test("an id is eight hex digits off the injected random", () => {
  const digits = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.99];
  let i = 0;
  expect(newLabId(() => digits[i++] as number)).toBe("lab-0134689f");
  expect(newLabId(() => 0)).toBe("lab-00000000");
});
