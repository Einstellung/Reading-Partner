// The messages strategy (src/platform/sync/merge/messages.ts, docs/59 §5): a
// conversation file two devices both edited merges one message at a time
// instead of one thread at a time. Examples first, then the same properties
// merge.test.ts holds every strategy to, over generated conversations.
// Run: bun test.

import { expect, test } from "bun:test";
import { mergeFile } from "../../../src/platform/sync/merge";
import type { MergeOutput } from "../../../src/platform/sync/merge/contract";

const PATH = "threads-book.json";
const T = "11111111-2222-3333-4444-555555555555";
const U = "66666666-7777-8888-9999-000000000000";

type Msg = { [key: string]: unknown };

const enc = new TextEncoder();
const dec = new TextDecoder();
const text = (b: Uint8Array): string => dec.decode(b);

function thread(id: string, messages: Msg[], extra: Msg = {}): Msg {
  return { id, annotationId: "", path: "book", createdAt: 1, messages, ...extra };
}

function file(...threads: Msg[]): Uint8Array {
  return enc.encode(
    JSON.stringify({ threads: Object.fromEntries(threads.map((t) => [t.id, t])) }, null, 2),
  );
}

function merge(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array): MergeOutput {
  return mergeFile({ path: PATH, base, local, remote });
}

function threadOf(out: MergeOutput | Uint8Array, id = T): Msg {
  const bytes = out instanceof Uint8Array ? out : out.merged;
  return (JSON.parse(text(bytes)) as { threads: Record<string, Msg> }).threads[id];
}

function messagesOf(out: MergeOutput | Uint8Array, id = T): Msg[] {
  return threadOf(out, id).messages as Msg[];
}

function shape(out: MergeOutput): string {
  return JSON.stringify({
    merged: text(out.merged),
    dropped: out.dropped.map((d) => JSON.stringify(d)).sort(),
    contested: out.contested,
  });
}

// Every case runs both ways round: the two devices each merge with themselves
// as local and have to write the same bytes.
function both(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array): MergeOutput {
  const forward = merge(base, local, remote);
  expect(shape(merge(base, remote, local))).toBe(shape(forward));
  return forward;
}

const u = (id: string, ts: number, words = `q${ts}`): Msg => ({ id, role: "user", text: words, ts });
const a = (id: string, ts: number, words = `a${ts}`): Msg => ({ id, role: "ai", text: words, ts });

// --- the table ----------------------------------------------------------------

test("appends on both sides to one thread are both kept, in stamp order", () => {
  const base = file(thread(T, [u("t-1", 1), a("t-2", 1)]));
  const local = file(thread(T, [u("t-1", 1), a("t-2", 1), u("t-5", 5), a("t-6", 5)]));
  const remote = file(thread(T, [u("t-1", 1), a("t-2", 1), u("t-3", 3), a("t-4", 3)]));
  const out = both(base, local, remote);
  expect(messagesOf(out).map((m) => m.id)).toEqual(["t-1", "t-2", "t-3", "t-4", "t-5", "t-6"]);
  expect(out.dropped).toEqual([]);
  expect(out.contested).toBe(false);
});

test("a thread's own keys merge as fields beside its messages", () => {
  const base = file(thread(T, [u("t-1", 1)]));
  const local = file(thread(T, [u("t-1", 1), u("t-2", 2)], { focusChapter: 3 }));
  const remote = file(thread(T, [u("t-1", 1), u("t-3", 3)], { topicId: "topic-x", future: [1] }));
  const out = both(base, local, remote);
  const merged = threadOf(out);
  expect(merged.focusChapter).toBe(3);
  expect(merged.topicId).toBe("topic-x");
  // A key this build has never heard of rides through.
  expect(merged.future).toEqual([1]);
  expect(messagesOf(out).map((m) => m.id)).toEqual(["t-1", "t-2", "t-3"]);
});

test("a key on a message this build does not know survives the merge", () => {
  const base = file(thread(T, [u("t-1", 1)]));
  const local = file(thread(T, [u("t-1", 1), { ...a("t-2", 2), later: { x: 1 } }]));
  const remote = file(thread(T, [u("t-1", 1), u("t-3", 3)]));
  expect(messagesOf(both(base, local, remote))[1]).toEqual({ ...a("t-2", 2), later: { x: 1 } });
});

test("a reply caught half written loses to its own continuation, whichever side has it", () => {
  const base = file(thread(T, [u("t-1", 1)]));
  const half = file(thread(T, [u("t-1", 1), a("t-2", 2, "The chapter argues")]));
  const whole = file(
    thread(T, [u("t-1", 1), a("t-2", 2, "The chapter argues that memory is rebuilt."), u("t-3", 3)]),
  );
  for (const b of [base, null]) {
    const out = both(b, half, whole);
    expect(messagesOf(out)[1].text).toBe("The chapter argues that memory is rebuilt.");
    // Nothing in the half is missing from the file, so nothing is journalled.
    expect(out.dropped).toEqual([]);
    expect(out.contested).toBe(false);
  }
});

test("parts grow as a prefix: the last part may grow, a trace by more tools", () => {
  const tool = (name: string) => ({ name, label: name, state: "done" });
  const short = {
    ...a("t-2", 2, "Lo"),
    parts: [{ type: "trace", tools: [tool("look")] }, { type: "text", text: "Lo" }],
  };
  const long = {
    ...a("t-2", 2, "Look here"),
    parts: [
      { type: "trace", tools: [tool("look")] },
      { type: "text", text: "Look here" },
      { type: "trace", tools: [tool("mark")] },
    ],
  };
  const base = file(thread(T, [u("t-1", 1)]));
  const out = both(base, file(thread(T, [u("t-1", 1), short])), file(thread(T, [u("t-1", 1), long])));
  expect(messagesOf(out)[1]).toEqual(long);
  expect(out.dropped).toEqual([]);

  const traced = { ...a("t-2", 2, ""), parts: [{ type: "trace", tools: [tool("look")] }] };
  const more = { ...a("t-2", 2, ""), parts: [{ type: "trace", tools: [tool("look"), tool("mark")] }] };
  const out2 = both(null, file(thread(T, [traced])), file(thread(T, [more])));
  expect(messagesOf(out2)).toEqual([more]);
  expect(out2.contested).toBe(false);
});

test("a card that changed is an edit, not a continuation", () => {
  const card = (state: string) => ({
    ...a("t-2", 2, "Add it?"),
    parts: [{ type: "card", id: "c1", card: { kind: "confirm", state } }],
  });
  const base = file(thread(T, [u("t-1", 1), card("pending")]));
  const out = both(
    base,
    file(thread(T, [u("t-1", 1), card("added")])),
    file(thread(T, [u("t-1", 1), card("dismissed")])),
  );
  expect(out.contested).toBe(true);
  expect(out.dropped).toHaveLength(1);
  expect(out.dropped[0].id).toBe(`${T}/t-2`);
});

test("two real edits of one message: one is kept, the other journalled under the message", () => {
  const base = file(thread(T, [u("t-1", 1), a("t-2", 2, "first")]));
  const left = a("t-2", 2, "left said this");
  const right = a("t-2", 2, "right said that");
  const out = both(
    base,
    file(thread(T, [u("t-1", 1), left, u("t-3", 3)])),
    file(thread(T, [u("t-1", 1), right])),
  );
  const kept = messagesOf(out)[1];
  const lost = kept.text === left.text ? right : left;
  expect([left.text, right.text]).toContain(kept.text as string);
  expect(out.dropped).toEqual([{ id: `${T}/t-2`, record: lost }]);
  expect(out.contested).toBe(true);
  // The other side's append is untouched by the conflict next to it.
  expect(messagesOf(out).map((m) => m.id)).toEqual(["t-1", "t-2", "t-3"]);
});

test("a message deleted on one side and left alone on the other goes, into the journal", () => {
  const receipt = a("t-2", 2, "aside receipt");
  const base = file(thread(T, [u("t-1", 1), receipt]));
  const out = both(
    base,
    file(thread(T, [u("t-1", 1)])),
    file(thread(T, [u("t-1", 1), receipt, u("t-3", 3)])),
  );
  expect(messagesOf(out).map((m) => m.id)).toEqual(["t-1", "t-3"]);
  expect(out.dropped).toEqual([{ id: `${T}/t-2`, record: receipt }]);
  expect(out.contested).toBe(false);
});

test("a message deleted on one side and edited on the other keeps the edit", () => {
  const base = file(thread(T, [u("t-1", 1), a("t-2", 2, "old")]));
  const out = both(
    base,
    file(thread(T, [u("t-1", 1), u("t-3", 3)])),
    file(thread(T, [u("t-1", 1), a("t-2", 2, "new")])),
  );
  expect(messagesOf(out).map((m) => m.text)).toEqual(["q1", "new", "q3"]);
  expect(out.dropped).toEqual([]);
});

test("with no base nothing is deleted: both sides' messages are a union", () => {
  const out = both(
    null,
    file(thread(T, [u("t-1", 1), a("t-2", 1)])),
    file(thread(T, [u("t-1", 1), u("t-3", 3)])),
  );
  expect(messagesOf(out).map((m) => m.id)).toEqual(["t-1", "t-2", "t-3"]);
});

// --- identity and order -------------------------------------------------------

test("a message with no id is known by thread, stamp and role", () => {
  const legacy = (role: string, ts: number, words: string): Msg => ({ role, text: words, ts });
  // The user turn and its reply share a stamp, as 49% of the legacy anchors do.
  const base = file(thread(T, [legacy("user", 1, "q"), legacy("ai", 1, "old")]));
  const out = both(
    base,
    file(thread(T, [legacy("user", 1, "q"), legacy("ai", 1, "left")])),
    file(thread(T, [legacy("user", 1, "q"), legacy("ai", 1, "right")])),
  );
  expect(messagesOf(out).map((m) => m.role)).toEqual(["user", "ai"]);
  expect(out.dropped.map((d) => d.id)).toEqual([`${T}/${T}:1:ai`]);
});

test("order is stamp, then user before ai, then key", () => {
  const out = both(
    null,
    file(thread(T, [a("t-b", 5), u("t-z", 5), a("t-9", 2)])),
    file(thread(T, [a("t-a", 5), u("t-1", 7)])),
  );
  expect(messagesOf(out).map((m) => m.id)).toEqual(["t-9", "t-z", "t-a", "t-b", "t-1"]);
});

test("two messages under one key fall back to the whole thread, and only that thread", () => {
  const twin = (words: string): Msg => ({ role: "ai", text: words, ts: 4 });
  const base = file(thread(T, [u("t-1", 1)]), thread(U, [u("t-1", 1)]));
  const local = file(
    thread(T, [u("t-1", 1), twin("one"), twin("two")]),
    thread(U, [u("t-1", 1), u("t-2", 2)]),
  );
  const remote = file(thread(T, [u("t-1", 1), u("t-3", 3)]), thread(U, [u("t-1", 1), u("t-3", 3)]));
  const out = both(base, local, remote);
  expect(out.contested).toBe(true);
  // T is one side's whole thread, the other side's journalled under the thread.
  const whole = [threadOf(local), threadOf(remote)];
  expect(whole).toContainEqual(threadOf(out));
  expect(out.dropped).toHaveLength(1);
  expect(out.dropped[0].id).toBe(T);
  // U beside it still merges message by message.
  expect(messagesOf(out, U).map((m) => m.id)).toEqual(["t-1", "t-2", "t-3"]);
});

test("a thread only one side touched comes back as that side wrote it", () => {
  const base = file(thread(T, [u("t-1", 1)]));
  // Out of stamp order on disk: nothing reorders a thread nobody contested.
  const local = file(thread(T, [u("t-1", 1), a("t-9", 9), u("t-2", 2)]));
  expect(text(merge(base, local, base).merged)).toBe(text(local));
  expect(text(merge(base, base, local).merged)).toBe(text(local));
});

// --- properties over generated conversations ---------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case {
  base: Uint8Array | null;
  local: Uint8Array;
  remote: Uint8Array;
}

function conversationCase(seed: number): Case {
  const rand = mulberry32(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const baseMessages: Msg[] = [];
  for (let i = 0; i < 6; i++) {
    const ts = 10 * i;
    // Half the messages predate ids.
    const withId = pick(2) === 0;
    for (const role of ["user", "ai"]) {
      const m: Msg = { role, text: `${role} ${i}`, ts };
      baseMessages.push(withId ? { id: `t-${role[0]}${i}`, ...m } : m);
    }
  }
  const side = (salt: string): Msg[] => {
    const out: Msg[] = [];
    for (const m of baseMessages) {
      switch (pick(7)) {
        case 0:
          break; // deleted
        case 1:
          out.push({ ...m, text: `${m.text} and more` }); // streamed on
          break;
        case 2:
          out.push({ ...m, text: `rewritten by ${salt}` });
          break;
        case 3:
          out.push({ ...m, parts: [{ type: "text", text: m.text }] });
          break;
        default:
          out.push({ ...m });
      }
    }
    for (let i = 0; i < pick(4); i++) {
      // A small pool of ids and stamps, so both sides sometimes add the same one.
      const ts = 100 + pick(3);
      const role = pick(2) === 0 ? "user" : "ai";
      const added: Msg = { role, text: pick(2) === 0 ? "shared" : `new ${salt}`, ts };
      out.push(pick(2) === 0 ? { id: `t-n${pick(3)}`, ...added } : added);
    }
    // Keep a side well formed: no two messages under one key.
    const seen = new Set<string>();
    return out.filter((m) => {
      const key = typeof m.id === "string" ? m.id : `${m.ts}:${m.role}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const fields = (salt: number): Msg => {
    const out: Msg = {};
    if (pick(3) === 0) out.focusChapter = salt;
    if (pick(4) === 0) out.topicId = `topic-${salt}`;
    return out;
  };
  const baseThread = thread(T, baseMessages);
  const withBase = pick(4) > 0;
  return {
    base: withBase ? file(baseThread) : null,
    local: file(thread(T, side("L"), fields(1))),
    remote: file(thread(T, side("R"), fields(2))),
  };
}

const CASES = Array.from({ length: 300 }, (_, i) => conversationCase(i + 1));

function keyOf(m: Msg): string {
  return typeof m.id === "string" ? m.id : `${T}:${m.ts}:${m.role}`;
}

test("property: swapping the sides changes nothing", () => {
  for (const c of CASES) both(c.base, c.local, c.remote);
});

test("property: a merged pair merged again is itself", () => {
  for (const c of CASES) {
    const once = merge(c.base, c.local, c.remote).merged;
    expect(text(merge(c.base, once, once).merged)).toBe(text(once));
    expect(text(merge(once, once, once).merged)).toBe(text(once));
  }
});

test("property: the device that merges second lands on what the first uploaded", () => {
  for (const c of CASES) {
    const once = merge(c.base, c.local, c.remote).merged;
    expect(text(merge(c.base, once, c.local).merged)).toBe(text(once));
    expect(text(merge(c.base, once, c.remote).merged)).toBe(text(once));
    expect(text(merge(c.base, c.local, once).merged)).toBe(text(once));
  }
});

test("property: messages come out in stamp order, user before ai", () => {
  for (const c of CASES) {
    const out = messagesOf(merge(c.base, c.local, c.remote));
    for (let i = 1; i < out.length; i++) {
      const [p, q] = [out[i - 1], out[i]];
      const order = (p.ts as number) - (q.ts as number) || (p.role === "user" ? 0 : 1) - (q.role === "user" ? 0 : 1);
      expect(order <= 0).toBe(true);
    }
  }
});

test("property: nothing a side wrote leaves without being kept, continued or journalled", () => {
  for (const c of CASES) {
    const out = merge(c.base, c.local, c.remote);
    const merged = new Map(messagesOf(out).map((m) => [keyOf(m), m]));
    const base = new Map(
      c.base === null ? [] : messagesOf(c.base).map((m) => [keyOf(m), JSON.stringify(m)]),
    );
    const journalled = out.dropped.map((d) => JSON.stringify(d.record));
    for (const side of [c.local, c.remote]) {
      for (const m of messagesOf(side)) {
        const written = JSON.stringify(m);
        if (written === base.get(keyOf(m))) continue;
        const kept = merged.get(keyOf(m));
        if (kept && JSON.stringify(kept) === written) continue;
        if (kept && typeof kept.text === "string" && kept.text.startsWith(m.text as string)) continue;
        expect({ key: keyOf(m), journalled: journalled.includes(written) }).toEqual({
          key: keyOf(m),
          journalled: true,
        });
      }
    }
  }
});
