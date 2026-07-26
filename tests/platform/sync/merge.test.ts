// The three-way merge, checked mostly as properties rather than examples. The
// module exists so a desktop and an iPad that both edited a file offline can
// merge it independently and land on the same bytes, so the interesting tests
// are the ones that run every case twice with the sides swapped.
// Run: bun test.

import { expect, test } from "bun:test";
import { strategyFor, type MergeOutput } from "../../../src/platform/sync/merge/contract";
import { conflictCopyPath, mergeFile } from "../../../src/platform/sync/merge";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytes(text: string): Uint8Array {
  return enc.encode(text);
}

function text(b: Uint8Array): string {
  return dec.decode(b);
}

// How the app writes every JSON file it syncs.
function json(value: unknown): Uint8Array {
  return bytes(JSON.stringify(value, null, 2));
}

function merge(
  path: string,
  base: Uint8Array | null,
  local: Uint8Array,
  remote: Uint8Array,
): MergeOutput {
  return mergeFile({ path, base, local, remote });
}

function merged(path: string, base: Uint8Array | null, local: Uint8Array, remote: Uint8Array): string {
  return text(merge(path, base, local, remote).merged);
}

// --- strategy classification ------------------------------------------------

test("the files the app writes are classified by what they hold", () => {
  expect(strategyFor("annotations-abc123.json")).toBe("records");
  expect(strategyFor("threads-abc123.json")).toBe("records");
  expect(strategyFor("library.json")).toBe("records");
  expect(strategyFor("topics.json")).toBe("records");
  expect(strategyFor("reading-state.json")).toBe("records");
  expect(strategyFor("info-sources.json")).toBe("records");
  expect(strategyFor("info-feedback.jsonl")).toBe("records");
  expect(strategyFor("settings.json")).toBe("fields");
  expect(strategyFor("notes-abc/state.json")).toBe("fields");
  expect(strategyFor("prep-abc/state.json")).toBe("fields");
  expect(strategyFor("notes-abc/chapter-01.md")).toBe("prose");
  expect(strategyFor("info-profile.md")).toBe("prose");
  expect(strategyFor("library/abc.pdf")).toBe("opaque");
});

// --- records ----------------------------------------------------------------

const ann = (id: string, note: string) => ({ id, type: "highlight", note });

test("an annotation only one side touched is taken from that side", () => {
  const base = json([ann("a", "one"), ann("b", "two")]);
  const local = json([ann("a", "one edited"), ann("b", "two")]);
  const remote = json([ann("a", "one"), ann("b", "two edited")]);
  const out = merge("annotations-x.json", base, local, remote);
  expect(text(out.merged)).toBe(JSON.stringify([ann("a", "one edited"), ann("b", "two edited")], null, 2));
  expect(out.contested).toBe(false);
  expect(out.dropped).toEqual([]);
});

test("an annotation both sides edited is settled by content and reported", () => {
  const base = json([ann("a", "one")]);
  const local = json([ann("a", "from the desk")]);
  const remote = json([ann("a", "from the iPad")]);
  const out = merge("annotations-x.json", base, local, remote);
  expect(out.contested).toBe(true);
  // The version that lost is journalled, not thrown away.
  expect(out.dropped).toHaveLength(1);
  expect(out.dropped[0].id).toBe("a");
  const kept = JSON.parse(text(out.merged)) as { note: string }[];
  const lost = out.dropped[0].record as { note: string };
  expect([kept[0].note, lost.note].sort()).toEqual(["from the desk", "from the iPad"]);
});

test("a record one side deleted and the other left alone is dropped", () => {
  const base = json([ann("a", "one"), ann("b", "two")]);
  const local = json([ann("a", "one")]);
  const remote = json([ann("a", "one"), ann("b", "two")]);
  const out = merge("annotations-x.json", base, local, remote);
  expect(text(out.merged)).toBe(JSON.stringify([ann("a", "one")], null, 2));
  expect(out.dropped).toEqual([{ id: "b", record: ann("b", "two") }]);
  expect(out.contested).toBe(false);
});

test("an edit outranks a delete", () => {
  const base = json([ann("a", "one"), ann("b", "two")]);
  const local = json([ann("a", "one")]);
  const remote = json([ann("a", "one"), ann("b", "two, with more")]);
  expect(merged("annotations-x.json", base, local, remote)).toBe(
    JSON.stringify([ann("a", "one"), ann("b", "two, with more")], null, 2),
  );
  expect(merged("annotations-x.json", base, remote, local)).toBe(
    JSON.stringify([ann("a", "one"), ann("b", "two, with more")], null, 2),
  );
});

test("with no base nothing is deleted: the two sides are unioned", () => {
  const local = json([ann("a", "one")]);
  const remote = json([ann("b", "two")]);
  const out = merge("annotations-x.json", null, local, remote);
  const ids = (JSON.parse(text(out.merged)) as { id: string }[]).map((r) => r.id);
  expect(ids.sort()).toEqual(["a", "b"]);
  expect(out.dropped).toEqual([]);
});

test("records the base already had keep the base's order, additions follow", () => {
  const base = json([ann("a", "1"), ann("b", "2"), ann("c", "3")]);
  const local = json([ann("a", "1"), ann("b", "2"), ann("c", "3"), ann("d", "4")]);
  const remote = json([ann("c", "3"), ann("b", "2"), ann("a", "1")]);
  const ids = (JSON.parse(merged("annotations-x.json", base, local, remote)) as { id: string }[]).map(
    (r) => r.id,
  );
  expect(ids).toEqual(["a", "b", "c", "d"]);
});

test("a keyed map merges per key and keeps the wrapper", () => {
  const entry = (hash: string, title: string) => ({ hash, title, originalFilename: `${title}.pdf`, addedAt: 1 });
  const base = json({ books: { x: entry("x", "X"), y: entry("y", "Y") } });
  const local = json({ books: { x: entry("x", "X renamed"), y: entry("y", "Y") } });
  const remote = json({ books: { x: entry("x", "X"), y: entry("y", "Y"), z: entry("z", "Z") } });
  const out = merge("library.json", base, local, remote);
  expect(text(out.merged)).toBe(
    JSON.stringify(
      { books: { x: entry("x", "X renamed"), y: entry("y", "Y"), z: entry("z", "Z") } },
      null,
      2,
    ),
  );
  expect(out.contested).toBe(false);
});

test("threads merge per thread, not per file", () => {
  const thread = (id: string, n: number) => ({
    id,
    annotationId: "",
    path: "book",
    createdAt: 1,
    messages: Array.from({ length: n }, (_, i) => ({ role: "user", text: `m${i}`, ts: i })),
  });
  const base = json({ threads: { t1: thread("t1", 1) } });
  const local = json({ threads: { t1: thread("t1", 2) } });
  const remote = json({ threads: { t1: thread("t1", 1), t2: thread("t2", 1) } });
  const out = merge("threads-book.json", base, local, remote);
  expect(text(out.merged)).toBe(
    JSON.stringify({ threads: { t1: thread("t1", 2), t2: thread("t2", 1) } }, null, 2),
  );
});

test("reading positions merge per book", () => {
  const base = json({ states: { b1: { pageIndex: 3, scale: "auto", scrollMode: 0 } } });
  const local = json({ states: { b1: { pageIndex: 9, scale: "auto", scrollMode: 0 } } });
  const remote = json({
    states: { b1: { pageIndex: 3, scale: "auto", scrollMode: 0 }, b2: { pageIndex: 1, scale: "auto", scrollMode: 0 } },
  });
  expect(merged("reading-state.json", base, local, remote)).toBe(
    JSON.stringify(
      {
        states: {
          b1: { pageIndex: 9, scale: "auto", scrollMode: 0 },
          b2: { pageIndex: 1, scale: "auto", scrollMode: 0 },
        },
      },
      null,
      2,
    ),
  );
});

test("topics merge per topic under their wrapper", () => {
  const topic = (id: string, name: string) => ({ id, name, createdAt: 1, files: [] });
  const base = json({ topics: [topic("t1", "One")] });
  const local = json({ topics: [topic("t1", "One"), topic("t2", "Two")] });
  const remote = json({ topics: [topic("t1", "Uno")] });
  expect(merged("topics.json", base, local, remote)).toBe(
    JSON.stringify({ topics: [topic("t1", "Uno"), topic("t2", "Two")] }, null, 2),
  );
});

test("the source list merges per source", () => {
  const source = (id: string, enabled: boolean) => ({ id, kind: "rss", url: `https://${id}`, enabled });
  const base = json([source("a", true), source("b", true)]);
  const local = json([source("a", false), source("b", true)]);
  const remote = json([source("a", true), source("b", true), source("c", true)]);
  expect(merged("info-sources.json", base, local, remote)).toBe(
    JSON.stringify([source("a", false), source("b", true), source("c", true)], null, 2),
  );
});

test("the feedback log unions its lines and keeps the trailing newline", () => {
  const line = (ts: number) => JSON.stringify({ ts, itemId: `i${ts}`, title: "t", action: "opened" });
  const base = bytes(`${line(1)}\n`);
  const local = bytes(`${line(1)}\n${line(2)}\n`);
  const remote = bytes(`${line(1)}\n${line(3)}\n`);
  const out = merge("info-feedback.jsonl", base, local, remote);
  const lines = text(out.merged).trimEnd().split("\n");
  expect(lines[0]).toBe(line(1));
  expect(lines.slice(1).sort()).toEqual([line(2), line(3)].sort());
  expect(text(out.merged).endsWith("\n")).toBe(true);
  expect(out.contested).toBe(false);
});

test("the case this exists for: a week of marks on each device, and both survive", () => {
  const base = json([ann("a", "1"), ann("b", "2"), ann("c", "3")]);
  const local = json([ann("a", "1"), ann("b", "2"), ann("c", "3"), ann("d", "desk"), ann("e", "desk")]);
  const remote = json([ann("a", "1"), ann("b", "2"), ann("c", "3"), ann("f", "iPad"), ann("g", "iPad")]);
  const ids = (JSON.parse(merged("annotations-x.json", base, local, remote)) as { id: string }[]).map(
    (r) => r.id,
  );
  expect(ids.slice(0, 3)).toEqual(["a", "b", "c"]);
  expect(ids.slice(3).sort()).toEqual(["d", "e", "f", "g"]);
});

test("a file that was empty at the last sync is not reflowed on the way back", () => {
  const base = json([]);
  const local = json([ann("a", "desk")]);
  const remote = json([ann("b", "iPad")]);
  const out = text(merge("annotations-x.json", base, local, remote).merged);
  expect(out).toBe(JSON.stringify(JSON.parse(out), null, 2));
});

test("malformed JSON on either side keeps both files whole instead of throwing", () => {
  const base = json([ann("a", "one")]);
  const good = json([ann("a", "edited")]);
  const broken = bytes('[{"id": "a", ');
  const out = merge("annotations-x.json", base, good, broken);
  expect(out.copies).toHaveLength(1);
  expect(out.contested).toBe(true);
  expect([text(out.merged), text(out.copies[0].bytes)].sort()).toEqual(
    [text(good), text(broken)].sort(),
  );
});

test("records with no usable identity fall back to keeping both files", () => {
  const base = json([{ type: "highlight" }]);
  const local = json([{ type: "highlight", note: "a" }]);
  const remote = json([{ type: "highlight", note: "b" }]);
  const out = merge("annotations-x.json", base, local, remote);
  expect(out.copies).toHaveLength(1);
  expect(out.dropped).toEqual([]);
});

// --- fields -----------------------------------------------------------------

const settings = (over: Record<string, unknown>) => ({
  defaultProviderId: "anthropic",
  defaultModelId: "claude",
  chatThinking: "low",
  autoNotes: true,
  ...over,
});

test("two devices changing different settings both keep theirs", () => {
  const base = json(settings({}));
  const local = json(settings({ chatThinking: "high" }));
  const remote = json(settings({ autoNotes: false }));
  const out = merge("settings.json", base, local, remote);
  expect(text(out.merged)).toBe(
    JSON.stringify(settings({ chatThinking: "high", autoNotes: false }), null, 2),
  );
  expect(out.contested).toBe(false);
});

test("one setting changed on both sides is settled by content and journalled", () => {
  const base = json(settings({}));
  const local = json(settings({ defaultModelId: "opus" }));
  const remote = json(settings({ defaultModelId: "sonnet" }));
  const out = merge("settings.json", base, local, remote);
  expect(out.contested).toBe(true);
  expect(out.dropped).toHaveLength(1);
  expect(out.dropped[0].id).toBe("defaultModelId");
  const kept = (JSON.parse(text(out.merged)) as Record<string, string>).defaultModelId;
  expect([kept, out.dropped[0].record].sort()).toEqual(["opus", "sonnet"]);
});

test("a nested object merges key by key", () => {
  const base = json({ version: 1, plan: { status: "pending", source: "outline" } });
  const local = json({ version: 1, plan: { status: "done", source: "outline" } });
  const remote = json({ version: 1, plan: { status: "pending", source: "ai" } });
  expect(merged("notes-x/state.json", base, local, remote)).toBe(
    JSON.stringify({ version: 1, plan: { status: "done", source: "ai" } }, null, 2),
  );
});

test("an array field is one value, not a list to interleave", () => {
  const base = json({ version: 1, chapters: [{ index: 1, status: "pending" }] });
  const local = json({ version: 1, chapters: [{ index: 1, status: "done" }] });
  const remote = json({
    version: 1,
    chapters: [{ index: 1, status: "pending" }, { index: 2, status: "pending" }],
  });
  const out = merge("notes-x/state.json", base, local, remote);
  expect(out.contested).toBe(true);
  const chapters = (JSON.parse(text(out.merged)) as { chapters: unknown[] }).chapters;
  expect([chapters, out.dropped[0].record].map((c) => JSON.stringify(c)).sort()).toEqual(
    [
      JSON.stringify([{ index: 1, status: "done" }]),
      JSON.stringify([{ index: 1, status: "pending" }, { index: 2, status: "pending" }]),
    ].sort(),
  );
});

test("a field one side removed and the other left alone goes, and is journalled", () => {
  const base = json({ a: 1, b: 2 });
  const local = json({ a: 1 });
  const remote = json({ a: 1, b: 2 });
  const out = merge("settings.json", base, local, remote);
  expect(text(out.merged)).toBe(JSON.stringify({ a: 1 }, null, 2));
  expect(out.dropped).toEqual([{ id: "b", record: 2 }]);
});

test("a field one side removed and the other edited keeps the edit", () => {
  const base = json({ a: 1, b: 2 });
  const local = json({ a: 1 });
  const remote = json({ a: 1, b: 3 });
  expect(merged("settings.json", base, local, remote)).toBe(JSON.stringify({ a: 1, b: 3 }, null, 2));
  expect(merged("settings.json", base, remote, local)).toBe(JSON.stringify({ a: 1, b: 3 }, null, 2));
});

test("settings written before a key existed gain it rather than lose it", () => {
  const base = json({ a: 1 });
  const local = json({ a: 1, fingerDraw: true });
  const remote = json({ a: 2 });
  expect(merged("settings.json", base, local, remote)).toBe(
    JSON.stringify({ a: 2, fingerDraw: true }, null, 2),
  );
});

// --- prose ------------------------------------------------------------------

const note = (lines: string[]) => bytes(`${lines.join("\n")}\n`);

test("edits in different parts of a note both survive", () => {
  const base = note(["# Chapter", "", "First point.", "", "Second point."]);
  const local = note(["# Chapter", "", "First point, expanded.", "", "Second point."]);
  const remote = note(["# Chapter", "", "First point.", "", "Second point.", "", "Third point."]);
  const out = merge("notes-x/chapter-01.md", base, local, remote);
  expect(text(out.merged)).toBe(
    `${["# Chapter", "", "First point, expanded.", "", "Second point.", "", "Third point."].join("\n")}\n`,
  );
  expect(out.contested).toBe(false);
  expect(out.copies).toEqual([]);
});

test("a line both sides rewrote picks one and keeps the other file whole", () => {
  const base = note(["# Chapter", "", "A point."]);
  const local = note(["# Chapter", "", "A point, from the desk."]);
  const remote = note(["# Chapter", "", "A point, from the iPad."]);
  const out = merge("notes-x/chapter-01.md", base, local, remote);
  expect(out.contested).toBe(true);
  expect(out.copies).toHaveLength(1);
  expect(out.copies[0].path).toMatch(/^notes-x\/chapter-01\.conflict-[0-9a-f]{8}\.md$/);
  expect([text(out.merged), text(out.copies[0].bytes)].sort()).toEqual(
    [text(local), text(remote)].sort(),
  );
});

test("edits scattered through a note are matched line by line, not as one block", () => {
  const base = note(["a", "b", "c", "d", "e", "f", "g"]);
  const local = note(["a", "B", "c", "d", "e", "F", "g"]);
  const remote = note(["a", "b", "c", "D", "e", "f", "g"]);
  const out = merge("notes-x/chapter-01.md", base, local, remote);
  expect(text(out.merged)).toBe(`${["a", "B", "c", "D", "e", "F", "g"].join("\n")}\n`);
  expect(out.contested).toBe(false);
});

test("two devices appending to the same end of a note is a conflict, not a silent loss", () => {
  const base = note(["a", "b"]);
  const local = note(["a", "b", "from the desk"]);
  const remote = note(["a", "b", "from the iPad"]);
  const out = merge("info-profile.md", base, local, remote);
  expect(out.contested).toBe(true);
  expect([text(out.merged), text(out.copies[0].bytes)].sort()).toEqual(
    [text(local), text(remote)].sort(),
  );
});

test("a merged note never carries conflict markers", () => {
  const base = note(["one", "two", "three"]);
  const local = note(["one", "two from the desk", "three"]);
  const remote = note(["one", "two from the iPad", "three"]);
  const out = merge("info-profile.md", base, local, remote);
  expect(text(out.merged)).not.toContain("<<<<<<<");
  expect(text(out.merged)).not.toContain("=======");
  expect(text(out.merged)).not.toContain(">>>>>>>");
});

test("a note with no final newline keeps not having one", () => {
  const base = bytes("one\ntwo");
  const local = bytes("one\ntwo\nthree");
  const remote = bytes("zero\none\ntwo");
  expect(merged("notes-x/overview.md", base, local, remote)).toBe("zero\none\ntwo\nthree");
});

test("two notes with no base between them keep both files", () => {
  const local = note(["desk version"]);
  const remote = note(["iPad version"]);
  const out = merge("info-profile.md", null, local, remote);
  expect(out.contested).toBe(true);
  expect(out.copies).toHaveLength(1);
  expect([text(out.merged), text(out.copies[0].bytes)].sort()).toEqual(
    [text(local), text(remote)].sort(),
  );
});

// --- opaque -----------------------------------------------------------------

test("an unrecognised file keeps one copy whole and parks the other", () => {
  const local = bytes(" binary one");
  const remote = bytes(" binary two");
  const out = merge("library/x.pdf", bytes(" binary"), local, remote);
  expect(out.copies).toHaveLength(1);
  expect(out.copies[0].path).toMatch(/^library\/x\.conflict-[0-9a-f]{8}\.pdf$/);
  expect(out.dropped).toEqual([]);
  expect([text(out.merged), text(out.copies[0].bytes)].sort()).toEqual(
    [text(local), text(remote)].sort(),
  );
});

test("a conflict copy is named from its own content, so both devices name it alike", () => {
  expect(conflictCopyPath("a/b.md", bytes("x"))).toBe(conflictCopyPath("a/b.md", bytes("x")));
  expect(conflictCopyPath("a/b.md", bytes("x"))).not.toBe(conflictCopyPath("a/b.md", bytes("y")));
  expect(conflictCopyPath("noext", bytes("x"))).toMatch(/^noext\.conflict-[0-9a-f]{8}$/);
});

// --- the corpus the invariants run over -------------------------------------

interface Case {
  name: string;
  path: string;
  base: Uint8Array | null;
  local: Uint8Array;
  remote: Uint8Array;
  // Records are identified, so a case built from them can be checked for loss
  // record by record. Prose and opaque cases cannot.
  identified: boolean;
}

// Deterministic pseudo-randomness, so a failing case is reproducible from its
// seed rather than gone by the next run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Record_ = { id: string; note: string; color: string };

function recordCase(seed: number): Case {
  const rand = mulberry32(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const baseList: Record_[] = Array.from({ length: 6 }, (_, i) => ({
    id: `r${i}`,
    note: `note ${i}`,
    color: "#ffd400",
  }));
  const side = (salt: string): Record_[] => {
    const out: Record_[] = [];
    for (const r of baseList) {
      switch (pick(5)) {
        case 0:
          break; // deleted
        case 1:
          out.push({ ...r, note: `${r.note} (${salt})` });
          break;
        case 2:
          out.push({ ...r, color: salt === "L" ? "#ff6666" : "#5fb236" });
          break;
        default:
          out.push({ ...r });
      }
    }
    for (let i = 0; i < pick(3); i++) {
      out.push({ id: `n${pick(4)}`, note: `added by ${salt}`, color: "#2ea8e5" });
    }
    // The same id twice would not be a record file; keep the last.
    const byId = new Map(out.map((r) => [r.id, r]));
    return [...byId.values()];
  };
  const local = side("L");
  const remote = side("R");
  const withBase = pick(4) > 0;
  const arrayShaped = pick(2) === 0;
  const wrap = (list: Record_[]): Uint8Array =>
    arrayShaped
      ? json(list)
      : json({ threads: Object.fromEntries(list.map((r) => [r.id, r])) });
  return {
    name: `records seed ${seed}`,
    path: arrayShaped ? "annotations-x.json" : "threads-x.json",
    base: withBase ? wrap(baseList) : null,
    local: wrap(local),
    remote: wrap(remote),
    identified: true,
  };
}

function fieldCase(seed: number): Case {
  const rand = mulberry32(seed ^ 0x5eed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const baseValue = {
    version: 1,
    provider: "anthropic",
    thinking: "low",
    nested: { a: 1, b: 2, c: 3 },
    list: [1, 2, 3],
  };
  const side = (salt: number): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...baseValue, nested: { ...baseValue.nested } };
    if (pick(3) === 0) delete out.provider;
    else if (pick(2) === 0) out.provider = `provider-${salt}`;
    if (pick(3) === 0) out.thinking = `level-${salt}`;
    if (pick(3) === 0) (out.nested as Record<string, number>).a = salt;
    if (pick(3) === 0) delete (out.nested as Record<string, number>).b;
    if (pick(3) === 0) out.list = [1, 2, 3, salt];
    if (pick(3) === 0) out[`extra${salt}`] = true;
    if (pick(4) === 0) out.shared = salt;
    return out;
  };
  const local = side(1);
  const remote = side(2);
  return {
    name: `fields seed ${seed}`,
    path: pick(2) === 0 ? "settings.json" : "prep-x/state.json",
    base: pick(4) > 0 ? json(baseValue) : null,
    local: json(local),
    remote: json(remote),
    identified: false,
  };
}

function proseCase(seed: number): Case {
  const rand = mulberry32(seed ^ 0xbeef);
  const pick = (n: number): number => Math.floor(rand() * n);
  const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const side = (salt: string): string[] => {
    const out: string[] = [];
    for (const line of baseLines) {
      switch (pick(6)) {
        case 0:
          break; // deleted
        case 1:
          out.push(`${line} (${salt})`);
          break;
        case 2:
          out.push(`inserted by ${salt}`, line);
          break;
        default:
          out.push(line);
      }
    }
    if (pick(3) === 0) out.push(`tail from ${salt}`);
    return out;
  };
  const local = side("L");
  const remote = side("R");
  return {
    name: `prose seed ${seed}`,
    path: "notes-x/chapter-01.md",
    base: pick(4) > 0 ? note(baseLines) : null,
    local: note(local),
    remote: note(remote),
    identified: false,
  };
}

const CASES: Case[] = [
  ...Array.from({ length: 40 }, (_, i) => recordCase(i + 1)),
  ...Array.from({ length: 40 }, (_, i) => fieldCase(i + 1)),
  ...Array.from({ length: 40 }, (_, i) => proseCase(i + 1)),
  {
    name: "an opaque pair",
    path: "library/x.pdf",
    base: bytes("base"),
    local: bytes("local"),
    remote: bytes("remote"),
    identified: false,
  },
  {
    name: "a feedback log both sides appended to",
    path: "info-feedback.jsonl",
    base: bytes('{"ts":1}\n'),
    local: bytes('{"ts":1}\n{"ts":2}\n'),
    remote: bytes('{"ts":1}\n{"ts":3}\n'),
    identified: false,
  },
  {
    name: "a library one side imported into and the other renamed in",
    path: "library.json",
    base: json({ books: { h1: { hash: "h1", title: "One", addedAt: 1 } } }),
    local: json({
      books: { h1: { hash: "h1", title: "One", addedAt: 1 }, h2: { hash: "h2", title: "Two", addedAt: 2 } },
    }),
    remote: json({ books: { h1: { hash: "h1", title: "Renamed", addedAt: 1 } } }),
    identified: false,
  },
  {
    name: "a topic list both sides edited",
    path: "topics.json",
    base: json({ topics: [{ id: "t1", name: "One", createdAt: 1, files: [] }] }),
    local: json({
      topics: [
        { id: "t1", name: "One", createdAt: 1, files: [{ path: "/a.pdf", name: "a.pdf", addedAt: 2 }] },
      ],
    }),
    remote: json({
      topics: [
        { id: "t1", name: "One", createdAt: 1, files: [] },
        { id: "t2", name: "Two", createdAt: 3, files: [] },
      ],
    }),
    identified: false,
  },
  {
    name: "a reading position each device moved",
    path: "reading-state.json",
    base: json({ states: { b1: { pageIndex: 1, scale: "auto", scrollMode: 0 } } }),
    local: json({ states: { b1: { pageIndex: 12, scale: "auto", scrollMode: 0 } } }),
    remote: json({ states: { b1: { pageIndex: 40, scale: "auto", scrollMode: 0 } } }),
    identified: false,
  },
  {
    name: "a source list one side disabled a source in",
    path: "info-sources.json",
    base: json([{ id: "a", kind: "rss", url: "https://a", enabled: true }]),
    local: json([{ id: "a", kind: "rss", url: "https://a", enabled: false }]),
    remote: json([
      { id: "a", kind: "rss", url: "https://a", enabled: true },
      { id: "b", kind: "rss", url: "https://b", enabled: true },
    ]),
    identified: false,
  },
  {
    name: "a records file that lost its shape",
    path: "annotations-x.json",
    base: json([{ id: "a", note: "one" }]),
    local: bytes('[{"id": "a", "note": '),
    remote: json([{ id: "a", note: "two" }]),
    identified: false,
  },
  {
    name: "a records file with no base at all",
    path: "threads-x.json",
    base: null,
    local: json({ threads: { t1: { id: "t1", messages: [1] } } }),
    remote: json({ threads: { t1: { id: "t1", messages: [2] }, t2: { id: "t2", messages: [] } } }),
    identified: false,
  },
];

function shape(out: MergeOutput): string {
  return JSON.stringify({
    merged: text(out.merged),
    copies: out.copies.map((c) => [c.path, text(c.bytes)]).sort(),
    dropped: out.dropped.map((d) => JSON.stringify(d)).sort(),
    contested: out.contested,
  });
}

// --- the invariants ---------------------------------------------------------

test("swapping the two sides changes nothing about the result", () => {
  for (const c of CASES) {
    const forward = merge(c.path, c.base, c.local, c.remote);
    const backward = merge(c.path, c.base, c.remote, c.local);
    expect({ case: c.name, out: shape(forward) }).toEqual({ case: c.name, out: shape(backward) });
  }
});

test("merging an already merged pair changes nothing", () => {
  for (const c of CASES) {
    const once = merge(c.path, c.base, c.local, c.remote).merged;
    expect({ case: c.name, out: text(merge(c.path, c.base, once, once).merged) }).toEqual({
      case: c.name,
      out: text(once),
    });
    expect({ case: c.name, out: text(merge(c.path, once, once, once).merged) }).toEqual({
      case: c.name,
      out: text(once),
    });
  }
});

test("the device that merged second lands on what the first one wrote", () => {
  // The other side finished its own pass and uploaded; merging that against the
  // copy this device still holds has to be a no-op, or the two keep trading
  // files forever.
  for (const c of CASES) {
    if (c.path.endsWith(".md") || c.path.endsWith(".pdf")) continue;
    const once = merge(c.path, c.base, c.local, c.remote).merged;
    expect({ case: c.name, out: text(merge(c.path, c.base, once, c.local).merged) }).toEqual({
      case: c.name,
      out: text(once),
    });
    expect({ case: c.name, out: text(merge(c.path, c.base, once, c.remote).merged) }).toEqual({
      case: c.name,
      out: text(once),
    });
  }
});

test("a file only one side changed comes back byte for byte", () => {
  for (const c of CASES) {
    if (c.base === null) continue;
    expect({ case: c.name, out: text(merge(c.path, c.base, c.base, c.local).merged) }).toEqual({
      case: c.name,
      out: text(c.local),
    });
    expect({ case: c.name, out: text(merge(c.path, c.base, c.local, c.base).merged) }).toEqual({
      case: c.name,
      out: text(c.local),
    });
  }
});

test("the merged bytes are what the app itself would have written", () => {
  for (const c of CASES) {
    if (!c.path.endsWith(".json")) continue;
    const out = text(merge(c.path, c.base, c.local, c.remote).merged);
    if (out === text(c.local) || out === text(c.remote)) continue;
    expect({ case: c.name, out }).toEqual({
      case: c.name,
      out: JSON.stringify(JSON.parse(out), null, 2),
    });
  }
});

test("nothing leaves the merged file without being journalled or copied", () => {
  for (const c of CASES) {
    if (!c.identified) continue;
    const out = merge(c.path, c.base, c.local, c.remote);
    const kept = new Set(idsOf(out.merged));
    const journalled = new Set(out.dropped.map((d) => d.id));
    for (const id of [...idsOf(c.local), ...idsOf(c.remote)]) {
      if (kept.has(id) || journalled.has(id)) continue;
      throw new Error(`${c.name}: record ${id} vanished`);
    }
    // A version one device actually wrote is either the one in the file or the
    // one in the journal. A version it merely inherited from the base is not:
    // the other device's edit is meant to replace it.
    const baseRecords = c.base === null ? new Map<string, unknown>() : recordsOf(c.base);
    const mergedRecords = recordsOf(out.merged);
    const lost = out.dropped.map((d) => JSON.stringify(d.record)).sort();
    for (const [id, record] of [...recordsOf(c.local), ...recordsOf(c.remote)]) {
      const written = JSON.stringify(record);
      if (written === JSON.stringify(baseRecords.get(id))) continue;
      if (written === JSON.stringify(mergedRecords.get(id))) continue;
      expect({ case: c.name, id, has: lost.includes(written) }).toEqual({
        case: c.name,
        id,
        has: true,
      });
    }
  }
});

test("no setting a device actually changed leaves without being journalled", () => {
  for (const c of CASES) {
    if (strategyFor(c.path) !== "fields") continue;
    const out = merge(c.path, c.base, c.local, c.remote);
    const baseFields = c.base === null ? new Map<string, string>() : fieldsOf(c.base);
    const mergedFields = fieldsOf(out.merged);
    const lost = out.dropped.map((d) => `${d.id}=${JSON.stringify(d.record)}`);
    for (const side of [c.local, c.remote]) {
      for (const [key, written] of fieldsOf(side)) {
        if (written === baseFields.get(key)) continue;
        if (written === mergedFields.get(key)) continue;
        expect({ case: c.name, key, has: lost.includes(`${key}=${written}`) }).toEqual({
          case: c.name,
          key,
          has: true,
        });
      }
    }
  }
});

test("prose never loses a side without leaving its whole file behind", () => {
  for (const c of CASES) {
    if (!c.path.endsWith(".md")) continue;
    const out = merge(c.path, c.base, c.local, c.remote);
    const mergedText = text(out.merged);
    expect(mergedText).not.toContain("<<<<<<<");
    expect(mergedText).not.toContain(">>>>>>>");
    const readable = [mergedText, ...out.copies.map((copy) => text(copy.bytes))];
    const baseLines = new Set(c.base === null ? [] : text(c.base).split("\n"));
    const mergedLines = new Set(mergedText.split("\n"));
    for (const side of [c.local, c.remote]) {
      // Either everything this side wrote is in the merged file, or the whole
      // side is sitting beside it to be read.
      const written = text(side)
        .split("\n")
        .filter((line) => line !== "" && !baseLines.has(line));
      const carried = written.every((line) => mergedLines.has(line));
      expect({ case: c.name, kept: carried || readable.includes(text(side)) }).toEqual({
        case: c.name,
        kept: true,
      });
    }
  }
});

// Every leaf of a fields file, by the dotted key path the merge journals it
// under. An array is a leaf; nested objects are walked into.
function fieldsOf(b: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (value: unknown, prefix: string): void => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      out.set(prefix, JSON.stringify(value));
      return;
    }
    for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key);
  };
  walk(JSON.parse(text(b)), "");
  return out;
}

// Ids of a records file, whatever shape it takes on disk.
function idsOf(b: Uint8Array): string[] {
  return [...recordsOf(b).keys()];
}

function recordsOf(b: Uint8Array): Map<string, unknown> {
  const value = JSON.parse(text(b)) as unknown;
  const out = new Map<string, unknown>();
  if (Array.isArray(value)) {
    for (const r of value as { id: string }[]) out.set(r.id, r);
    return out;
  }
  const wrapped = (value as { threads?: Record<string, unknown> }).threads ?? {};
  for (const [id, r] of Object.entries(wrapped)) out.set(id, r);
  return out;
}
