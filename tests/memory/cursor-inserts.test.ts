// The message cursor against conversation files that merge one message at a
// time (platform/sync/merge/messages.ts, docs/59 §5): a message another device
// wrote lands in stamp order, which can be inside the stretch a pass already
// read. Run: bun test.

import { expect, test } from "bun:test";
import { mergeFile } from "../../src/platform/sync/merge";
import { distillUnits, countUnitOwed } from "../../src/memory/observations/arrears";
import { selectNewMessages } from "../../src/memory/observations/retell";
import {
  messageCursor,
  resolveCursors,
  runDistillPass,
  unreadMessages,
  type DistillMessage,
  type DistillPassInput,
} from "../../src/memory/observations/distill";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import { ObservationFileStore, topicPassStore } from "../../src/memory/observations/store";
import { scriptedSubagentRunner } from "../support/scripted-runner";
import { JULY_17, JULY_20, makeFakeFs } from "./fakefs";

const TOPIC = "t";
const T = "11111111-2222-3333-4444-555555555555";
const PATH = "threads-book.json";

type Msg = { id: string; role: "user" | "ai"; text: string; ts: number };
const u = (id: string, ts: number): Msg => ({ id, role: "user", text: `q${ts}`, ts });
const a = (id: string, ts: number): Msg => ({ id, role: "ai", text: `a${ts}`, ts });

const enc = new TextEncoder();
const dec = new TextDecoder();

function file(messages: Msg[]): Uint8Array {
  const thread = { id: T, annotationId: "ann-1", path: "book", createdAt: 1, messages };
  return enc.encode(JSON.stringify({ threads: { [T]: thread } }, null, 2));
}

// The thread as the real merge leaves it.
function mergedMessages(base: Msg[], local: Msg[], remote: Msg[]): Msg[] {
  const out = mergeFile({ path: PATH, base: file(base), local: file(local), remote: file(remote) });
  return (JSON.parse(dec.decode(out.merged)) as { threads: Record<string, { messages: Msg[] }> })
    .threads[T].messages;
}

function makeStore() {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore(fs, () => JULY_17);
  return { fs, store, pass: topicPassStore(store, TOPIC), adapter: new FileObservationAdapter(store, TOPIC) };
}

const runner = () => scriptedSubagentRunner([], { exhausted: { text: "done" } });

function passInput(messages: DistillMessage[]): DistillPassInput {
  return {
    topicName: "attention",
    bookId: "book-1",
    bookName: "survey.pdf",
    threadId: T,
    annotationId: "ann-1",
    page: 12,
    markedText: "the marked sentence",
    messages,
  };
}

// What the sweep owes for this thread, through the unit rule and the cursor it
// reads off meta.json.
async function owed(store: ObservationFileStore, messages: Msg[]): Promise<number> {
  const meta = await store.getMeta(TOPIC);
  const [unit] = distillUnits([{ id: T, annotationId: "ann-1", messages }]);
  return countUnitOwed(
    { cursor: "distilledMessages", id: T, topicId: TOPIC, label: "survey.pdf", ...unit },
    (threadId) => messageCursor(meta, threadId),
  );
}

// Device A talks and distils; device B, offline, asked something in between.
const BASE = [u("t-a1", 10), a("t-a2", 10)];
const A = [...BASE, u("t-a3", 30), a("t-a4", 30)];

test("a question another device asked inside the distilled stretch is still owed", async () => {
  const { store, pass, adapter } = makeStore();
  const first = await runDistillPass(passInput(A), { store: pass, adapter, now: () => JULY_20, ...runner() });
  expect(first).toMatchObject({ ran: true, ok: true });
  expect(await owed(store, A)).toBe(0);

  // B's question has no reply yet: the merge sorts it between A's two turns.
  const merged = mergedMessages(BASE, A, [...BASE, u("t-b1", 20)]);
  expect(merged.map((m) => m.id)).toEqual(["t-a1", "t-a2", "t-b1", "t-a3", "t-a4"]);
  expect(await owed(store, merged)).toBe(1);
});

test("the pass over a merged thread covers what arrived, not what it already read", async () => {
  const { store, pass, adapter } = makeStore();
  await runDistillPass(passInput(A), { store: pass, adapter, now: () => JULY_20, ...runner() });

  const merged = mergedMessages(BASE, A, [...BASE, u("t-b1", 20), a("t-b2", 20)]);
  const again = await runDistillPass(passInput(merged), {
    store: pass,
    adapter,
    now: () => JULY_20,
    ...runner(),
  });
  expect(again).toMatchObject({ ran: true, ok: true, coverage: { fromTs: 20, toTs: 20 } });
  // Steady state: nothing is offered twice.
  expect(await owed(store, merged)).toBe(0);
  expect(await runDistillPass(passInput(merged), { store: pass, adapter, ...runner() })).toEqual({
    ran: false,
    skipped: "no-new-messages",
  });
});

// --- counts from before key cursors -------------------------------------------

// meta.json as a version before key cursors writes it: counts only.
async function writeOldMeta(fs: ReturnType<typeof makeStore>["fs"], counts: Record<string, number>) {
  await fs.write(
    "observations/meta.json",
    JSON.stringify({ lastDistilledAt: { [TOPIC]: JULY_17 }, distilledMessages: counts }),
  );
}

test("an old count reads as the first N in current order, and pinning it keeps a later insert owed", async () => {
  const { fs, store } = makeStore();
  await writeOldMeta(fs, { [T]: 4 });
  expect(await owed(store, A)).toBe(0);
  expect(messageCursor(await store.getMeta(TOPIC), T)).toEqual({ count: 4 });

  const meta = await store.getMeta(TOPIC);
  const pinned = resolveCursors(meta, [{ threadId: T, messages: A }]);
  expect(pinned).toEqual({
    distilledMessages: { [T]: 4 },
    distilledMessageKeys: { [T]: ["t-a1", "t-a2", "t-a3", "t-a4"] },
  });
  await store.setMeta(TOPIC, { ...meta, ...pinned });
  // Resolved once: a pair is not resolved again.
  expect(resolveCursors(await store.getMeta(TOPIC), [{ threadId: T, messages: A }])).toBeNull();

  const merged = mergedMessages(BASE, A, [...BASE, u("t-b1", 20)]);
  expect(await owed(store, merged)).toBe(1);
});

test("an old device's count on top of the keys: read as the first N plus the keys, then pinned", async () => {
  const { fs, store, pass, adapter } = makeStore();
  await runDistillPass(passInput(A), { store: pass, adapter, now: () => JULY_20, ...runner() });
  // The old device's own pass over six messages, merged into a file whose keys
  // survived: its count no longer matches the keys it sits beside.
  const six = [...A, u("t-a5", 40), a("t-a6", 40)];
  const meta = await store.getMeta(TOPIC);
  await store.setMeta(TOPIC, { ...meta, distilledMessages: { [T]: 6 } });
  expect(await owed(store, six)).toBe(0);
  expect(await owed(store, [...six, u("t-a7", 50)])).toBe(1);

  // An old device's own write drops the keys altogether: the count stands alone.
  await writeOldMeta(fs, { [T]: 6 });
  expect(messageCursor(await store.getMeta(TOPIC), T)).toEqual({ count: 6 });
  expect(await owed(store, six)).toBe(0);

  const pinned = resolveCursors(await store.getMeta(TOPIC), [{ threadId: T, messages: six }]);
  expect(pinned?.distilledMessageKeys).toEqual({ [T]: six.map((m) => m.id) });
});

test("a retell's stretch is what was not read, not what follows a count", () => {
  const spoken = [a("t-r1", 10), u("t-r2", 20), u("t-x", 25), a("t-r3", 30)];
  const cursor = { count: 3, read: ["t-r1", "t-r2", "t-r3"] };
  expect(selectNewMessages(spoken, cursor)).toEqual({ fresh: [spoken[2]], total: 4 });
  expect(unreadMessages(spoken, 2)).toEqual([spoken[2], spoken[3]]);
});

// --- the cursors merging across devices ---------------------------------------

const META = "observations/meta.json";

type MetaJson = {
  distilledMessages: Record<string, number>;
  distilledMessageKeys: Record<string, string[]>;
};

function metaFile(counts: Record<string, number>, keys: Record<string, string[]>): Uint8Array {
  const meta = { lastDistilledAt: { [TOPIC]: JULY_17 }, distilledMessages: counts, distilledMessageKeys: keys };
  return enc.encode(JSON.stringify(meta, null, 2));
}

function mergeMeta(base: Uint8Array, local: Uint8Array, remote: Uint8Array): string {
  return dec.decode(mergeFile({ path: META, base, local, remote }).merged);
}

test("two devices' key cursors merge to one pair, the same both ways round and again", () => {
  const base = metaFile({ [T]: 2 }, { [T]: ["t-a1", "t-a2"] });
  const local = metaFile({ [T]: 4 }, { [T]: ["t-a1", "t-a2", "t-a3", "t-a4"] });
  const remote = metaFile({ [T]: 3, u2: 1 }, { [T]: ["t-a1", "t-a2", "t-b1"], u2: ["t-u"] });
  const out = mergeMeta(base, local, remote);
  expect(mergeMeta(base, remote, local)).toBe(out);
  const parsed = JSON.parse(out) as MetaJson;
  // The shorter list goes with the lower count: the two maps stay a pair.
  expect(parsed.distilledMessages).toEqual({ [T]: 3, u2: 1 });
  expect(parsed.distilledMessageKeys).toEqual({ [T]: ["t-a1", "t-a2", "t-b1"], u2: ["t-u"] });
  // Idempotent: merged again with itself or with a side it came from, it stays.
  const merged = enc.encode(out);
  expect(mergeMeta(base, merged, merged)).toBe(out);
  expect(mergeMeta(local, merged, local)).toBe(out);

  // Equal lengths settle by content, the same pick from both sides.
  const l2 = metaFile({ [T]: 3 }, { [T]: ["t-a1", "t-a2", "t-a3"] });
  const tie = mergeMeta(base, l2, remote);
  expect(mergeMeta(base, remote, l2)).toBe(tie);
  const t2 = JSON.parse(tie) as MetaJson;
  expect(t2.distilledMessageKeys[T]).toHaveLength(t2.distilledMessages[T]);
});
