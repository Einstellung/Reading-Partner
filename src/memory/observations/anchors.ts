// The message anchor: how an observation points back at the conversation turn
// it came from, in every form that exists on disk.
//
// Three forms, and all three have to resolve forever:
//
//   t-<16hex>@<threadId>:<ts>   what is written now — the message's own id
//                               (platform/app/threads.ts) and, after it, the
//                               pair that was the anchor before ids existed
//   <threadId>:<ts>             everything written before ids. 292 of these sit
//                               on the owner's store, and nothing rewrites a
//                               stored observation behind the reader's back
//   t-<16hex>                   the id alone, for a message whose thread is not
//                               in scope where the anchor is written
//
// Why the id had to exist: 143 of those 292 legacy anchors (49%) name TWO
// messages, because a user turn and the reply to it are appended in the same
// millisecond and carry the same ts. Which turn the observation was actually
// about is unrecoverable for those.
//
// Why the pair is kept beside the id rather than replaced by it: an id can go
// missing from a message that survives. threads-<bookId>.json merges with the
// records strategy, and a thread record is ATOMIC there
// (platform/sync/merge/records.ts) — two devices that both edited one thread
// get one whole version of it and the loser's messages go to the journal with
// it. A device that has not run the id backfill can be the winner, and the
// message then comes back without the id an anchor names. Measured over the
// real mergeFile rather than reasoned: both outcomes reproduce, decided by the
// content alone. The pair rides along so that case degrades to today's
// precision instead of dangling.

// What resolution needs of a message. Structural rather than imported from
// platform/app/threads, so this stays usable over a distillation transcript's
// narrowed rows as well as over the stored records.
export interface AnchoredMessage {
  // Absent on every message written before ids existed.
  id?: string;
  role: "user" | "ai";
  ts: number;
  // The thread the message is stored in, which the pair is half made of.
  // Absent where the caller passes the thread id alongside instead.
  threadId?: string;
}

// The two halves are joined by "@": a message id is `t-` and hex, a thread id
// is a UUID, a ts is digits, and none of the three can hold one.
const JOIN = "@";

// The anchor to store for a message: both halves whenever both are known.
export function messageAnchor(
  message: Pick<AnchoredMessage, "id" | "ts" | "threadId">,
  fallbackThreadId?: string,
): string {
  const threadId = message.threadId ?? fallbackThreadId;
  const pair = threadId ? `${threadId}:${message.ts}` : "";
  if (message.id && pair) return `${message.id}${JOIN}${pair}`;
  return message.id ?? pair;
}

// An anchor taken apart. The halves are optional and independent: an anchor
// carries the id, the pair, or both.
export interface ParsedAnchor {
  id?: string;
  threadId?: string;
  ts?: number;
}

function parsePair(text: string): { threadId: string; ts: number } | null {
  // Split at the LAST colon, so a thread id that somehow held one would still
  // leave the ts where it belongs.
  const at = text.lastIndexOf(":");
  if (at < 0) return null;
  const threadId = text.slice(0, at);
  const stamp = text.slice(at + 1);
  // Number("") is 0, so the empty tail has to be refused by hand or
  // "thread-1:" would resolve against a message stamped 0.
  const ts = Number(stamp);
  if (!threadId || !stamp || !Number.isFinite(ts)) return null;
  return { threadId, ts };
}

// Which halves an anchor carries. Null when it carries neither — an empty
// string, or a composite whose two halves are both unusable.
export function parseMessageAnchor(anchor: string): ParsedAnchor | null {
  const trimmed = anchor.trim();
  if (!trimmed) return null;
  const join = trimmed.indexOf(JOIN);
  if (join >= 0) {
    const id = trimmed.slice(0, join);
    const pair = parsePair(trimmed.slice(join + 1));
    if (!id) return pair ? { ...pair } : null;
    return pair ? { id, ...pair } : { id };
  }
  // A colon means it was meant as a pair, so a malformed one is nothing — an id
  // never holds one, and reading "thread-1:" as an id would put a corpse in the
  // index under a name no message can ever have.
  if (trimmed.includes(":")) {
    const pair = parsePair(trimmed);
    return pair ? { ...pair } : null;
  }
  return { id: trimmed };
}

// Whether an anchor can name this message.
//
// The rule, and the one case it deliberately does not treat as a mismatch:
//
//   both carry an id and the ids match     -> yes
//   either lacks an id, or the ids differ  -> the pair decides
//   neither half decides                   -> no
//
// Two ids that differ falls back rather than failing, because the backfill runs
// per device: two devices migrating the same message independently would mint
// two ids for it, and the anchor's id then names a message that is the same
// turn under another name. (The migration derives its ids from a hash of the
// old identity so that this cannot happen; this is the belt beside those
// braces.) The pair was written from the same message at the same moment as the
// id, so it still names the right turn — it only gives back the user/ai
// precision, which is exactly the precision everything written before ids has.
//
// What must never fall back is a mismatch that could mean two genuinely
// different turns, and the pair is what rules that out: another turn of that
// thread has another ts, or is the other role at the same ts, and
// resolveMessageAnchor settles that one on the id before the pair is reached.
//
// This is the loose test — "could this anchor name this message". It can answer
// yes for both of two messages sharing a ts; resolveMessageAnchor picks between
// them.
export function anchorNames(
  anchor: string,
  message: AnchoredMessage,
  fallbackThreadId?: string,
): boolean {
  const parsed = parseMessageAnchor(anchor);
  if (!parsed) return false;
  if (parsed.id !== undefined && message.id !== undefined && parsed.id === message.id) return true;
  if (parsed.threadId === undefined || parsed.ts === undefined) return false;
  return parsed.threadId === (message.threadId ?? fallbackThreadId) && parsed.ts === message.ts;
}

// Every anchor string that names this message — the composite it would be
// written as today, and each half on its own. What a caller holding a message
// looks an index up with, so an observation written before ids and one written
// since are both found.
export function messageAnchorKeys(
  message: AnchoredMessage,
  fallbackThreadId?: string,
): string[] {
  const threadId = message.threadId ?? fallbackThreadId;
  const keys: string[] = [];
  if (message.id && threadId) keys.push(`${message.id}${JOIN}${threadId}:${message.ts}`);
  if (message.id) keys.push(message.id);
  if (threadId) keys.push(`${threadId}:${message.ts}`);
  return keys;
}

// The message an anchor names, or undefined.
//
// The id goes first and alone: it names exactly one turn, and letting the pair
// run first would hand back the user turn for an anchor that says plainly it is
// about the reply.
//
// The pair is the fallback, and there the user turn wins a two-hit. That is
// what a linear scan of the array already gives — the reader's message is
// appended before the reply it triggered — and it is the better default on its
// own terms: an observation is almost always about something the reader said,
// so a tie broken towards the AI's reply would attribute the reader's own words
// to us. Made explicit here rather than left to the array order, because the
// array is not the only thing that ever gets passed in.
export function resolveMessageAnchor<T extends AnchoredMessage>(
  anchor: string,
  messages: readonly T[],
  fallbackThreadId?: string,
): T | undefined {
  const parsed = parseMessageAnchor(anchor);
  if (!parsed) return undefined;
  if (parsed.id !== undefined) {
    const exact = messages.find((m) => m.id !== undefined && m.id === parsed.id);
    if (exact) return exact;
  }
  if (parsed.threadId === undefined || parsed.ts === undefined) return undefined;
  let first: T | undefined;
  for (const message of messages) {
    if (parsed.threadId !== (message.threadId ?? fallbackThreadId)) continue;
    if (parsed.ts !== message.ts) continue;
    if (message.role === "user") return message;
    first ??= message;
  }
  return first;
}
