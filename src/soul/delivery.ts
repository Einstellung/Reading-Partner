// Where a delegated run's answer is given back (docs/68).
//
// A run carries `deliverTo`: the place the soul was standing when it delegated,
// serialised as a BoxOrigin. When the bell rings, the answer is written back
// into that place — the book's own thread if that is where the question was
// asked, the door if it was asked at the door.
//
// Assembling a turn over a book is the reading domain's knowledge and the soul
// may not import a domain, so the assembly is registered here the way a desk
// kind is registered on the desk: reading hands over an opener at startup and
// this file only knows that some place answers to "book".

import type { Settings } from "../platform/app/settings";
import type { BoxOrigin } from "../box";
import type { AssembledTurn } from "./turn";

/** What the bell hands a delivery opener. */
export interface DeliveryInput {
  origin: BoxOrigin;
  settings: Settings;
  /** The bell rendered as prose, to go on the end of the conversation. */
  bell: string;
  signal?: AbortSignal;
}

/**
 * A turn as the bell sends one. Narrower than a whole AssembledTurn: nobody is
 * watching this turn, so the notice a reader would have read and the report the
 * caller would have acted on have nowhere to go.
 */
export type DeliveredTurn = Pick<AssembledTurn, "systemPrompt" | "tools" | "messages" | "refusal">;

/** One turn, assembled where the question was asked, and where its reply goes. */
export interface Delivery {
  /** The thread store's key for that conversation (platform/app/threads.ts). */
  key: string;
  threadId: string;
  turn: DeliveredTurn;
}

/**
 * How a domain assembles the turn for one of its places. Null when there is
 * nothing to assemble after all — the book is gone, the thread was deleted, the
 * signal aborted — and then the bell falls back to the door.
 */
export type DeliveryOpener = (input: DeliveryInput) => Promise<Delivery | null>;

const OPENERS = new Map<BoxOrigin["place"], DeliveryOpener>();

/**
 * Register how one place assembles a delivery. Returns the undo. A second
 * registration replaces the first: that is a second boot, not a conflict.
 */
export function registerDelivery(place: BoxOrigin["place"], open: DeliveryOpener): () => void {
  OPENERS.set(place, open);
  return () => {
    if (OPENERS.get(place) === open) OPENERS.delete(place);
  };
}

/** The opener for a place, or null where no domain registered one. */
export function deliveryOpener(place: BoxOrigin["place"]): DeliveryOpener | null {
  return OPENERS.get(place) ?? null;
}

/**
 * The origin off a run's `deliverTo`, or null when there is none, it is not
 * JSON, or it is not one of the three shapes. A run delegated before this
 * existed has no origin, and a bell about it is answered at the door.
 */
export function parseOrigin(deliverTo: string | undefined): BoxOrigin | null {
  if (!deliverTo) return null;
  let value: unknown;
  try {
    value = JSON.parse(deliverTo);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  if (o.place === "book") {
    if (typeof o.bookId !== "string" || typeof o.threadId !== "string") return null;
    return {
      place: "book",
      bookId: o.bookId,
      threadId: o.threadId,
      ...(typeof o.annotationId === "string" && o.annotationId
        ? { annotationId: o.annotationId }
        : {}),
      ...(typeof o.page === "number" ? { page: o.page } : {}),
    };
  }
  if (o.place === "door" || o.place === "briefing") {
    if (typeof o.date !== "string") return null;
    return { place: o.place, date: o.date };
  }
  return null;
}

/**
 * One phrase naming where something came from, for the line the soul reads in
 * its own prompt. It says the kind of place and not the book's title: the soul
 * is a capability and has no way to look a title up.
 */
export function originLabel(origin: BoxOrigin): string {
  if (origin.place === "book") {
    return origin.page === undefined
      ? "a book you were reading"
      : `a book you were reading, p. ${origin.page}`;
  }
  if (origin.place === "briefing") return `the briefing of ${origin.date}`;
  return `at the door, ${origin.date}`;
}
