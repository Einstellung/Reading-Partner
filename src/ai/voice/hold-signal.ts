// Whether a finger is down on the hold-to-talk bar.
//
// The bar is deep inside the composer and the thing that has to get out of its
// way — Lumen in the corner (docs/68) — is a sibling of the whole chat, so this
// is a signal rather than six props of plumbing. One press at a time: there is
// one microphone and one composer holding it.

let holding = false;
const listeners = new Set<() => void>();

export function setHolding(on: boolean): void {
  if (holding === on) return;
  holding = on;
  for (const listener of [...listeners]) listener();
}

export function isHolding(): boolean {
  return holding;
}

/** Hear about the next press or release. Returns the undo. */
export function subscribeHolding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
