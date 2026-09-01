// The message anchor: how an observation points back at the conversation turn
// it came from, in both of the forms that exist on disk.
//
// New anchors are the message's own id (`t-<16hex>`, minted by
// platform/app/threads.ts when a message is appended). Everything written
// before that is the pair "<threadId>:<ts>", and it is not going away: 459 of
// them sit on the owner's store, and nothing rewrites a stored observation
// behind the reader's back. So both forms have to resolve, forever.
//
// Why the id had to exist: 155 of those 459 legacy anchors (34%) name TWO
// messages, because a user turn and the reply to it are appended in the same
// millisecond and carry the same ts. Which turn the observation was actually
// about is unrecoverable for those.

// What resolution needs of a message. Structural rather than imported from
// platform/app/threads, so this stays usable over a distillation transcript's
// narrowed rows as well as over the stored records.
export interface AnchoredMessage {
  // Absent on every message written before ids existed.
  id?: string;
  role: "user" | "ai";
  ts: number;
  // The thread the message is stored in, which the legacy form is half made of.
  // Absent where the caller passes the thread id alongside instead.
  threadId?: string;
}

// The anchor to store for a message. The id when it has one; the legacy pair
// otherwise, so a conversation held on disk since before ids can still be cited
// by a distillation pass running today.
export function messageAnchor(
  message: Pick<AnchoredMessage, "id" | "ts" | "threadId">,
  fallbackThreadId: string,
): string {
  return message.id ?? `${message.threadId ?? fallbackThreadId}:${message.ts}`;
}

export type ParsedAnchor =
  | { kind: "id"; id: string }
  | { kind: "legacy"; threadId: string; ts: number };

// Which of the two forms an anchor is. Split at the LAST colon: a message id
// never holds one, and a thread id that somehow did would still leave the ts
// where it belongs.
export function parseMessageAnchor(anchor: string): ParsedAnchor | null {
  const trimmed = anchor.trim();
  if (!trimmed) return null;
  const at = trimmed.lastIndexOf(":");
  if (at < 0) return { kind: "id", id: trimmed };
  const threadId = trimmed.slice(0, at);
  const stamp = trimmed.slice(at + 1);
  // Number("") is 0, so the empty tail has to be refused by hand or
  // "thread-1:" would resolve against a message stamped 0.
  const ts = Number(stamp);
  if (!threadId || !stamp || !Number.isFinite(ts)) return null;
  return { kind: "legacy", threadId, ts };
}

// Whether an anchor names this message, in either form.
export function anchorNames(
  anchor: string,
  message: AnchoredMessage,
  fallbackThreadId?: string,
): boolean {
  const parsed = parseMessageAnchor(anchor);
  if (!parsed) return false;
  if (parsed.kind === "id") return message.id !== undefined && parsed.id === message.id;
  return parsed.threadId === (message.threadId ?? fallbackThreadId) && parsed.ts === message.ts;
}

// Every anchor string that names this message — its id when it has one, and the
// legacy pair either way. What a caller holding a message looks an index up
// with, so an observation written before ids and one written after are both
// found.
export function messageAnchorKeys(
  message: AnchoredMessage,
  fallbackThreadId?: string,
): string[] {
  const threadId = message.threadId ?? fallbackThreadId;
  const keys: string[] = [];
  if (message.id) keys.push(message.id);
  if (threadId) keys.push(`${threadId}:${message.ts}`);
  return keys;
}

// The message an anchor names, or undefined.
//
// The legacy form can name two, and then the user turn wins. That is what a
// linear scan of the array already gives — the reader's message is appended
// before the reply it triggered — and it is the better default on its own
// terms: an observation is almost always about something the reader said, so a
// tie broken towards the AI's reply would attribute the reader's own words to
// us. Made explicit here rather than left to the array order, because the array
// is not the only thing that ever gets passed in.
export function resolveMessageAnchor<T extends AnchoredMessage>(
  anchor: string,
  messages: readonly T[],
  fallbackThreadId?: string,
): T | undefined {
  let first: T | undefined;
  for (const message of messages) {
    if (!anchorNames(anchor, message, fallbackThreadId)) continue;
    if (message.role === "user") return message;
    first ??= message;
  }
  return first;
}
