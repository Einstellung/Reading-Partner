// The chat message-parts protocol (src/components/chatParts.ts): the legacy-field
// adapter, the by-id card-part update channel (the patchPart primitives), and the
// persistence policy + round-trip. Pure — no React, no filesystem. Run: bun test.

import { expect, test } from "bun:test";
import {
  cardRow,
  findCardPart,
  insertBeforeLast,
  isPersistableCardKind,
  isPersistablePart,
  messageToParts,
  nextCardId,
  patchCardPayload,
  rehydrateParts,
  toPersistedCardPart,
  upsertCardRow,
  type CardPayload,
  type ChatPart,
} from "../../src/components/chatParts";
import type { ThreadMessage } from "../../src/components/types";
import type { ProbeConfirmCardData } from "../../src/info/cards";

const probe = (added?: boolean): ProbeConfirmCardData => ({
  kind: "probe-confirm",
  descriptor: { id: "s1", name: "Example", enabled: true } as ProbeConfirmCardData["descriptor"],
  pipeLabel: "RSS (full text)",
  samples: [{ title: "a", chars: 900, fullText: true }],
  ...(added !== undefined ? { added } : {}),
});

// --- messageToParts adapter -------------------------------------------------

test("messageToParts maps legacy tools + text to a trace part then a text part", () => {
  const m: ThreadMessage = {
    role: "ai",
    ts: 1,
    text: "hi",
    tools: [{ name: "probe_source", label: "Probing", state: "running" }],
  };
  expect(messageToParts(m)).toEqual([
    { type: "tool-trace", tools: [{ name: "probe_source", label: "Probing", state: "running" }] },
    { type: "text", text: "hi" },
  ]);
});

test("messageToParts maps a legacy card field to a card part keyed by ts", () => {
  const m: ThreadMessage = { role: "ai", ts: 42, text: "", card: probe() };
  const parts = messageToParts(m);
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({ type: "card", id: "42" });
});

test("messageToParts treats an explicit parts array as authoritative", () => {
  const parts: ChatPart[] = [{ type: "text", text: "explicit" }];
  const m: ThreadMessage = { role: "ai", ts: 1, text: "ignored-legacy", tools: [], parts };
  expect(messageToParts(m)).toBe(parts);
});

test("messageToParts on a plain empty AI row yields no parts", () => {
  expect(messageToParts({ role: "ai", ts: 1, text: "" })).toEqual([]);
});

// --- the patchPart channel (by-id updaters) --------------------------------

test("insertBeforeLast drops a card row above the last (streaming) row", () => {
  const streaming: ThreadMessage = { role: "ai", ts: 2, text: "", streaming: true };
  const row = cardRow("c1", probe(), 1);
  expect(insertBeforeLast([streaming], row)).toEqual([row, streaming]);
  // An empty list becomes just the card row.
  expect(insertBeforeLast([], row)).toEqual([row]);
});

test("upsertCardRow appends when the id is new, then updates that row in place", () => {
  let msgs: ThreadMessage[] = [{ role: "ai", ts: 1, text: "reply" }];
  msgs = upsertCardRow(msgs, "briefing", { kind: "briefing-progress", phase: "fetching", collect: null, triage: null });
  expect(msgs).toHaveLength(2);
  expect(findCardPart(msgs, "briefing")?.payload.kind).toBe("briefing-progress");

  const ready: CardPayload = { kind: "briefing-ready", date: "2026-07-22", worth: 3, oneLiners: 1, filtered: 2 };
  const after = upsertCardRow(msgs, "briefing", ready);
  expect(after).toHaveLength(2); // reused the same row, not appended
  expect(findCardPart(after, "briefing")?.payload).toEqual(ready);
});

test("patchCardPayload merges into the addressed card; a miss returns the same ref", () => {
  const msgs = [cardRow("c1", probe(false))];
  const flipped = patchCardPayload(msgs, "c1", { added: true });
  expect((findCardPart(flipped, "c1")?.payload as ProbeConfirmCardData).added).toBe(true);
  // untouched original
  expect((findCardPart(msgs, "c1")?.payload as ProbeConfirmCardData).added).toBe(false);
  expect(patchCardPayload(msgs, "missing", { added: true })).toBe(msgs);
});

test("findCardPart returns the host row ts and the payload", () => {
  const msgs = [{ role: "ai" as const, ts: 7, text: "x" }, cardRow("c1", probe(), 9)];
  expect(findCardPart(msgs, "c1")).toMatchObject({ ts: 9 });
  expect(findCardPart(msgs, "nope")).toBeUndefined();
});

test("nextCardId is unique per call", () => {
  expect(nextCardId("probe")).not.toBe(nextCardId("probe"));
});

// --- persistence policy + round-trip ---------------------------------------

test("persistence policy: text yes, tool-trace no, card by kind", () => {
  expect(isPersistablePart({ type: "text", text: "x" })).toBe(true);
  expect(isPersistablePart({ type: "tool-trace", tools: [] })).toBe(false);
  expect(isPersistablePart({ type: "card", id: "c", card: probe() })).toBe(true);
  expect(
    isPersistablePart({
      type: "card",
      id: "c",
      card: { kind: "briefing-progress", phase: "fetching", collect: null, triage: null },
    }),
  ).toBe(false);
  expect(isPersistableCardKind("probe-confirm")).toBe(true);
  expect(isPersistableCardKind("briefing-ready")).toBe(true);
  expect(isPersistableCardKind("briefing-progress")).toBe(false);
  expect(isPersistableCardKind("briefing-failed")).toBe(false);
});

test("toPersistedCardPart -> JSON -> rehydrateParts round-trips a card", () => {
  const persisted = toPersistedCardPart("c1", probe(true));
  const wire = JSON.parse(JSON.stringify([persisted]));
  const live = rehydrateParts(wire);
  expect(live[0]).toMatchObject({ type: "card", id: "c1" });
  expect((live[0] as Extract<ChatPart, { type: "card" }>).card).toMatchObject({
    kind: "probe-confirm",
    added: true,
  });
});
