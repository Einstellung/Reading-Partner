// The activity stream turned into a prop. All the deciding is attention.ts's;
// what is here is the part that needs a component's lifetime — one subscription
// and one timer, because the glance ends on a clock rather than on an event.

import { useEffect, useRef, useState } from "react";

import type { TurnActivity } from "../../../ai/activity";
import {
  applyActivity,
  attentionEndsAt,
  attentionFrom,
  noActivity,
  type LumenActivity,
} from "./attention";
import type { Attention } from "./lumen-motion";

/**
 * Where the body should be looking, following the turns of one call.
 * `subscribe` has to be stable across a start and a stop the way the level
 * subscription is: the eyes are not re-subscribed per render.
 */
export function useAttention(
  subscribe: (cb: (event: TurnActivity) => void) => () => void,
): Attention {
  const [attention, setAttention] = useState<Attention>("reader");
  const stateRef = useRef<LumenActivity>(noActivity());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = (): void => {
      if (timerRef.current === null) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // Read the answer, then book the moment it would change by itself.
    const settle = (): void => {
      const now = Date.now();
      setAttention(attentionFrom(stateRef.current, now));
      clear();
      const at = attentionEndsAt(stateRef.current, now);
      if (at !== null) timerRef.current = setTimeout(settle, Math.max(0, at - now));
    };
    const off = subscribe((event) => {
      stateRef.current = applyActivity(stateRef.current, event, Date.now());
      settle();
    });
    return () => {
      off();
      clear();
    };
  }, [subscribe]);

  return attention;
}
