// Getting hold of the readable extractor without paying for it at boot.
//
// readable.ts is the only module that touches Readability and defuddle, and
// those two are ~355 kB minified. Every static import of it put them in the
// chunk both shells load before they draw anything, for a capability that only
// runs when the collector turns a fetched page into an article. The dynamic
// import here is what gives rollup a chunk key to hang them on, so they arrive
// on first extraction instead. Nothing else may import readable.ts statically —
// one static edge anywhere folds the chunk back into its importer, which is
// what tests/info/readable-lazy.test.ts watches for.
//
// The extractor's own contract is untouched: ExtractReadable stays synchronous,
// because the engine calls it in the middle of building an item. Only acquiring
// it is async, and every wiring site resolves it before it hands the engine or
// the tools their deps.

import type { ExtractReadable } from "./readable-select";

// Run `load` at most once and hand every caller the same promise — except when
// it rejects, which drops the cache so the next call tries again. A chunk that
// did not arrive (an offline web build, a half-written update) must not leave
// every later extraction holding the same rejected promise.
export function cacheUntilFailure<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = load().catch((e: unknown) => {
        pending = null;
        throw e;
      });
    }
    return pending;
  };
}

// The readable extractor, fetching its chunk on the first call.
export const loadExtractReadable: () => Promise<ExtractReadable> = cacheUntilFailure(() =>
  import("./readable").then((m) => m.extractReadable),
);
