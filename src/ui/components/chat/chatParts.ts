// The chat message-parts protocol (docs/17 refactor). A chat row is no longer a
// bag of ad-hoc fields (text + tools + card) special-cased by the renderer;
// instead every row carries an ordered `parts` array, and the render layer only
// reads parts. The legacy fields are still accepted and mapped to parts by
// messageToParts, so callers that have not migrated (the reading-side chat) keep
// working unchanged.
//
// Boundary rule: inline references — the [fig:N] / [p.N] DSL parsed in
// src/reading/prep/anchors.ts and rendered inside Markdown — live INSIDE a text part's
// Markdown, not as parts. Block-level cards (probe-confirm, briefing-*) are their
// own `card` part. Keep it that way: do not lift inline refs into parts, and do
// not fold a card into text.

import type { FC } from "react";
import type { InfoCard } from "../../../info/boxes/cards";
import type { AsideCard } from "../../../reading/aside";
import type { ReadingCard } from "../../../reading/retell/cards";
import type {
  PersistedCardPayload,
  PersistedPart,
  ThreadMessage as StoredMessage,
} from "../../../platform/app/threads";
import type { ThreadMessage } from "./types";
import { persistedTrace, type Receipt, type ToolStatus } from "../../../ai/tool-status";

// The domain payload a card renders. Payload types stay in the domain layer
// (info/boxes/cards.ts, reading/retell/cards.ts, reading/aside.ts); this
// protocol only references the union, so the dependency direction stays
// components -> domain and never the reverse. Each unit contributes its own
// member — a unit, not a whole domain: reading/aside contributes separately from
// reading/retell so neither has to import the other to be in the union. The
// registry (ui/components/cardRegistry.ts, one level above chat/) is where the
// components are gathered.
export type CardPayload = InfoCard | ReadingCard | AsideCard;
export type CardKind = CardPayload["kind"];

// The component table the render layer looks a card up in, by kind. The mapped
// type narrows each component's payload to its own kind, so a mismatched pairing
// or a kind with no component is a compile error.
export type CardRegistry = {
  [K in CardKind]: FC<CardComponentProps<Extract<CardPayload, { kind: K }>>>;
};

// One domain's share of the registry.
export type CardRegistryFor<Kinds extends CardKind> = {
  [K in Kinds]: FC<CardComponentProps<Extract<CardPayload, { kind: K }>>>;
};

// Which chat surface a card renders in. Cards are available to every chat (the
// reading-side bubble too, though no reading-side card exists yet); a card may
// adapt to its surface — existing cards ignore it.
export type CardSurface = "bubble" | "call";

// One block in a chat row.
export type ChatPart =
  // A prose block; inline refs live in its Markdown (see the boundary rule above).
  | { type: "text"; text: string }
  // The ephemeral tool-call trace, drawn under the words written so far (M6).
  // Never persisted; recomputed live each turn.
  | { type: "tool-trace"; tools: ToolStatus[] }
  // A block-level card. `id` is the stable handle for dispatch and for patchPart;
  // `state` is transient view state the host may attach to a card (persisted
  // cards keep their state in the payload instead).
  | { type: "card"; id: string; card: CardPayload; state?: Record<string, unknown> }
  // What a write left behind, for the reader (docs/72). Derived, never stored:
  // the trace beside it is what the thread file keeps, and this is read back off
  // it, so there is one durable record of a turn and not two that can disagree.
  | { type: "receipt"; receipt: Receipt; toolName: string }
  // Work handed off to a run. Derived the same way, from a receipt that points
  // at a run: what a reader wants from a piece of work sent away is where it got
  // to, which is in the run file and not in this thread.
  | { type: "dispatch"; runId: string; receipt: Receipt };

// The effects a card can ask of its host. The host's onCardAction owns
// orchestration — a single user gesture may perform several of these — so cards
// stay presentational and only declare intent.
//   local    — update this card's own payload/state in place, no host write.
//   mutate   — a host-side side effect / write, named by `op` (e.g. add-source).
//   reply    — inject a synthetic message into the thread.
//   navigate — move the host elsewhere (e.g. open the briefing takeover).
//   resolve  — settle a pending card with a value. Reserved for future
//              human-in-the-loop cards; no card dispatches it yet, but the
//              dispatcher branch is defined so the vocabulary is complete.
export type CardAction =
  | { kind: "local"; patch: Record<string, unknown> }
  | { kind: "mutate"; op: string }
  | { kind: "reply"; role?: "user" | "ai"; text: string }
  | { kind: "navigate"; to: string; arg?: string }
  | { kind: "resolve"; value: unknown };

// The dispatcher the host wires into the message list. MessageBubble calls it
// with the card's id and the action the card raised.
export type CardActionHandler = (cardId: string, action: CardAction) => void;

// Props every registered card component receives. `payload` is narrowed to the
// component's kind by the registry's mapped type (see CARD_REGISTRY).
export interface CardComponentProps<P extends CardPayload = CardPayload> {
  payload: P;
  state?: Record<string, unknown>;
  dispatch: (action: CardAction) => void;
  surface: CardSurface;
}

// The receipts and dispatch tickets a settled trace carries (docs/72). A done
// call that reported a receipt becomes one part: a dispatch where the receipt
// points at a run, a plain receipt otherwise. Running calls have nothing to show
// yet and failed ones keep their red line in the trace, so neither is derived.
// A quiet call is not derived either: the reader is shown nothing about it, and
// its receipt stays where the trace keeps it, on disk.
// The order is the order the calls finished in.
function tracedReceipts(tools: readonly ToolStatus[]): ChatPart[] {
  const out: ChatPart[] = [];
  for (const t of tools) {
    if (t.quiet) continue;
    if (t.state !== "done" || !t.receipt) continue;
    const link = t.receipt.link;
    out.push(
      link && link.kind === "run"
        ? { type: "dispatch", runId: link.id, receipt: t.receipt }
        : { type: "receipt", receipt: t.receipt, toolName: t.name },
    );
  }
  return out;
}

// Derive the render parts for a message. When `parts` is set it is authoritative;
// otherwise the legacy { text, tools, card } fields map to parts in the order
// they are drawn: the reply, the tool trace under it, then a standalone card.
// role / images / streaming / failed stay message-level flags — they are not
// parts.
//
// Receipts and dispatch tickets are then unfolded out of each trace and placed
// in front of it: after the words the round wrote, before the grey line naming
// the calls. The same array comes back untouched when a row has none, so a row
// the reader has scrolled past is not rebuilt on every render.
export function messageToParts(m: ThreadMessage): ChatPart[] {
  const base = m.parts ?? legacyParts(m);
  const out: ChatPart[] = [];
  let derived = 0;
  for (const p of base) {
    if (p.type === "tool-trace") {
      const receipts = tracedReceipts(p.tools);
      derived += receipts.length;
      out.push(...receipts);
    }
    out.push(p);
  }
  return derived ? out : base;
}

function legacyParts(m: ThreadMessage): ChatPart[] {
  const parts: ChatPart[] = [];
  if (m.text) parts.push({ type: "text", text: m.text });
  if (m.tools && m.tools.length) parts.push({ type: "tool-trace", tools: m.tools });
  if (m.card) parts.push({ type: "card", id: String(m.ts), card: m.card });
  return parts;
}

// What a one-line glance at a conversation shows (the corner chat card, docs/03):
// the newest row that has prose in it.
//
// A row carrying a card part renders as the card and nothing else
// (MessageBubble short-circuits it), so that row's `text` is not something the
// reader has ever been shown. On an aside's receipt it is the sentence written
// for the model to read on the lesson's next turn, and the glance was printing
// that to the reader verbatim, as the newest row, immediately after every
// return. Card rows are skipped and the prose above them answers instead — for
// any kind of card, including one this version has no component for.
export function chatGlance(messages: readonly ThreadMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (messageToParts(m).some((p) => p.type === "card")) continue;
    const text = m.text.trim();
    if (text) return text;
  }
  return null;
}

// --- card-part locators / updaters (the patchPart channel) -----------------
// Pure operations over a UI messages array, keyed by a card's stable id. These
// replace the hand-rolled upsertByTs / insertCardBeforeStreaming closures with
// one by-id update channel, and are unit-testable without React.

let cardSeq = 0;
// A fresh, process-unique card id. Card rows created live (a trial's confirm
// card) need an id that dispatch and patchPart can address.
export function nextCardId(prefix: string): string {
  cardSeq += 1;
  return `${prefix}-${Date.now()}-${cardSeq}`;
}

// Build a standalone AI row carrying a single card part.
export function cardRow(cardId: string, payload: CardPayload, ts = Date.now()): ThreadMessage {
  return { role: "ai", text: "", ts, parts: [{ type: "card", id: cardId, card: payload }] };
}

// Locate the card part with this id, returning its host row's ts and the payload.
export function findCardPart(
  messages: ThreadMessage[],
  cardId: string,
): { ts: number; payload: CardPayload } | undefined {
  for (const m of messages) {
    const parts = messageToParts(m);
    for (const p of parts) {
      if (p.type === "card" && p.id === cardId) return { ts: m.ts, payload: p.card };
    }
  }
  return undefined;
}

// Insert a card row just before the last row (a trial's confirm card belongs
// above the AI's concluding text). An empty list becomes just the card row.
export function insertBeforeLast(messages: ThreadMessage[], row: ThreadMessage): ThreadMessage[] {
  if (!messages.length) return [row];
  const copy = [...messages];
  copy.splice(copy.length - 1, 0, row);
  return copy;
}

// Set the card part addressed by `cardId` to `payload`, creating a trailing AI
// row if none carries it yet. The unified insert/update entry that the briefing
// progress -> ready/failed lifecycle rides on (one stable card id across the
// whole run).
export function upsertCardRow(
  messages: ThreadMessage[],
  cardId: string,
  payload: CardPayload,
): ThreadMessage[] {
  let found = false;
  const next = messages.map((m) => {
    const parts = m.parts;
    if (!parts) return m;
    let hit = false;
    const nextParts = parts.map((p) => {
      if (p.type === "card" && p.id === cardId) {
        hit = true;
        return { ...p, card: payload };
      }
      return p;
    });
    if (hit) found = true;
    return hit ? { ...m, parts: nextParts } : m;
  });
  return found ? next : [...messages, cardRow(cardId, payload)];
}

// Merge `patch` into the payload of the card part addressed by `cardId`, in
// place. Returns the same array reference when nothing matched.
export function patchCardPayload(
  messages: ThreadMessage[],
  cardId: string,
  patch: Record<string, unknown>,
): ThreadMessage[] {
  let found = false;
  const next = messages.map((m) => {
    const parts = m.parts;
    if (!parts) return m;
    let hit = false;
    const nextParts = parts.map((p) => {
      if (p.type === "card" && p.id === cardId) {
        hit = true;
        return { ...p, card: { ...p.card, ...patch } as CardPayload };
      }
      return p;
    });
    if (hit) found = true;
    return hit ? { ...m, parts: nextParts } : m;
  });
  return found ? next : messages;
}

// Project a settled tool trace into a durable part. A trace whose calls are all
// still running belongs to a turn that never landed, and is not stored.
export function toPersistedTracePart(tools: readonly ToolStatus[]): PersistedPart | null {
  const settled = persistedTrace(tools);
  return settled ? { type: "trace", tools: settled } : null;
}

// Project a card into a durable part. Persistence keeps cards opaque (an info
// interface, not a Record), so the payload is widened through unknown here.
export function toPersistedCardPart(cardId: string, payload: CardPayload): PersistedPart {
  return { type: "card", id: cardId, card: payload as unknown as PersistedCardPayload };
}

// Map a persisted message's parts back to live render parts on thread reopen, so
// a stored card is re-rendered through the registry by its payload kind.
export function rehydrateParts(parts: PersistedPart[]): ChatPart[] {
  return parts.map((p) => {
    if (p.type === "card") return { type: "card", id: p.id, card: p.card as unknown as CardPayload };
    if (p.type === "trace") {
      return { type: "tool-trace", tools: p.tools as unknown as ToolStatus[] };
    }
    return { type: "text", text: p.text };
  });
}

// Whether the words the row was stored with still have to be turned into a part.
// A reply that called a tool is written to the thread file with its text at
// message level and only the settled trace as a part; `parts` is authoritative
// for the renderer, so on reopen that row would draw the grey trace line and
// none of the answer. The text is put back in front of the parts it was stored
// beside.
//
// Not when a card is among them: a card row renders as the card alone, and its
// `text` is not something the reader has been shown — on an aside receipt it is
// the sentence written for the model (reading/aside.ts).
function needsStoredText(m: StoredMessage, parts: readonly PersistedPart[]): boolean {
  if (!m.text) return false;
  return !parts.some((p) => p.type === "text" || p.type === "card");
}

// Persisted thread message -> live UI message on reopen. A stored card message
// rehydrates its parts; a message written before parts existed (or one carrying
// an empty array) stays text-only, so the row falls back to `text` alone.
export function rehydrateMessage(m: StoredMessage): ThreadMessage {
  // The id rides along: it is how a message that arrives in a conversation the
  // reader has open is told apart from the copy of it already on screen.
  // The run this row answers, where it is a delivery: what a dispatch ticket
  // further up the thread points at when its run comes back (docs/72).
  const stamp = {
    ...(m.id ? { id: m.id } : {}),
    ...(m.origin ? { origin: m.origin } : {}),
    role: m.role,
    text: m.text,
    ts: m.ts,
  };
  if (m.parts && m.parts.length) {
    const parts = rehydrateParts(m.parts);
    return {
      ...stamp,
      parts: needsStoredText(m, m.parts) ? [{ type: "text", text: m.text }, ...parts] : parts,
    };
  }
  return stamp;
}
