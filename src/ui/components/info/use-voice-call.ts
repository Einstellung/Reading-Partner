// The orb's half of the voice call (docs/45, docs/33 M-voice-3). Everything
// that decides anything is in info/companion/voice-call.ts and is tested
// without React; what is left here is a component's lifetime around it — build
// the call on the first start, tear it down on unmount, and turn two of its
// three streams into state.
//
// The third stays a callback. A level event arrives many times a second and the
// orb draws it on an animation frame (docs/45), so it never becomes state:
// `subscribeLevel` is stable across calls, and the orb keeps its subscription
// through a start and a stop.

import { useCallback, useEffect, useRef, useState } from "react";
import { createLiveVoiceCall, NO_VOICE_CALL } from "../../../info/companion/voice-call-live";
import type { BriefingControl } from "../../../info/companion/companion-live";
import type { SessionPhase } from "../../../info/companion/voice-session";
import type { VoiceCall, VoiceCallError, VoiceCallView } from "../../../info/companion/voice-call";

export interface VoiceCallOptions {
  /** The day whose briefing and thread the call is about. */
  dateKey: string;
  /** What generate_briefing does; see LiveVoiceCallOptions. */
  briefing?: BriefingControl;
}

export type { VoiceCallView };

export function useVoiceCall(opts: VoiceCallOptions): VoiceCallView {
  const { dateKey, briefing } = opts;
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [error, setError] = useState<VoiceCallError | null>(null);
  const callRef = useRef<VoiceCall | null>(null);
  const unsubsRef = useRef<(() => void)[]>([]);
  // Whether a start is already on its way, so a double tap does not build two
  // calls onto one microphone.
  const startingRef = useRef(false);
  const levelCbs = useRef(new Set<(level: number) => void>());
  // The latest options, read at start time: a call is started from a gesture,
  // not from a render, and rebuilding the callbacks per render would churn the
  // orb's props for no reason.
  const optsRef = useRef({ dateKey, briefing });
  optsRef.current = { dateKey, briefing };

  const subscribeLevel = useCallback((cb: (level: number) => void) => {
    levelCbs.current.add(cb);
    return () => {
      levelCbs.current.delete(cb);
    };
  }, []);

  const drop = useCallback(() => {
    for (const off of unsubsRef.current) off();
    unsubsRef.current = [];
    const call = callRef.current;
    callRef.current = null;
    return call;
  }, []);

  const start = useCallback(() => {
    if (callRef.current || startingRef.current) return;
    startingRef.current = true;
    void (async () => {
      try {
        const call = await createLiveVoiceCall(optsRef.current);
        if (!call) {
          setError({ reason: "start-failed", message: NO_VOICE_CALL });
          return;
        }
        callRef.current = call;
        unsubsRef.current = [
          call.subscribePhase(setPhase),
          call.subscribeError(setError),
          call.subscribeLevel((v) => {
            for (const cb of levelCbs.current) cb(v);
          }),
        ];
        await call.start();
      } catch (e) {
        drop();
        setError({
          reason: "start-failed",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        startingRef.current = false;
      }
    })();
  }, [drop]);

  const stop = useCallback(() => {
    const call = drop();
    setPhase("idle");
    void call?.stop().catch(() => {});
  }, [drop]);

  // The call is the orb's, and the orb going away ends it. Foreground-only v1:
  // nothing survives the component (docs/33 "分期").
  useEffect(() => {
    return () => {
      const call = drop();
      void call?.stop().catch(() => {});
    };
  }, [drop]);

  return { phase, error, start, stop, subscribeLevel };
}
