// Answering the bell (src/soul/bell.ts, docs/55): a bell becomes one turn at
// the place the run was asked from, on that place's runtime, or at the door
// when there is no such place; only after it has landed is the bell acked. A
// turn that fails acks nothing. The places here are scripted: what they were
// handed is what this file reads, and the turns themselves are
// reading/turn/*-bell.ts's.
// Run: scripts/t.sh tests/soul/bell.test.ts

import { beforeEach, expect, test } from "bun:test";
import { answerBell, renderBell, OUTPUT_MAX } from "../../src/soul";
import { createBellStore, BRIEF_MAX, type Bell, type BellStore } from "../../src/legion/bell";
import { createRunStore } from "../../src/legion/run/store";
import { doorDate } from "../../src/soul";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import { registerTurnDelivery, type TurnDelivery, type TurnDeliveryOutcome } from "../../src/soul";
import { createBoxStore, type BoxOrigin, type BoxStore } from "../../src/box";
import { installAppData } from "../support/appdata-fake";
import { mapDisk } from "../support/map-disk";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

// Deliverers a test here registered with `place`, undone before the next one.
const registered: (() => void)[] = [];

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
  registered.splice(0).forEach((off) => off());
  // Deliverers another test file left registered (the shell's bootstrap) are
  // set aside: each test here registers the places it answers in.
  for (const name of ["door", "book", "briefing", "meals"] as const) registerTurnDelivery(name, async () => null)();
});

function bellStore(): { bells: BellStore; files: Map<string, string> } {
  const io = mapDisk();
  return { bells: createBellStore(io), files: io.files };
}

// One scripted outcome per bell a place is handed: an answer (seen or not as
// it landed), a failure, or null for "nothing to answer in here any more".
type Scripted = { text: string; watching?: boolean } | { error: string } | null;

// A place answering on its own runtime, scripted. Answers what it is handed.
function place(name: BoxOrigin["place"], script: Scripted[]): TurnDelivery[] {
  const taken: TurnDelivery[] = [];
  let i = 0;
  registered.push(
    registerTurnDelivery(name, async (input): Promise<TurnDeliveryOutcome | null> => {
      taken.push(input);
      const next = i < script.length ? script[i++]! : { error: "no scripted turn" };
      if (next === null) return null;
      return "error" in next
        ? { status: "failed", reason: next.error }
        : { status: "answered", reply: next.text, watching: next.watching ?? false };
    }),
  );
  return taken;
}

const NOW = new Date(2026, 8, 14, 9, 0, 0).getTime();
const TODAY = { place: "door" as const, date: doorDate(new Date(NOW)) };

const doneBell = (payload: Record<string, unknown>): Bell =>
  ({
    id: "run-done-r1",
    type: "run-done",
    at: NOW,
    state: "queued",
    payload: { runId: "r1", kind: "translate-book", ...payload },
  }) as Bell;

test("the bell says who is speaking, and says it before the payload", () => {
  const text = renderBell(
    doneBell({ brief: "legion/briefs/b1.md", output: "legion/outputs/r1.md" }),
    {
      brief: "Translate chapter 3.",
      briefCut: false,
      output: "Chapter 3, in English.",
      outputCut: false,
      outputMissing: false,
    },
  );
  expect(text.split("\n")[0]).toContain("not said by the reader");
  expect(text).toContain("translate-book");
  // What was asked and what came back, both as text: the turn has no tool that
  // opens a path, so no path is put in front of it.
  expect(text).toContain("Translate chapter 3.");
  expect(text).toContain("Chapter 3, in English.");
  expect(text).not.toContain("legion/");
});

test("a bell says what was cut and what is not here, rather than where it is", () => {
  const cut = renderBell(doneBell({ brief: "legion/briefs/b1.md", output: "legion/outputs/r1.md" }), {
    brief: "Translate chapter 3.",
    briefCut: true,
    output: "Chapter 3, in English.",
    outputCut: true,
    outputMissing: false,
  });
  expect(cut).toContain("The task above was cut to fit.");
  expect(cut).toContain("cut to fit here");

  const gone = renderBell(doneBell({ brief: "legion/briefs/b1.md", output: "legion/outputs/r1.md" }), {
    brief: null,
    briefCut: false,
    output: null,
    outputCut: false,
    outputMissing: true,
  });
  expect(gone).toContain("The output is not on this device.");
  expect(gone).toContain("The task it was given is not on this device.");
  expect(gone).not.toContain("legion/");
});

test("nothing in the inbox costs one listing and no turn", async () => {
  const { bells } = bellStore();
  const door = place("door", []);
  expect(await answerBell({ settings, bells, now: () => NOW })).toBe(0);
  expect(door).toEqual([]);
});

test("a run-done bell is one turn at the door, and the bell is acked after it", async () => {
  const { bells } = bellStore();
  await bells.ring(
    "run-done",
    { runId: "r1", kind: "translate-book", brief: "the book is translated", output: "runs/r1/out" },
    { at: NOW - 1000 },
  );
  const door = place("door", [{ text: "Your translation is ready." }]);

  expect(await answerBell({ settings, bells, now: () => NOW })).toBe(1);

  // One turn, in today's conversation at the door, and the bell is what it was
  // handed: a message to the soul, not a message from the reader.
  expect(door.length).toBe(1);
  expect(door[0]!.origin).toEqual(TODAY);
  expect(door[0]!.bell).toContain("not said by the reader");
  expect(door[0]!.bell).toContain("the book is translated");
  expect(door[0]!.runId).toBe("r1");

  expect((await bells.get("run-done-r1"))?.state).toBe("acked");
  expect(await bells.read()).toEqual([]);
});

test("a turn that fails leaves the bell queued", async () => {
  const { bells } = bellStore();
  await bells.ring("run-failed", { runId: "r2", kind: "collect", reason: "the source is gone" }, { at: NOW });
  place("door", [{ error: "overloaded" }]);
  const trouble: string[] = [];

  const answered = await answerBell({
    settings,
    bells,
    now: () => NOW,
    onTrouble: (bell, reason) => trouble.push(`${bell.id}:${reason}`),
  });

  expect(answered).toBe(0);
  expect(trouble).toEqual(["run-failed-r2:overloaded"]);
  expect((await bells.get("run-failed-r2"))?.state).toBe("queued");
  expect((await bells.read()).map((b) => b.id)).toEqual(["run-failed-r2"]);
});

test("with no door registered a bell with nowhere else to go stays queued", async () => {
  const { bells } = bellStore();
  await bells.ring("run-done", { runId: "r1", kind: "translate-book", brief: "done" }, { at: NOW });
  const trouble: string[] = [];
  expect(await answerBell({ settings, bells, now: () => NOW, onTrouble: (b) => trouble.push(b.id) })).toBe(0);
  expect(trouble).toEqual(["run-done-r1"]);
  expect((await bells.read()).map((b) => b.id)).toEqual(["run-done-r1"]);
});

test("the ack stamps the run as delivered, which is what the fold waits on", async () => {
  const { bells } = bellStore();
  const runs = createRunStore(mapDisk());
  const { run } = await runs.create({
    kind: "translate-book",
    delegator: { kind: "soul" },
    brief: "briefs/translate-book.json",
    at: NOW - 10_000,
  });
  await bells.ring("run-done", { runId: run.id, kind: run.kind, brief: "done" }, { at: NOW - 1000 });
  place("door", [{ text: "Your translation is ready." }, { text: "Still ready." }]);

  expect(await answerBell({ settings, bells, runs, now: () => NOW })).toBe(1);
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);

  // Stamped once: the field only ever moves earlier in a merge, so a second
  // bell about the same run says nothing new.
  await bells.ring(
    "run-done",
    { runId: run.id, kind: run.kind, brief: "again" },
    { at: NOW, id: "run-done-again" },
  );
  await answerBell({ settings, bells, runs, now: () => NOW + 5_000 });
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);
});

// --- answering where the question was asked (docs/68) -----------------------

const BOOK = "book-hash";

function boxStore(): { box: BoxStore; files: Map<string, string> } {
  const io = mapDisk();
  return { box: createBoxStore(io), files: io.files };
}

// What a run left on disk, as the soul reads it back: the brief the soul wrote
// when it delegated and the output the worker wrote. A path nothing was written
// to throws, the way the disk throws.
function leftOnDisk(files: Record<string, string>): (path: string) => Promise<string> {
  return async (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  };
}

const BRIEF_TEXT = "Find what has been written about the 1971 result.";
const OUTPUT_TEXT = "Four papers, oldest first. Kuhn 1971 settles it.";

const RUN_FILES = leftOnDisk({
  "legion/briefs/b-1.md": BRIEF_TEXT,
  "legion/outputs/r-1.md": OUTPUT_TEXT,
});

const bookOrigin = JSON.stringify({
  place: "book",
  bookId: BOOK,
  threadId: "thread-1",
  annotationId: "ann-1",
  page: 37,
});

const literature = {
  runId: "r-1",
  kind: "research-literature",
  brief: "legion/briefs/b-1.md",
  output: "legion/outputs/r-1.md",
  deliverTo: bookOrigin,
};

test("a run delegated from a book is answered by the book's turn, handed what the run produced", async () => {
  const { bells } = bellStore();
  const { box, files } = boxStore();
  await bells.ring("run-done", literature, { at: NOW - 1000 });
  const book = place("book", [{ text: "Four papers came back. The first settles it." }]);
  const door = place("door", []);

  expect(await answerBell({ settings, bells, box, readFile: RUN_FILES, now: () => NOW })).toBe(1);

  expect(door).toEqual([]);
  expect(book.length).toBe(1);
  expect(book[0]!.origin).toEqual(JSON.parse(bookOrigin));
  expect(book[0]!.bellId).toBe("run-done-r-1");
  // The turn was handed what the run was asked and what it produced, not the
  // two paths — it has no tool that would open either.
  const asked = book[0]!.bell;
  expect(asked).toContain("not said by the reader");
  expect(asked).toContain(BRIEF_TEXT);
  expect(asked).toContain(OUTPUT_TEXT);
  expect(asked).not.toContain("legion/");

  // Nobody was looking: one card, pointing back at what was just written.
  const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
  expect(item.boxId).toBe("r-1");
  expect(item.runId).toBe("r-1");
  expect(item.source).toBe("run");
  expect(item.state).toBe("in-box");
  expect(item.needsDecision).toBe(false);
  // The item travels between devices and the output file does not, so the
  // card holds the text of it.
  expect(item.body).toBe(OUTPUT_TEXT);
  expect(item.cover).toBe("Four papers came back.");
  expect(item.origin).toEqual(JSON.parse(bookOrigin));
  expect((await bells.get("run-done-r-1"))?.state).toBe("acked");
});

test("a brief and an output too long for a turn are cut, and the turn is told they were", async () => {
  const { bells } = bellStore();
  await bells.ring("run-done", literature, { at: NOW - 1000 });
  const book = place("book", [{ text: "Back." }]);
  await answerBell({
    settings,
    bells,
    box: boxStore().box,
    readFile: leftOnDisk({
      "legion/briefs/b-1.md": "b".repeat(BRIEF_MAX + 500),
      "legion/outputs/r-1.md": "o".repeat(OUTPUT_MAX + 500),
    }),
    now: () => NOW,
  });

  const asked = book[0]!.bell;
  expect(asked).toContain("b".repeat(BRIEF_MAX));
  expect(asked).not.toContain("b".repeat(BRIEF_MAX + 1));
  expect(asked).toContain("The task above was cut to fit.");
  expect(asked).toContain("o".repeat(OUTPUT_MAX));
  expect(asked).not.toContain("o".repeat(OUTPUT_MAX + 1));
  expect(asked).toContain("cut to fit here");
});

test("a run whose files are not on this device says so rather than naming them", async () => {
  const { bells } = bellStore();
  const { box, files } = boxStore();
  await bells.ring("run-done", literature, { at: NOW - 1000 });
  const book = place("book", [{ text: "Nothing came through." }]);
  await answerBell({ settings, bells, box, readFile: leftOnDisk({}), now: () => NOW });

  const asked = book[0]!.bell;
  expect(asked).toContain("The task it was given is not on this device.");
  expect(asked).toContain("The output is not on this device.");
  expect(asked).not.toContain("legion/");
  // Nothing to put on the card either, so it carries the cover alone.
  const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
  expect(item.body).toBeUndefined();
});

test("the card is written before the bell is acked", async () => {
  const { bells } = bellStore();
  const { box } = boxStore();
  let queuedWhenWritten = -1;
  const watched: BoxStore = {
    ...box,
    put: async (input) => {
      queuedWhenWritten = (await bells.read()).length;
      return box.put(input);
    },
  };
  await bells.ring(
    "run-done",
    { runId: "r-1", kind: "research-literature", brief: "in", deliverTo: bookOrigin },
    { at: NOW - 1000 },
  );
  place("book", [{ text: "Back." }]);
  await answerBell({ settings, bells, box: watched, now: () => NOW });
  // Still queued: the item is on disk before anything says the bell was answered.
  expect(queuedWhenWritten).toBe(1);
  expect(await bells.read()).toEqual([]);
});

test("a failed run is a card the reader has to decide about", async () => {
  const { bells } = bellStore();
  const { box, files } = boxStore();
  await bells.ring(
    "run-failed",
    { runId: "r-2", kind: "research-literature", reason: "every attempt failed", deliverTo: bookOrigin },
    { at: NOW - 1000 },
  );
  place("book", [{ text: "The search could not finish." }]);
  await answerBell({ settings, bells, box, now: () => NOW });

  const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
  expect(item.needsDecision).toBe(true);
  expect(item.body).toBeUndefined();
});

test("a run that named no place is answered at the door, and the card says so", async () => {
  const { bells } = bellStore();
  const { box, files } = boxStore();
  await bells.ring(
    "run-done",
    { runId: "r-3", kind: "translate-book", brief: "done", deliverTo: "not json at all" },
    { at: NOW - 1000 },
  );
  const book = place("book", []);
  const door = place("door", [{ text: "Your translation is ready." }]);
  await answerBell({ settings, bells, box, now: () => NOW });

  expect(book).toEqual([]);
  expect(door.length).toBe(1);
  const item = JSON.parse([...files.values()][0]!) as { origin: { place: string } };
  expect(item.origin.place).toBe("door");
});

test("a book that is gone sends the bell to the door, and the card still names the book", async () => {
  const { bells } = bellStore();
  const { box } = boxStore();
  await bells.ring(
    "run-done",
    { runId: "r-1", kind: "research-literature", brief: "in", deliverTo: bookOrigin },
    { at: NOW - 1000 },
  );
  const book = place("book", [null]);
  const door = place("door", [{ text: "Back." }]);
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(1);
  expect(book.length).toBe(1);
  expect(door.map((d) => d.origin)).toEqual([TODAY]);
  expect((await box.list()).map((c) => c.origin)).toEqual([JSON.parse(bookOrigin)]);
});

// The rule a plain reading turn follows, followed by a delivered run too
// (docs/68): the card is for an answer nobody saw land. A failure is no
// exception: what the reader has to decide about, they are already reading.
test("a reply or a failure the reader is watching land leaves no card, and is acked all the same", async () => {
  const { bells } = bellStore();
  const { box, files } = boxStore();
  await bells.ring(
    "run-done",
    { runId: "r-1", kind: "research-literature", brief: "in", deliverTo: bookOrigin },
    { at: NOW - 2000 },
  );
  await bells.ring(
    "run-failed",
    { runId: "r-2", kind: "collect", reason: "every attempt failed", deliverTo: bookOrigin },
    { at: NOW - 1000 },
  );
  place("book", [
    { text: "Four papers came back.", watching: true },
    { text: "The search could not finish.", watching: true },
  ]);
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(2);
  expect([...files.keys()]).toEqual([]);
  expect(await bells.read()).toEqual([]);
});

// --- runs a program delegated (docs/55 step 12) -----------------------------

// The run store a bell is read back against, kept here so each of these tests
// can put a run of its own on disk.
function runFiles() {
  const io = mapDisk();
  return { runs: createRunStore(io), files: io.files };
}

test("a run a program delegated is acked without a turn or a card", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  const { runs } = runFiles();
  const { run } = await runs.create({
    kind: "collect",
    delegator: { kind: "program", name: "daily-round" },
    brief: "briefs/collect.json",
    at: NOW - 10_000,
  });
  await bells.ring(
    "run-done",
    { runId: run.id, kind: run.kind, brief: "the round is in", output: "info/briefing-2026-09-14.json" },
    { at: NOW - 1000 },
  );
  const door = place("door", []);
  expect(await answerBell({ settings, bells, runs, box, now: () => NOW })).toBe(1);
  // No turn and no card: the day's briefing puts its own there
  // (info/boxes/red-box.ts).
  expect(door).toEqual([]);
  expect([...cards.values()]).toEqual([]);
  // The ledger still gets everything it waits on.
  expect((await bells.get(`run-done-${run.id}`))?.state).toBe("acked");
  expect(await bells.read()).toEqual([]);
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);
});

test("the delegator on the bell is enough, with no run file to read", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  await bells.ring(
    "run-done",
    {
      runId: "r-local",
      kind: "collect",
      brief: "the round is in",
      delegator: { kind: "program", name: "daily-round" },
    },
    { at: NOW - 1000 },
  );
  const door = place("door", []);
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(1);
  expect(door).toEqual([]);
  expect([...cards.values()]).toEqual([]);
  expect((await bells.get("run-done-r-local"))?.state).toBe("acked");
});

test("a program's run that failed is one card to decide about, and no turn", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  const { runs } = runFiles();
  const { run } = await runs.create({
    kind: "collect",
    delegator: { kind: "program", name: "daily-round" },
    brief: "briefs/collect.json",
    at: NOW - 10_000,
  });
  await bells.ring(
    "run-failed",
    { runId: run.id, kind: run.kind, reason: "every source timed out" },
    { at: NOW - 1000 },
  );
  const door = place("door", []);
  expect(await answerBell({ settings, bells, runs, box, now: () => NOW })).toBe(1);
  expect(door).toEqual([]);
  // The failure left nothing else behind, so the card is its only trace and the
  // cover is the error itself.
  const item = JSON.parse([...cards.values()][0]!) as Record<string, unknown>;
  expect(item.boxId).toBe(run.id);
  expect(item.runId).toBe(run.id);
  expect(item.source).toBe("run");
  expect(item.kind).toBe("collect");
  expect(item.needsDecision).toBe(true);
  expect(item.cover).toContain("every source timed out");
  expect(item.origin).toEqual(TODAY);
  expect((await bells.get(`run-failed-${run.id}`))?.state).toBe("acked");
  expect((await runs.get(run.id))?.deliveredAt).toBe(NOW);
});

test("a run the soul delegated is still answered in a turn", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  const { runs } = runFiles();
  const { run } = await runs.create({
    kind: "research-literature",
    delegator: { kind: "soul" },
    brief: "briefs/research.json",
    at: NOW - 10_000,
  });
  await bells.ring("run-done", { runId: run.id, kind: run.kind, brief: "four papers" }, { at: NOW - 1000 });
  const door = place("door", [{ text: "Four papers came back." }]);
  expect(await answerBell({ settings, bells, runs, box, now: () => NOW })).toBe(1);
  expect(door.length).toBe(1);
  expect([...cards.values()].length).toBe(1);
});

// --- a link taken in at the door (docs/68 「收链接」) --------------------------

// The intake card shows the fetch and its outcome, so the run is a program's
// that tells only its failure, at the door it was taken in at.
const intakeDelegator = { kind: "program", name: "link-intake", tellFailure: true } as const;
const doorOrigin = () => JSON.stringify(TODAY);

test("a door intake that filed says nothing: no turn, no card", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  await bells.ring(
    "run-done",
    {
      runId: "r-intake",
      kind: "ingest-url",
      brief: "legion/briefs/ingest-1.json",
      output: "legion/outputs/r-intake.md",
      deliverTo: doorOrigin(),
      delegator: intakeDelegator,
    },
    { at: NOW - 1000 },
  );
  const door = place("door", []);
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(1);
  expect(door).toEqual([]);
  expect([...cards.values()]).toEqual([]);
  expect((await bells.get("run-done-r-intake"))?.state).toBe("acked");
});

test("a door intake that failed is one short sentence at the door, and its card", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  await bells.ring(
    "run-failed",
    {
      runId: "r-intake",
      kind: "ingest-url",
      reason: "Could not fetch the page (404).",
      deliverTo: doorOrigin(),
      delegator: intakeDelegator,
    },
    { at: NOW - 1000 },
  );
  const door = place("door", [{ text: "The link may be mistyped; send me the right one and I'll take it in again." }]);
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(1);
  expect(door.length).toBe(1);
  expect(door[0]!.origin).toEqual(TODAY);
  expect(door[0]!.bell).toContain("at most one short sentence");
  expect(door[0]!.bell).toContain("Don't restate why it failed");
  // The Red Box item that jumps back to the chat is still there.
  const items = [...cards.values()].map((text) => JSON.parse(text) as Record<string, unknown>);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ runId: "r-intake", kind: "ingest-url", needsDecision: true });
  expect(items[0]!.origin).toEqual(TODAY);
  expect((await bells.get("run-failed-r-intake"))?.state).toBe("acked");
});

test("a failure told in one sentence is not asked to be decided about at length", () => {
  const failed = {
    id: "run-failed-r1",
    type: "run-failed",
    at: NOW,
    state: "queued",
    payload: { runId: "r1", kind: "ingest-url", reason: "Could not fetch the page (404)." },
  } as Bell;
  const told = renderBell(failed, null, { tellFailure: true });
  expect(told.split("\n")[0]).toContain("not said by the reader");
  expect(told).toContain("at most one short sentence");
  expect(told).not.toContain("Decide what to do about it");
  expect(renderBell(failed)).toContain("Decide what to do about it");
});

// --- the order of the ledger around a turn (docs/soul/87) --------------------

test("a book's turn that failed leaves the bell queued and unacked", async () => {
  const { bells } = bellStore();
  const { box, files: cards } = boxStore();
  await bells.ring(
    "run-done",
    { runId: "r-1", kind: "research-literature", brief: "in", deliverTo: bookOrigin },
    { at: NOW - 1000 },
  );
  const door = place("door", []);
  place("book", [{ error: "model down" }]);
  const trouble: string[] = [];
  expect(await answerBell({ settings, bells, box, now: () => NOW, onTrouble: (_b, why) => trouble.push(why) })).toBe(0);
  expect(trouble).toEqual(["model down"]);
  // Not sent on to the door either: the next tick tries the book again.
  expect(door).toEqual([]);
  expect((await bells.get("run-done-r-1"))?.state).not.toBe("acked");
  expect((await bells.read()).length).toBe(1);
  expect([...cards.values()].length).toBe(0);
});

async function until(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200 && !(await done()); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a bell waiting on a busy conversation holds up only that conversation's bells", async () => {
  const otherThread = JSON.stringify({ ...JSON.parse(bookOrigin), threadId: "thread-2" });
  const taken: string[] = [];
  let release!: () => void;
  const busy = new Promise<void>((resolve) => (release = resolve));
  registered.push(
    registerTurnDelivery("book", async (input) => {
      taken.push(input.runId ?? "");
      if (input.runId === "r-1") {
        input.onWait?.();
        await busy;
      }
      return { status: "answered", reply: `Back on ${input.runId}.`, watching: true };
    }),
  );
  const { bells } = bellStore();
  const { box } = boxStore();
  const ring = (runId: string, deliverTo: string, at: number) =>
    bells.ring("run-done", { runId, kind: "research-literature", brief: "in", deliverTo }, { at });
  await ring("r-1", bookOrigin, NOW - 3000);
  await ring("r-2", otherThread, NOW - 2000);
  await ring("r-3", bookOrigin, NOW - 1000);

  // r-1's conversation is busy: the pass answers r-2 on another thread, and
  // r-3 waits behind r-1 on the same one.
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(1);
  expect(taken).toEqual(["r-1", "r-2"]);
  expect((await bells.get("run-done-r-2"))?.state).toBe("acked");
  expect((await bells.get("run-done-r-1"))?.state).not.toBe("acked");

  // A pass meanwhile delivers neither of the waiting two a second time.
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(0);
  expect(taken).toEqual(["r-1", "r-2"]);

  // The busy turn lands: r-1 is answered and acked, then r-3 after it.
  release();
  await until(async () => (await bells.read()).length === 0);
  expect(taken).toEqual(["r-1", "r-2", "r-3"]);
  expect((await bells.get("run-done-r-1"))?.state).toBe("acked");
  expect((await bells.get("run-done-r-3"))?.state).toBe("acked");
});

test("a bell with nowhere else to go and a wake bell are turns at the door, carded where nobody looked", async () => {
  const door = place("door", [
    { text: "The run is back. It found two essays." },
    { text: "The run is back. It found two essays." },
  ]);
  const { bells } = bellStore();
  const { box } = boxStore();
  await bells.ring("run-done", { runId: "r-door", kind: "research-literature", brief: "in" }, { at: NOW - 2000 });
  await bells.ring("wake", { scheduleId: "s-1", brief: "Look at the week." }, { at: NOW - 1000 });
  expect(await answerBell({ settings, bells, box, now: () => NOW })).toBe(2);
  expect(door.map((t) => [t.origin, t.runId])).toEqual([
    [TODAY, "r-door"],
    [TODAY, undefined],
  ]);
  expect(door[1]!.bell).toContain("Look at the week.");
  expect(await bells.read()).toEqual([]);
  // One card, for the run; a wake bell is about a schedule and leaves none.
  const cards = await box.list();
  expect(cards.map((c) => [c.runId, c.origin, c.cover])).toEqual([["r-door", TODAY, "The run is back."]]);
});
