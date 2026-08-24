// A flag `tests/support/preload.ts` raises when bun actually preloads it, read
// back by `tests/preload-gate.test.ts`.
//
// It lives in its own module because the preload cannot carry its own evidence:
// a test that imported `preload.ts` to read a flag would load and run it, and
// the flag would be true whether or not bun preloaded anything. This file runs
// no hook and touches nothing, so importing it proves only that it was
// imported; `preloaded` stays false unless something called markPreloaded().

let preloaded = false;

export function markPreloaded(): void {
  preloaded = true;
}

export function preloadRan(): boolean {
  return preloaded;
}
