import { expect, test } from "bun:test";
import { paperFulltextHash } from "../../../src/reading/prep/papers/store";
import {
  movePrep,
  paperSlugsOf,
  prepPaperCacheFiles,
  type PrepFilesIo,
} from "../../../src/reading/delete/prep-files";

function memIo(files: Map<string, string>): PrepFilesIo {
  return {
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
    readText: async (p) => {
      const t = files.get(p);
      if (t === undefined) throw new Error(`missing ${p}`);
      return t;
    },
    writeText: async (p, t) => void files.set(p, t),
    rename: async (a, b) => {
      for (const [k, v] of [...files]) {
        if (k === a || k.startsWith(`${a}/`)) {
          files.delete(k);
          files.set(b + k.slice(a.length), v);
        }
      }
    },
  };
}

const STATE = JSON.stringify({ version: 1, surveyHash: "old", papers: [{ slug: "p1" }, { slug: "p2" }] });

test("paperSlugsOf reads slugs and tolerates junk", () => {
  expect(paperSlugsOf(STATE)).toEqual(["p1", "p2"]);
  expect(paperSlugsOf("{not json")).toEqual([]);
  expect(paperSlugsOf(null)).toEqual([]);
});

test("the paper caches of a prep are found through its state", async () => {
  const files = new Map([["prep-old/state.json", STATE]]);
  const k1 = paperFulltextHash("old", "p1");
  expect(await prepPaperCacheFiles("old", memIo(files))).toContain(`fulltext-${k1}.json`);
  expect(await prepPaperCacheFiles("old", memIo(files))).toContain(`figures-${k1}.json`);
  expect(await prepPaperCacheFiles("none", memIo(files))).toEqual([]);
});

test("movePrep moves the directory, the ids inside it and the paper caches", async () => {
  const kOld = paperFulltextHash("old", "p1");
  const kNew = paperFulltextHash("new", "p1");
  const files = new Map([
    ["prep-old/state.json", STATE],
    ["prep-old/p1.md", "note"],
    ["prep-old/chapters/state.json", JSON.stringify({ version: 1, bookId: "old", chapters: [] })],
    [`fulltext-${kOld}.json`, "ft"],
  ]);
  expect(await movePrep("old", "new", memIo(files))).toBe(true);
  expect(files.get("prep-new/p1.md")).toBe("note");
  expect(JSON.parse(files.get("prep-new/state.json")!).surveyHash).toBe("new");
  expect(JSON.parse(files.get("prep-new/chapters/state.json")!).bookId).toBe("new");
  expect(files.get(`fulltext-${kNew}.json`)).toBe("ft");
  expect([...files.keys()].some((k) => k.startsWith("prep-old"))).toBe(false);
});

test("movePrep does not overwrite prep the target already has", async () => {
  const files = new Map([
    ["prep-old/p1.md", "old note"],
    ["prep-new/p1.md", "new note"],
  ]);
  expect(await movePrep("old", "new", memIo(files))).toBe(false);
  expect(files.get("prep-new/p1.md")).toBe("new note");
  expect(files.get("prep-old/p1.md")).toBe("old note");
});
