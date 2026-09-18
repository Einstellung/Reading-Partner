// The way from a dispatch ticket down to the answer it was waiting for
// (docs/72).
//
// A ticket is drawn from the row that sent the work off and knows only its run
// id; whether the answer has landed in this same thread is a fact about the
// whole list, which is what MessageList has and a row does not. So the list
// publishes it: which runs have been answered here, and how to take the reader
// to one.

import { createContext, useContext } from "react";
import type { ThreadMessage } from "./types";

export interface DeliveredRuns {
  /** Whether this thread holds the reply to that run. */
  has(runId: string): boolean;
  /** Take the reader to it. */
  scrollTo(runId: string): void;
}

export const DeliveredRunsContext = createContext<DeliveredRuns | null>(null);

/** Null in any chat whose host did not publish one; a ticket then draws no way back. */
export function useDeliveredRuns(): DeliveredRuns | null {
  return useContext(DeliveredRunsContext);
}

/** Which handed-off runs this thread carries the answer to. */
export function deliveredRunIds(messages: readonly ThreadMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) if (m.origin) ids.add(m.origin.runId);
  return ids;
}
