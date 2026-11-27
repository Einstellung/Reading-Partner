// reading-state.json both devices edited (src/platform/sync/merge/records.ts
// newerWins, the reading-state row's newerBy in palace/kinds.ts). A book whose
// position both devices moved keeps the one stamped later, whichever side it is
// on; with no stamp, or the same stamp, the content tie-break decides as it
// always did. The contract's properties run over a stamped case in
// merge.test.ts's CASES; this is the behaviour.

import { expect, test } from "bun:test";
import { mergeFile } from "../../../src/platform/sync/merge";
import type { MergeOutput } from "../../../src/platform/sync/merge/contract";
import { chooseByContent, type Json } from "../../../src/platform/sync/merge/text";

const enc = new TextEncoder();
const dec = new TextDecoder();
const PATH = "reading-state.json";

type State = { pageIndex: number; scale: string; scrollMode: number; readAt?: number };

const at = (pageIndex: number, readAt?: number): State =>
  readAt === undefined
    ? { pageIndex, scale: "auto", scrollMode: 0 }
    : { pageIndex, scale: "auto", scrollMode: 0, readAt };

function file(states: Record<string, State>): Uint8Array {
  return enc.encode(JSON.stringify({ states }, null, 2));
}

function merge(base: Uint8Array | null, local: Uint8Array, remote: Uint8Array): MergeOutput {
  return mergeFile({ path: PATH, base, local, remote });
}

function states(out: MergeOutput): Record<string, State> {
  return (JSON.parse(dec.decode(out.merged)) as { states: Record<string, State> }).states;
}

test("the position read later wins, whichever device holds it", () => {
  const base = file({ b1: at(1, 100) });
  // The iPad read on to page 40 this morning; the phone still says page 12
  // from last night and wrote it again on a cold start.
  const ipad = file({ b1: at(40, 300) });
  const phone = file({ b1: at(12, 200) });

  for (const [local, remote] of [
    [ipad, phone],
    [phone, ipad],
  ] as const) {
    const out = merge(base, local, remote);
    expect(states(out).b1).toEqual(at(40, 300));
    expect(out.dropped).toEqual([{ id: "b1", record: at(12, 200) }]);
    expect(out.contested).toBe(true);
  }
  expect(dec.decode(merge(base, ipad, phone).merged)).toBe(dec.decode(merge(base, phone, ipad).merged));
});

test("the later position wins against the content order too", () => {
  // A pair content alone would settle the other way: the stamp is what
  // decided, not a lucky hash.
  const newer = at(8, 300);
  let older = at(7, 200);
  for (let page = 7; ; page++) {
    older = at(page, 200);
    if (chooseByContent(older as unknown as Json, newer as unknown as Json).winner === (older as unknown as Json)) break;
  }
  const base = file({ b1: at(1, 100) });
  expect(states(merge(base, file({ b1: older }), file({ b1: newer }))).b1).toEqual(newer);
  expect(states(merge(base, file({ b1: newer }), file({ b1: older }))).b1).toEqual(newer);
});

test("with no base the later position still wins", () => {
  const out = merge(null, file({ b1: at(12, 200) }), file({ b1: at(40, 300) }));
  expect(states(out).b1).toEqual(at(40, 300));
});

test("a position without a stamp falls back to the content order", () => {
  const base = file({ b1: at(1) });
  const local = at(12);
  const remote = at(40, 300);
  const expected = chooseByContent(local as unknown as Json, remote as unknown as Json);
  for (const [l, r] of [
    [local, remote],
    [remote, local],
  ] as const) {
    const out = merge(base, file({ b1: l }), file({ b1: r }));
    expect(states(out).b1).toEqual(expected.winner as unknown as State);
    expect(out.dropped).toEqual([{ id: "b1", record: expected.loser }]);
  }
});

test("two positions with the same stamp fall back to the content order", () => {
  const base = file({ b1: at(1, 100) });
  const local = at(12, 200);
  const remote = at(40, 200);
  const expected = chooseByContent(local as unknown as Json, remote as unknown as Json).winner;
  expect(states(merge(base, file({ b1: local }), file({ b1: remote }))).b1).toEqual(
    expected as unknown as State,
  );
  expect(states(merge(base, file({ b1: remote }), file({ b1: local }))).b1).toEqual(
    expected as unknown as State,
  );
});

test("only the book both devices moved is contested", () => {
  const base = file({ b1: at(1, 100), b2: at(5, 100) });
  const local = file({ b1: at(12, 200), b2: at(5, 100) });
  const remote = file({ b1: at(40, 300), b2: at(9, 150) });
  const out = merge(base, local, remote);
  expect(states(out)).toEqual({ b1: at(40, 300), b2: at(9, 150) });
  expect(out.dropped).toEqual([{ id: "b1", record: at(12, 200) }]);
});

test("annotations keep the content tie-break even when they carry a time", () => {
  // newerBy is declared on the reading-state row only.
  const path = "annotations-abc123.json";
  const base = enc.encode(JSON.stringify([{ id: "a", note: "x", readAt: 1 }]));
  const l = { id: "a", note: "one", readAt: 300 };
  const r = { id: "a", note: "two", readAt: 200 };
  const expected = chooseByContent(l as unknown as Json, r as unknown as Json).winner;
  const out = mergeFile({
    path,
    base,
    local: enc.encode(JSON.stringify([l])),
    remote: enc.encode(JSON.stringify([r])),
  });
  expect(JSON.parse(dec.decode(out.merged))).toEqual([expected]);
});
