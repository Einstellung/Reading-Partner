// The orb's half of the voice call (docs/45, docs/33 M-voice-3). Everything
// that decides anything is in soul/voice/voice-call.ts and is tested
// without React; what is left here is a component's lifetime around it — build
// the call on the first start, tear it down on unmount, and turn two of its
// three streams into state.
//
// The third stays a callback. A level event arrives many times a second and the
// orb draws it on an animation frame (docs/45), so it never becomes state:
// `subscribeLevel` is stable across calls, and the orb keeps its subscription
// through a start and a stop.

import { useCallback, useEffect, useRef, useState } from "react";
import { createLiveVoiceCall } from "../../../info/briefer/voice-call-live";
import { doorDate } from "../../../soul";
import type { FrontCard } from "../../../soul/voice/front/cascade";
import { NO_VOICE_CALL, type LiveCallHooks } from "../../../soul/voice/live/call";
import { createDoorVoiceCall } from "../../../soul/voice/live/door-call";
import type { SessionPhase } from "../../../soul/voice/voice-session";
import { registerVoiceCallHost } from "../../../soul/voice/harness/trace";
import type { VoiceCall, VoiceCallError, VoiceCallView } from "../../../soul/voice/voice-call";
import type { SpeechEnvelope } from "../../../soul/voice/conversation";
import type { VoiceCallHandle } from "../orb/orb";
import type { TurnActivity } from "../../../ai/turn-view/activity";
import { attentionWithScan, backgroundScan } from "./background-scan";
import { issueCallMaterial } from "./issue-call";
import { useAttention } from "./use-attention";
import type { Attention } from "./lumen-motion";
import { voiceCallMode, type VoiceCallMode } from "./voice-call-mode";
import type { VoiceContext } from "./voice-context";

export interface VoiceCallOptions {
  /**
   * What the screen behind the corner published to talk about, or null where
   * it published nothing; then the call is held at the door (voice-call-mode.ts).
   */
  context: VoiceContext | null;
  /** Whether the reader has a book open behind the corner: the door call's front is told so. */
  inReader?: boolean;
}

function createModeCall(mode: VoiceCallMode, hooks: LiveCallHooks): Promise<VoiceCall | null> {
  return mode.kind === "briefing"
    ? createLiveVoiceCall({ dateKey: mode.dateKey, briefing: mode.briefing, ...hooks })
    : // With a brief open in the reader, the call is about it (issue-call.ts).
      createDoorVoiceCall({ date: mode.date, inReader: mode.inReader, material: issueCallMaterial(), ...hooks });
}

export type { VoiceCallView };

/**
 * What the view is plus where the body is looking. `attention` is not on
 * VoiceCallView because the call is a domain and the word belongs to the
 * component that draws it (ui/components/lumen).
 */
export interface VoiceCallState extends VoiceCallView {
  attention: Attention;
  /** A result the reader asked to see during the call (docs/companion/136 show). */
  card: FrontCard | null;
  dismissCard: () => void;
}

export function useVoiceCall(opts: VoiceCallOptions): VoiceCallState {
  const { context, inReader = false } = opts;
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [error, setError] = useState<VoiceCallError | null>(null);
  const [card, setCard] = useState<FrontCard | null>(null);
  const [running, setRunning] = useState(0);
  const dismissCard = useCallback(() => setCard(null), []);
  const callRef = useRef<VoiceCall | null>(null);
  const unsubsRef = useRef<(() => void)[]>([]);
  // Whether a start is already on its way, so a double tap does not build two
  // calls onto one microphone.
  const startingRef = useRef(false);
  const levelCbs = useRef(new Set<(level: number) => void>());
  // Same shape as the level subscription and for the same reason: the body
  // keeps one subscription across a start and a stop.
  const activityCbs = useRef(new Set<(event: TurnActivity) => void>());
  // The envelope is the level's twin: a handful of events per answer rather
  // than many per second, but read on the same animation frame and for the same
  // reason kept out of state.
  const envelopeCbs = useRef(new Set<(envelope: SpeechEnvelope | null) => void>());
  // The latest options, read at start time: a call is started from a gesture,
  // not from a render, and rebuilding the callbacks per render would churn the
  // orb's props for no reason.
  const optsRef = useRef({ context, inReader });
  optsRef.current = { context, inReader };

  const subscribeLevel = useCallback((cb: (level: number) => void) => {
    levelCbs.current.add(cb);
    return () => {
      levelCbs.current.delete(cb);
    };
  }, []);

  const subscribeActivity = useCallback((cb: (event: TurnActivity) => void) => {
    activityCbs.current.add(cb);
    return () => {
      activityCbs.current.delete(cb);
    };
  }, []);

  const toolAttention = useAttention(subscribeActivity);
  // A run in flight while the call waits on the reader: the eyes go to the desk.
  const attention = attentionWithScan(toolAttention, backgroundScan(running, phase));

  const subscribeEnvelope = useCallback((cb: (envelope: SpeechEnvelope | null) => void) => {
    envelopeCbs.current.add(cb);
    return () => {
      envelopeCbs.current.delete(cb);
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
    // A new attempt starts with a clean line: the sentence a failed or lost call
    // left above the body is about that call, and the corner is on every screen
    // now, so it would otherwise stay up until the next failure replaced it.
    setError(null);
    void (async () => {
      try {
        // The day at the door is the day the call starts on, and stays that day.
        const mode = voiceCallMode(optsRef.current.context, { date: doorDate(), inReader: optsRef.current.inReader });
        const call = await createModeCall(mode, { onShow: setCard, onRunning: setRunning });
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
          call.subscribeActivity((e) => {
            for (const cb of activityCbs.current) cb(e);
          }),
          call.subscribeEnvelope((e) => {
            for (const cb of envelopeCbs.current) cb(e);
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
    setRunning(0);
    setError(null);
    void call?.stop().catch(() => {});
  }, [drop]);

  // The call is the orb's, and the orb going away ends it. Foreground-only v1:
  // nothing survives the component (docs/33 "分期").
  // The silent bench starts and stops the call the page would (docs/platform/560).
  useEffect(() => (import.meta.env.DEV ? registerVoiceCallHost({ start, stop }) : undefined), [start, stop]);

  useEffect(() => {
    return () => {
      const call = drop();
      void call?.stop().catch(() => {});
    };
  }, [drop]);

  return { phase, error, start, stop, subscribeLevel, subscribeEnvelope, attention, card, dismissCard };
}

/**
 * The call as the body reads it. The body takes an error as a key into its own
 * lines (interrupted, lost) or as a sentence to show as-is; the call reports a
 * reason and a sentence, so the reason goes first where there is a line for it.
 */
export function voiceCallHandle(call: VoiceCallView): VoiceCallHandle {
  const error = call.error
    ? call.error.reason === "interrupted" || call.error.reason === "lost"
      ? call.error.reason
      : call.error.message
    : null;
  return {
    phase: call.phase,
    start: call.start,
    stop: call.stop,
    error,
    subscribeLevel: call.subscribeLevel,
    subscribeEnvelope: call.subscribeEnvelope,
  };
}
