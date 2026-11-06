// The confirmation card's state (docs/platform/687 确认). The card carries a
// pending record's id, and the record on disk is the whole truth of whether the
// write still waits: confirming carries the write on from the re-read, declining
// deletes the record. The card calls the housekeeper itself rather than raising
// an op to its host, so a card shows the same in every conversation it lands
// in, a delivered run's included.

import { useCallback, useEffect, useState } from "react";
import {
  confirmPending,
  declinePending,
  liveWriteDeps,
  pendingWaits,
  type WriteDeps,
  type WriteOutcome,
} from "../../../housekeeper/write";

export type ConfirmPhase = "checking" | "open" | "working" | "applied" | "declined" | "stale" | "gone" | "failed";

export interface ConfirmState {
  phase: ConfirmPhase;
  reason?: string;
}

/** The question line (and the buttons under it) belong to the card while it
 * waits on the reader; once settled the card keeps only what changed and the result. */
export function showsQuestion(phase: ConfirmPhase): boolean {
  return phase === "checking" || phase === "open" || phase === "working";
}

/** What the card says once the reader confirmed. */
export function stateAfterConfirm(outcome: WriteOutcome | { status: "gone" }): ConfirmState {
  switch (outcome.status) {
    case "written":
      return { phase: "applied" };
    case "stale":
      return { phase: "stale" };
    case "gone":
      return { phase: "gone" };
    case "failed":
      return { phase: "failed", reason: outcome.reason };
    default:
      return { phase: "failed", reason: outcome.status };
  }
}

export interface ConfirmControl extends ConfirmState {
  confirm(): void;
  decline(): void;
}

export function useHousekeeperConfirm(pendingId: string, deps: WriteDeps = liveWriteDeps()): ConfirmControl {
  const [state, setState] = useState<ConfirmState>({ phase: "checking" });
  useEffect(() => {
    let live = true;
    void pendingWaits(pendingId, deps).then(
      (waits) => live && setState((s) => (s.phase === "checking" ? { phase: waits ? "open" : "gone" } : s)),
      () => live && setState({ phase: "gone" }),
    );
    return () => {
      live = false;
    };
    // deps is the live set unless a test hands one in; it never changes under a card.
  }, [pendingId]);
  const confirm = useCallback(() => {
    setState({ phase: "working" });
    void confirmPending(pendingId, deps).then(
      (outcome) => setState(stateAfterConfirm(outcome)),
      (e: unknown) => setState({ phase: "failed", reason: e instanceof Error ? e.message : String(e) }),
    );
  }, [pendingId]);
  const decline = useCallback(() => {
    setState({ phase: "working" });
    void declinePending(pendingId, deps).then(
      () => setState({ phase: "declined" }),
      (e: unknown) => setState({ phase: "failed", reason: e instanceof Error ? e.message : String(e) }),
    );
  }, [pendingId]);
  return { ...state, confirm, decline };
}
