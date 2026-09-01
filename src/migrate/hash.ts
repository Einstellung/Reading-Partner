// The one thing every id this migration mints has in common: it is DERIVED,
// never random.
//
// Two devices run this migration independently over the same synced files. A
// randomly minted message id would differ between them, and an observation
// anchored on one device's id would dangle on the other; a randomly minted
// observation id would fork the store into two entries for one observation.
// Deriving from the old identity makes both devices produce the same bytes, and
// makes the whole thing resumable: a run that dies halfway can recompute the
// map from either side, because the map is a function and not a record.
//
// FNV-1a over the UTF-8 bytes, 64 bits, printed as 16 hex characters — the
// shape platform/app/threads.ts already mints message ids in. Not a
// cryptographic hash: nothing here is adversarial, the inputs number in the
// hundreds, and the steps that use it verify collision-freeness over the actual
// data before they rely on it rather than trusting the arithmetic.

const OFFSET = 14695981039346656037n;
const PRIME = 1099511628211n;
const MASK = (1n << 64n) - 1n;

export function hash16(text: string): string {
  let h = OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    h = ((h ^ BigInt(byte)) * PRIME) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}

// A message's id, derived from the identity it had before ids existed.
//
// The role is folded in because "<threadId>:<ts>" is not unique: a user turn
// and the reply it triggered are appended in the same millisecond, and 153 pair
// keys on the owner's store name two messages that way. Thread, stamp and role
// together name exactly one message on that store — verified by the step before
// it writes anything, and by a test over a fixture built from that shape.
export function deriveMessageId(threadId: string, ts: number, role: string): string {
  return `t-${hash16(`${threadId}:${ts}:${role}`)}`;
}

// An observation's widened id, derived from its narrow one. The prefix in the
// hashed string keeps this namespace apart from the message one, so the same
// eight characters appearing as both cannot produce related ids.
export function deriveObservationId(oldId: string): string {
  return `m-${hash16(`observation:${oldId}`)}`;
}

// Ids this migration has already produced, so a second run recognises its own
// work rather than migrating it again.
export const NARROW_OBSERVATION_ID = /^m-[0-9a-f]{8}$/;
export const MESSAGE_ID = /^t-[0-9a-f]{16}$/;
