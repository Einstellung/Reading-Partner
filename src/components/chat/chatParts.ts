// The chat message-parts protocol (docs/17 refactor). A chat row is no longer a
// bag of ad-hoc fields (text + tools + card) special-cased by the renderer;
// instead every row carries an ordered `parts` array, and the render layer only
// reads parts. The legacy fields are still accepted and mapped to parts by
// messageToParts, so callers that have not migrated (the reading-side chat) keep
// working unchanged.
//
// Boundary rule: inline references — the [fig:N] / [p.N] DSL parsed in
// src/prep/anchors.ts and rendered inside Markdown — live INSIDE a text part's
// Markdown, not as parts. Block-level cards (probe-confirm, briefing-*) are their
// own `card` part. Keep it that way: do not lift inline refs into parts, and do
// not fold a card into text.

import type { InfoCard } from "../../info/briefing/cards";
import type { PersistedCardPayload, PersistedPart } from "../../app/threads";
import type { ThreadMessage, ToolStatus } from "../common/types";

// The domain payload a card renders. Payload types stay in the domain layer
// (info/cards.ts); this protocol only references the union, so the dependency
// direction stays components -> info and never the reverse.
export type CardPayload = InfoCard;
export type CardKind = CardPayload["kind"];

// Which chat surface a card renders in. Cards are available to every chat (the
// reading-side bubble too, though no reading-side card exists yet); a card may
// adapt to its surface — existing cards ignore it.
export type CardSurface = "bubble" | "call";

// One block in a chat row.
export type ChatPart =
  // A prose block; inline refs live in its Markdown (see the boundary rule above).
  | { type: "text"; text: string }
  // The ephemeral tool-call trace shown above a streaming reply (M6). Never
  // persisted; recomputed live each turn.
  | { type: "tool-trace"; tools: ToolStatus[] }
  // A block-level card. `id` is the stable handle for dispatch and for patchPart;
  // `state` is transient view state the host may attach to a card (persisted
  // cards keep their state in the payload instead).
  | { type: "card"; id: string; card: CardPayload; state?: Record<string, unknown> };

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

// Derive the render parts for a message. When `parts` is set it is authoritative;
// otherwise the legacy { tools, card, text } fields map to parts (the tool trace
// above the reply, then a standalone card, then the text). role / images /
// streaming / failed stay message-level flags — they are not parts.
export function messageToParts(m: ThreadMessage): ChatPart[] {
  if (m.parts) return m.parts;
  const parts: ChatPart[] = [];
  if (m.tools && m.tools.length) parts.push({ type: "tool-trace", tools: m.tools });
  if (m.card) parts.push({ type: "card", id: String(m.ts), card: m.card });
  if (m.text) parts.push({ type: "text", text: m.text });
  return parts;
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

// --- persistence policy ----------------------------------------------------
// Persist strategy per part type: text persists; the tool trace never does (it
// is recomputed live); a card persists by kind — the confirm card and the ready
// card are durable outcomes, the progress card is not (a reopened session is
// long past it) and a failure is in-session only (retry needs the live pipeline).
export function isPersistableCardKind(kind: CardKind): boolean {
  return kind === "probe-confirm" || kind === "briefing-ready" || kind === "profile-update";
}

export function isPersistablePart(part: ChatPart): boolean {
  if (part.type === "text") return true;
  if (part.type === "tool-trace") return false;
  return isPersistableCardKind(part.card.kind);
}

// Project a card into a durable part. Persistence keeps cards opaque (an info
// interface, not a Record), so the payload is widened through unknown here.
export function toPersistedCardPart(cardId: string, payload: CardPayload): PersistedPart {
  return { type: "card", id: cardId, card: payload as unknown as PersistedCardPayload };
}

// Map a persisted message's parts back to live render parts on thread reopen, so
// a stored card is re-rendered through the registry by its payload kind.
export function rehydrateParts(parts: PersistedPart[]): ChatPart[] {
  return parts.map((p) =>
    p.type === "card"
      ? { type: "card", id: p.id, card: p.card as unknown as CardPayload }
      : { type: "text", text: p.text },
  );
}
