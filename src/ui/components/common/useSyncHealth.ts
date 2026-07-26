// Subscribes to sync status and turns it into what the user should be told
// (platform/sync/health decides; this only feeds it a clock).
//
// Re-evaluated on a timer as well as on status changes, because the failures
// worth reporting are the ones that emit nothing: an engine that never started
// fires no status, and an engine that has quietly stopped ticking fires no
// status either. Waiting for a change event would mean never noticing.

import { useEffect, useRef, useState } from "react";
import {
  subscribeSyncStatus,
  syncHealth,
  type SyncHealthReport,
  type SyncStatus,
} from "../../../platform/sync";

// Far below the staleness threshold, and cheap: one pure call over a handful of
// fields.
const RECHECK_MS = 5 * 60_000;

const UNKNOWN: SyncHealthReport = { health: "unknown", alert: "none", message: null };

export function useSyncHealth(): SyncHealthReport {
  const [report, setReport] = useState<SyncHealthReport>(UNKNOWN);
  const statusRef = useRef<SyncStatus | null>(null);

  useEffect(() => {
    // Keep the object identity stable while the verdict is unchanged, so the
    // toast effect downstream does not re-run on every engine tick.
    const evaluate = () => {
      const status = statusRef.current;
      if (!status) return;
      const next = syncHealth({ ...status, now: Date.now() });
      setReport((prev) =>
        prev.health === next.health && prev.message === next.message ? prev : next,
      );
    };
    const unsubscribe = subscribeSyncStatus((s) => {
      statusRef.current = s;
      evaluate();
    });
    const timer = setInterval(evaluate, RECHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return report;
}
