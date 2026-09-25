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

import type { SteerPort } from "../legion/execute/contract";
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

/**
 * What a place holds open while a bell's own turn runs there (docs/72). The
 * conversation is not free while it is running: the reader's Stop has to reach
 * it, and the reader talking into it has to steer it rather than open a second
 * turn on the same thread.
 */
export interface DeliveryHold {
  /** The signal the turn must be sent with, so Stop reaches it. */
  signal: AbortSignal;
  /** The turn can be steered from here on. */
  steerable: (port: SteerPort) => void;
  /** The turn has landed, whichever way. Called exactly once. */
  release: () => void;
}

/** One turn, assembled where the question was asked, and where its reply goes. */
export interface Delivery {
  /** The thread store's key for that conversation (platform/app/threads.ts). */
  key: string;
  threadId: string;
  turn: DeliveredTurn;
  /**
   * Whether the reader is looking at this conversation as the reply lands. The
   * same question a plain reading turn asks itself (reading/turn-box.ts), asked
   * here so a delegated answer follows the same rule: seen means no card. Absent
   * where the place has no notion of being watched — the door, a briefing — and
   * then the card is always put.
   */
  watching?: () => boolean;
  /**
   * Take the conversation for the length of this turn. Absent where the place
   * has no notion of a turn running in it — the door, a briefing — and then the
   * bell's turn runs unheld, the way every bell's did before docs/72.
   */
  hold?: (signal?: AbortSignal) => DeliveryHold;
}

/**
 * How a domain assembles the turn for one of its places. Null when there is
 * nothing to assemble after all — the book is gone, the thread was deleted, the
 * signal aborted — and then the bell falls back to the door.
 */
export type DeliveryOpener = (input: DeliveryInput) => Promise<Delivery | null>;

/** A bell for a place where a turn is already running. */
export interface LiveDelivery {
  origin: BoxOrigin;
  /** The bell rendered as prose — the same text a trailing message carries. */
  bell: string;
  /** Stamped on the line the soul writes once the model has been handed this. */
  runId: string;
}

/**
 * Put a bell into the turn already running in that place. Resolves null when
 * nothing was running there, or when the turn ended before the model was handed
 * it — and then the bell is answered by a turn of its own, unacked until it is.
 * `watching` is the same question Delivery asks, asked at the moment it landed.
 */
export type LiveDeliverer = (
  input: LiveDelivery,
) => Promise<{ threadId: string; watching: boolean } | null>;

const OPENERS = new Map<BoxOrigin["place"], DeliveryOpener>();
const LIVE = new Map<BoxOrigin["place"], LiveDeliverer>();

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
 * Say how one place hands a bell to a turn it already has running. Returns the
 * undo. A place that registers none never takes this path.
 */
export function registerLiveDelivery(place: BoxOrigin["place"], into: LiveDeliverer): () => void {
  LIVE.set(place, into);
  return () => {
    if (LIVE.get(place) === into) LIVE.delete(place);
  };
}

/** How a place takes a bell into a running turn, or null where none does. */
export function liveDeliverer(place: BoxOrigin["place"]): LiveDeliverer | null {
  return LIVE.get(place) ?? null;
}

/**
 * The origin off a run's `deliverTo`, or null when there is none, it is not
 * JSON, or it is not one of the known shapes. A run delegated before this
 * existed has no origin, and a bell about it is answered at the door.
 */
export function parseOrigin(deliverTo: string | undefined): BoxOrigin | null {
  if (!deliverTo) return null;
  try {
    return originOf(JSON.parse(deliverTo));
  } catch {
    return null;
  }
}

/**
 * The same shapes, read off a value that is already parsed: what a
 * session entry holds (src/soul/recover.ts). Null for anything else.
 */
export function originOf(value: unknown): BoxOrigin | null {
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
  if (o.place === "meals") return { place: "meals" };
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
  if (origin.place === "meals") return "the meals conversation";
  return `at the door, ${origin.date}`;
}
