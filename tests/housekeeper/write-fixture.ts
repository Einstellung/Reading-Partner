// A writable kind of the tests' own (docs/platform/687): one JSON file with an
// input list, a computed total, two locked fields, one domain rule and one
// change that waits for the reader.

import type { PalaceRow } from "../../src/palace";
import {
  textBase,
  type Gate,
  type WritableEntry,
  type WriteDeps,
  type WriteIo,
} from "../../src/housekeeper/write";

export const NOTES_KIND = "test-notes";
export const NOTES_PATH = "test-notes.json";

export interface Notes {
  id: string;
  updatedAt: number;
  title: string;
  items: { text: string; count: number }[];
  total: number;
}

export const NOTES_ROW: PalaceRow = {
  kind: NOTES_KIND,
  domain: "platform",
  match: (path) => (path === NOTES_PATH ? { id: null } : null),
  samples: [NOTES_PATH],
  id: "fixed",
  refs: [],
  sync: "data",
  merge: "opaque",
  deleteWith: "never",
  retention: { rule: "never" },
  ai: { write: true },
  about: "The test's notes.",
};

export function memIo(): WriteIo & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readText(path) {
      return files.get(path) ?? null;
    },
    async writeText(path, text) {
      files.set(path, text);
    },
    async remove(path) {
      files.delete(path);
    },
    async list(dir) {
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length));
    },
  };
}

export function seedNotes(io: WriteIo & { files: Map<string, string> }): Notes {
  const notes: Notes = {
    id: "n1",
    updatedAt: 1,
    title: "Groceries",
    items: [
      { text: "eggs", count: 2 },
      { text: "milk", count: 1 },
    ],
    total: 3,
  };
  io.files.set(NOTES_PATH, JSON.stringify(notes));
  return notes;
}

export function readNotes(io: { files: Map<string, string> }): Notes {
  return JSON.parse(io.files.get(NOTES_PATH)!) as Notes;
}

export function notesEntry(io: WriteIo, log: { landed: number } = { landed: 0 }): WritableEntry<Notes> {
  return {
    kind: NOTES_KIND,
    async open() {
      const text = await io.readText(NOTES_PATH);
      if (text === null) return null;
      return { value: JSON.parse(text) as Notes, base: await textBase(text) };
    },
    shape:
      "interface Notes { id: string /* locked */; updatedAt: number /* locked */; title: string /* input */; " +
      "items: { text: string; count: number }[] /* input */; total: number /* computed from items[].count */ }",
    parse(value) {
      const v = value as Notes;
      if (typeof v !== "object" || v === null || !Array.isArray(v.items) || typeof v.title !== "string") {
        return { ok: false, reason: "not a notes file: needs a title and an items list" };
      }
      return { ok: true, value: v };
    },
    computed: [{ path: "total", input: "items.*.count" }],
    locked: ["id", "updatedAt"],
    check(_before, after) {
      return after.items.flatMap((item, i) =>
        item.count > 100 ? [{ path: `items.${i}.count`, message: "at most 100" }] : [],
      );
    },
    gate(before, after): Gate | null {
      return before.title !== after.title ? "replace" : null;
    },
    async land(_before, after, ctx) {
      log.landed++;
      const total = after.items.reduce((sum, item) => sum + item.count, 0);
      await io.writeText(NOTES_PATH, JSON.stringify({ ...after, total, updatedAt: ctx.now }));
      return { ok: true, notes: [`Total is now ${total}.`] };
    },
    describe(before, after) {
      const lines: string[] = [];
      if (before.title !== after.title) lines.push(`Title: ${after.title}`);
      after.items.forEach((item, i) => {
        if (before.items[i]?.count !== item.count) lines.push(`${item.text}: ${item.count}`);
      });
      return lines;
    },
  };
}

export function notesDeps(io: WriteIo, entry: WritableEntry<Notes>, clock: { now: number }): WriteDeps {
  return {
    io,
    rows: [NOTES_ROW],
    now: () => clock.now,
    device: () => "dev-test",
    entryOf: (kind) => (kind === NOTES_KIND ? (entry as WritableEntry<unknown>) : null),
  };
}
