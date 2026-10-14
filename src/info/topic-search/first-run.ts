// Where an applied topic search hands off its first run (docs/info/88 两种 run).
//
// The run itself is phase 3: a legion run of kind "topic-search" with
// idempotencyKey `topic-search:<id>:first`, claimed by the desktop collector.
// Until that lands nothing is registered here, so Apply writes the config and
// the concern and the first run is simply not dispatched yet. Phase 3
// registers the dispatcher at startup; nothing else changes on this side.

import type { TopicSearch } from "./types";

type Dispatcher = (search: TopicSearch) => Promise<void>;

let dispatcher: Dispatcher | null = null;

/** Phase 3 registers the real dispatch here. Returns the unregister. */
export function registerFirstRunDispatcher(fn: Dispatcher): () => void {
  dispatcher = fn;
  return () => {
    if (dispatcher === fn) dispatcher = null;
  };
}

/** Hand a newly applied search its first run. A no-op until a dispatcher is registered. */
export async function dispatchFirstRun(search: TopicSearch): Promise<void> {
  if (dispatcher) await dispatcher(search);
}
