// The update run a confirm card asked (docs/info/91 更新), as the card shows
// it. A run this device executes is announced by the runner; one the desktop
// collector executes arrives by sync and is not, so the card also looks again
// every little while until the run is over.

import { useEffect, useState } from "react";

import type { Run } from "../../../legion/run/types";
import { appRunner } from "../../../legion/runner/runner";
import { TOPIC_SEARCH_KIND } from "../../../info/topic-search/run";

const LOOK_MS = 20_000;
const over = (run: Run | null) => run !== null && (run.state === "done" || run.state === "failed" || run.state === "cancelled");

export function useStudyRun(runId: string | null): Run | null {
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    if (!runId) return;
    let live = true;
    const runner = appRunner();
    let timer: ReturnType<typeof setInterval> | undefined;
    const look = () =>
      runner
        .list({ kind: TOPIC_SEARCH_KIND })
        .then((runs) => {
          if (!live) return;
          const found = runs.find((r) => r.id === runId) ?? null;
          setRun(found);
          if (over(found) && timer) clearInterval(timer);
        })
        .catch(() => {});
    void look();
    const unsubscribe = runner.subscribe(() => void look());
    timer = setInterval(() => void look(), LOOK_MS);
    return () => {
      live = false;
      unsubscribe();
      if (timer) clearInterval(timer);
    };
  }, [runId]);
  return run;
}
