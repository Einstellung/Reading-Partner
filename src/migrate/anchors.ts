// The three transforms every stored message anchor goes through, each one the
// answer to a defect that was measured on the owner's store rather than
// imagined.
//
// The anchor format itself is not reimplemented here: memory/observations/
// anchors.ts owns parsing, composing and resolution, and this file only decides
// which anchor is which case.

import {
  messageAnchor,
  parseMessageAnchor,
  resolveMessageAnchor,
} from "../memory/observations/anchors";
import { MESSAGE_ID } from "./hash";
import { holdersOfStamp, threadsWithId, type ThreadIndex } from "./threads";

export type AnchorOutcome =
  // Already in the shape this step produces.
  | { kind: "unchanged" }
  | { kind: "rewritten"; anchor: string; tie?: boolean }
  // The anchor names nothing and never did; it goes.
  | { kind: "dropped"; why: string }
  // Broken in a way this step does not treat: reported, never guessed at.
  | { kind: "refused"; why: string }
  // Broken, but the shape another step handles. Neither a change nor a refusal.
  | { kind: "other-step" };

// The pair half of an anchor, whichever form it is stored in.
function pairOf(anchor: string): { id?: string; threadId: string; ts: number } | null {
  const parsed = parseMessageAnchor(anchor);
  if (!parsed || parsed.threadId === undefined || parsed.ts === undefined) return null;
  return { ...(parsed.id ? { id: parsed.id } : {}), threadId: parsed.threadId, ts: parsed.ts };
}

function withThread(anchor: string, threadId: string): string {
  const pair = pairOf(anchor);
  if (!pair) return anchor;
  return messageAnchor({ ...(pair.id ? { id: pair.id } : {}), ts: pair.ts, threadId });
}

// --- step 1: an anchor that names the parent of the thread it lives in ---

// 71 anchors on the owner's store name the PARENT of the thread their message
// is actually in. transcript.ts documents the cause: the arrears sweep folds a
// lesson's pageless asides into one unit and used to print every line of it
// with the unit's own threadId, so every line that came from a folded aside
// named a pair that exists nowhere.
//
// The evidence required before rewriting: the named thread holds no message
// with that stamp, exactly one thread on the whole store does, and the named
// thread is that thread's parent. Anything short of that is refused — the
// stamp is the only handle, and a stamp two threads share cannot say which.
export function repairParentAnchor(anchor: string, index: ThreadIndex): AnchorOutcome {
  const pair = pairOf(anchor);
  if (!pair) return { kind: "unchanged" };
  if (holdersOfStamp(index, pair.threadId, pair.ts).length > 0) return { kind: "unchanged" };
  const holders = index.threadsByTs.get(pair.ts) ?? [];
  if (holders.length === 0) return { kind: "refused", why: "no thread holds that stamp" };
  if (holders.length > 1) {
    return { kind: "refused", why: `stamp is held by ${holders.length} threads` };
  }
  // One id, but an id can name several threads (threads.ts): the stamp has to
  // sit in exactly one of them or nothing decides which parent link to read.
  const owners = holdersOfStamp(index, holders[0], pair.ts);
  if (owners.length !== 1) {
    return { kind: "refused", why: `stamp is held by ${owners.length} threads sharing an id` };
  }
  if (owners[0].thread.parentThreadId !== pair.threadId) return { kind: "other-step" };
  return { kind: "rewritten", anchor: withThread(anchor, holders[0]) };
}

// --- step 2: a mistyped thread id, and one anchor that was invented ---

// Two anchors differ from a real thread id by two characters
// (…a34a7e59b5b0 for …a34a7e70b5b0) and their stamp resolves in that real
// thread. One anchor is `msg-user-位置编码相加`, which is not an anchor at all.
//
// Deliberately not generalised into fuzzy id matching. The near miss has to be
// the same length, differ in at most two positions, and its stamp has to be
// owned by exactly one thread — which is that thread. Everything else is
// reported unrepaired.
const MAX_TYPO_DISTANCE = 2;

function distance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

export function repairTypoAnchor(anchor: string, index: ThreadIndex): AnchorOutcome {
  const parsed = parseMessageAnchor(anchor);
  if (!parsed) return { kind: "dropped", why: "not an anchor" };
  const pair = pairOf(anchor);
  if (!pair) {
    // No pair at all: an id, and the only ids that exist are the ones
    // platform/app/threads.ts mints. Anything else was written by a model
    // copying a string it made up.
    if (parsed.id !== undefined && !MESSAGE_ID.test(parsed.id)) {
      return { kind: "dropped", why: "not a message id and not a pair" };
    }
    return { kind: "unchanged" };
  }
  const named = threadsWithId(index, pair.threadId);
  if (holdersOfStamp(index, pair.threadId, pair.ts).length > 0) return { kind: "unchanged" };
  if (named.length > 0) {
    return { kind: "refused", why: "thread exists but holds no message with that stamp" };
  }
  const holders = index.threadsByTs.get(pair.ts) ?? [];
  if (holders.length !== 1) {
    return { kind: "refused", why: `stamp is held by ${holders.length} threads` };
  }
  const gap = distance(pair.threadId, holders[0]);
  if (gap === 0 || gap > MAX_TYPO_DISTANCE) {
    return { kind: "refused", why: `named thread is unknown and not a near miss (distance ${gap})` };
  }
  return { kind: "rewritten", anchor: withThread(anchor, holders[0]) };
}

// --- step 4: the legacy pair becomes the composite form ---

// After the backfill every message has an id, so `<threadId>:<ts>` can become
// `<messageId>@<threadId>:<ts>`. Where the pair still names two messages it is
// resolved the way resolveMessageAnchor resolves it — the user turn — and the
// caller counts those, because that count is the precision that was
// permanently lost before ids existed.
export function composeAnchor(anchor: string, index: ThreadIndex): AnchorOutcome {
  const parsed = parseMessageAnchor(anchor);
  if (!parsed) return { kind: "unchanged" };
  if (parsed.id !== undefined) return { kind: "unchanged" };
  const pair = pairOf(anchor);
  if (!pair) return { kind: "unchanged" };
  if (threadsWithId(index, pair.threadId).length === 0) {
    return { kind: "refused", why: "no such thread" };
  }
  const owners = holdersOfStamp(index, pair.threadId, pair.ts);
  if (owners.length === 0) {
    return { kind: "refused", why: "thread holds no message with that stamp" };
  }
  if (owners.length > 1) {
    return { kind: "refused", why: `stamp is held by ${owners.length} threads sharing an id` };
  }
  const hits = owners[0].thread.messages.filter((m) => m.ts === pair.ts);
  const message = resolveMessageAnchor(
    anchor,
    owners[0].thread.messages.map((m) => ({ id: m.id, role: m.role as "user" | "ai", ts: m.ts })),
    pair.threadId,
  );
  if (!message) return { kind: "refused", why: "unresolvable against its own thread" };
  if (!message.id) return { kind: "refused", why: "message has no id; run the backfill first" };
  return {
    kind: "rewritten",
    anchor: messageAnchor({ id: message.id, ts: message.ts, threadId: pair.threadId }),
    tie: hits.length > 1,
  };
}

// The three in order, for anchors that only surface midway through the run:
// step 5 pulls anchors out of leaked tool-call XML into the frontmatter, and an
// anchor recovered there has never been through steps 1, 2 and 4. Normalising
// it on the spot is what keeps one pass a fixed point — otherwise the next run
// would find work to do and "running it twice is a no-op" would be false.
export function normalizeAnchor(anchor: string, index: ThreadIndex): string | null {
  let current = anchor;
  for (const repair of [repairParentAnchor, repairTypoAnchor, composeAnchor]) {
    const outcome = repair(current, index);
    if (outcome.kind === "rewritten") current = outcome.anchor;
    else if (outcome.kind === "dropped") return null;
  }
  return current;
}
