// The statement store (src/memory/statements/store.ts) over an in-memory file
// and a stubbed observation resolver. Run: bun test.

import { expect, test } from "bun:test";
import { localDate } from "../../src/memory/observations/files";
import { createStatementStore, STATEMENTS_FILE } from "../../src/memory/statements/store";
import type { DaySpan } from "../../src/memory/statements/dates";

const JULY_17 = new Date("2026-07-17T12:00:00Z").getTime();

// Two observations with spans of their own, and nothing else exists.
const OBSERVED: Record<string, DaySpan> = {
  "m-1111111111111111": { first: "2026-07-02", last: "2026-07-05" },
  "m-2222222222222222": { first: "2026-08-01", last: "2026-08-01" },
};

function makeStore() {
  const files = new Map<string, string>();
  let minted = 0;
  const store = createStatementStore({
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async observationDates(id) {
      return OBSERVED[id] ?? null;
    },
    newId: () => `s-${String(++minted).padStart(16, "0")}`,
  });
  return { store, files };
}

test("a statement is dated by the span of the observations behind it", async () => {
  const { store, files } = makeStore();
  const s = await store.createStatement({
    kind: "profile",
    text: "Reads past the maths and comes back to it",
    author: "dream",
    evidence: ["m-1111111111111111", "m-2222222222222222"],
  });

  expect(s.id).toMatch(/^s-[0-9a-f]{16}$/);
  expect(s.established).toBe("2026-07-02");
  expect(s.lastSupported).toBe("2026-08-01");
  expect(s.contradictedBy).toEqual([]);
  expect(s.supersededBy).toBeUndefined();

  // The shape the records merge strategy reads: a wrapper key over records
  // carrying `id` (platform/sync/merge/records.ts).
  expect(JSON.parse(files.get(STATEMENTS_FILE) as string)).toEqual({ statements: [s] });
  expect(await store.getStatement(s.id)).toEqual(s);
  expect(await store.getStatement("s-nope")).toBeNull();
});

test("a message anchor dates a statement to the day that turn happened", async () => {
  const { store } = makeStore();
  const s = await store.createStatement({
    kind: "concern",
    text: "Has not come back to the retell",
    author: "reader",
    evidence: [`t-0123456789abcdef@thread-1:${JULY_17}`],
    expectedIntervalDays: 14,
  });
  expect(s.established).toBe(localDate(JULY_17));
  expect(s.lastSupported).toBe(localDate(JULY_17));
  expect(s.expectedIntervalDays).toBe(14);
});

// The whole point of computing the dates rather than asking for them: evidence
// nothing can date must not be quietly stamped with today.
test("evidence that cannot be dated is refused, and nothing is written", async () => {
  const { store, files } = makeStore();
  const create = (evidence: string[]) =>
    store.createStatement({ kind: "profile", text: "x", author: "dream", evidence });

  await expect(create(["m-9999999999999999"])).rejects.toThrow(/names no observation/);
  // The id-only anchor form: a real turn, no day.
  await expect(create(["t-0123456789abcdef"])).rejects.toThrow(/carries no date/);
  await expect(create(["not an anchor"])).rejects.toThrow(/carries no date/);
  await expect(create([])).rejects.toThrow(/needs evidence/);
  expect(files.has(STATEMENTS_FILE)).toBe(false);
});

test("evidence appends and de-duplicates, moves lastSupported, and never rewrites the text", async () => {
  const { store } = makeStore();
  const s = await store.createStatement({
    kind: "profile",
    text: "Reads past the maths",
    author: "dream",
    evidence: ["m-1111111111111111"],
  });
  expect(s.lastSupported).toBe("2026-07-05");

  const grown = await store.addEvidence(s.id, [
    "m-2222222222222222",
    // Already there: not appended, and not re-dated either.
    "m-1111111111111111",
  ]);
  expect(grown?.evidence).toEqual(["m-1111111111111111", "m-2222222222222222"]);
  expect(grown?.text).toBe("Reads past the maths");
  expect(grown?.lastSupported).toBe("2026-08-01");
  // First held on 2026-07-02 and still so: established does not move.
  expect(grown?.established).toBe("2026-07-02");

  expect(await store.addEvidence("s-nope", ["m-1111111111111111"])).toBeNull();
});

// Evidence arrives oldest-first as often as newest-first (a dream pass works
// through a backlog), and a statement must not look staler for having been
// given more to stand on.
test("older evidence appended later does not drag lastSupported backwards", async () => {
  const { store } = makeStore();
  const s = await store.createStatement({
    kind: "profile",
    text: "x",
    author: "dream",
    evidence: ["m-2222222222222222"],
  });
  const grown = await store.addEvidence(s.id, ["m-1111111111111111"]);
  expect(grown?.established).toBe("2026-08-01");
  expect(grown?.lastSupported).toBe("2026-08-01");
});

test("a contradiction is an observation id, appended and de-duplicated", async () => {
  const { store } = makeStore();
  const s = await store.createStatement({
    kind: "profile",
    text: "x",
    author: "dream",
    evidence: ["m-1111111111111111"],
  });

  await store.addContradiction(s.id, "m-2222222222222222");
  const after = await store.addContradiction(s.id, "m-2222222222222222");
  expect(after?.contradictedBy).toEqual(["m-2222222222222222"]);
  // It moves no date, so it is never resolved — but it must still name
  // something a reader of the list can look up.
  expect(() => store.addContradiction(s.id, "thread-1:1750000000000")).toThrow(
    /names an observation/,
  );
  expect(await store.addContradiction("s-nope", "m-2222222222222222")).toBeNull();
});

test("superseding points the old statement at the new one and changes nothing else", async () => {
  const { store } = makeStore();
  const old = await store.createStatement({
    kind: "profile",
    text: "Avoids the maths",
    author: "dream",
    evidence: ["m-1111111111111111"],
  });
  const next = await store.supersede(old.id, {
    kind: "profile",
    text: "Reads past the maths and comes back to it",
    author: "dream",
    evidence: ["m-2222222222222222"],
  });

  const all = await store.listStatements();
  expect(all.map((s) => s.id)).toEqual([old.id, next?.id]);
  expect(all[0]).toEqual({ ...old, supersededBy: next?.id });
  expect(next?.established).toBe("2026-08-01");

  // Nothing to supersede means nothing is created.
  expect(await store.supersede("s-nope", { kind: "profile", text: "x", author: "dream", evidence: ["m-1111111111111111"] })).toBeNull();
  expect((await store.listStatements()).length).toBe(2);
});

// Every statement lives in this one file, so carrying on from an empty list
// would write the file back with all of them gone.
test("a file that does not parse throws instead of emptying itself", async () => {
  const { store, files } = makeStore();
  files.set(STATEMENTS_FILE, "{ not json");
  await expect(store.listStatements()).rejects.toThrow();
  files.set(STATEMENTS_FILE, JSON.stringify({ statements: "no" }));
  await expect(store.listStatements()).rejects.toThrow(/not an array/);
  // A file written before the collection had anything in it is not corruption.
  files.set(STATEMENTS_FILE, JSON.stringify({}));
  expect(await store.listStatements()).toEqual([]);
});
