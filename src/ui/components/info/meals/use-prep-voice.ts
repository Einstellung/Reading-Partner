// The prep's voice while a run is under way (docs/671 时间线与语音): the steps and
// the two front tools laid on whatever call is open, the timer prompts while the
// call is open, the screen kept on for the call, and the start or resume of the
// call from a tap. Everything that decides is in info/meals/prep-voice.ts; the
// call itself is the corner's (soul/voice/live/call-host.ts).

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { createMealsPrepCall, putMealsPrepCard } from "../../../../info/briefer/meals-call";
import type { PrepRun } from "../../../../info/meals/plan/types";
import type { PrepProgressPorts } from "../../../../info/meals/prep-progress";
import { recordPrepSessionEvent, type PrepSteps, type PrepVoiceStart } from "../../../../info/meals/prep-session";
import {
  buildPrepFrontTools,
  createDuePrompter,
  prepCallPlace,
  prepFinished,
  prepInput,
  prepVoiceState,
  type PrepVoiceState,
  type PrepVoiceTimeline,
} from "../../../../info/meals/prep-voice";
import { timelineView } from "../../../../info/meals/timeline/view";
import { hasNativeSpeech } from "../../../../platform/app/platform";
import { subscribeVoiceCapability } from "../../../../platform/app/voice-capability";
import { heldScreenWakeLock } from "../../../../platform/app/wake-lock";
import { attachToCall, callIsOpen, requestCall, sayInCall, subscribeCall } from "../../../../soul/voice/live/call-host";

export interface PrepVoiceOptions {
  /** The session's stored steps, or null before they are read. */
  steps: PrepSteps | null;
  /** The run following those steps, or null before the start. */
  run: PrepRun | null;
  /** The prep was marked done: the voice lets go. */
  done: boolean;
  ports: () => PrepProgressPorts;
  clock?: () => number;
}

export interface PrepVoice {
  /** off: no voice on this device; idle: no call open; in-call. */
  state: PrepVoiceState;
  /** Open the prep's call from a tap, or join the one already open. */
  request: () => PrepVoiceStart;
}

const systemClock = () => Date.now();
const setTimer = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export function usePrepVoice(opts: PrepVoiceOptions): PrepVoice {
  const { steps, run, done } = opts;
  const clock = opts.clock ?? systemClock;
  const speaks = useSyncExternalStore(subscribeVoiceCapability, hasNativeSpeech);
  const open = useSyncExternalStore(subscribeCall, callIsOpen);

  const timeline: PrepVoiceTimeline | null = useMemo(
    () => (steps && run && !done ? { ...steps, run } : null),
    [steps, run, done],
  );
  const active = timeline !== null && !prepFinished(timelineView(prepInput(timeline, clock())));
  // Read by the tools and the prompts at the moment they run. An event the
  // front records moves it at once, ahead of the plan's reload.
  const latest = useRef<PrepVoiceTimeline | null>(null);
  latest.current = active ? timeline : null;
  const portsRef = useRef(opts.ports);
  portsRef.current = opts.ports;

  useEffect(() => {
    if (!active) return;
    const read = () => latest.current;
    const tools = buildPrepFrontTools({
      timeline: read,
      now: clock,
      say: sayInCall,
      record: async (event) => {
        const now = latest.current;
        if (!now) return null;
        const out = await recordPrepSessionEvent({ ports: portsRef.current(), putCard: (c) => putMealsPrepCard(c) }, now, event);
        if (out?.applied && latest.current) latest.current = { ...latest.current, run: out.run };
        return out;
      },
    });
    return attachToCall({
      place: () => {
        const now = read();
        return now ? prepCallPlace(timelineView(prepInput(now, clock()))) : null;
      },
      tools: () => (read() ? tools : []),
    });
  }, [active, clock]);

  // Due prompts only while a call is open; after a hang-up the run goes on silently.
  useEffect(() => {
    if (!active || !open) return;
    const prompter = createDuePrompter({ timeline: () => latest.current, say: sayInCall, now: clock, setTimer });
    prompter.start();
    return () => prompter.stop();
  }, [active, open, clock]);

  // The screen stays on for the call, on the same lock the run's page holds.
  const lock = useMemo(() => heldScreenWakeLock("prep-call"), []);
  useEffect(() => lock.set(active && open), [lock, active, open]);
  useEffect(() => () => lock.set(false), [lock]);

  return { state: prepVoiceState(speaks, open), request: requestPrepVoice };
}

/**
 * Open the prep's call on the meals thread, or join the call already open
 * (docs/671). From a tap, so the start rides its gesture; start_prep asks the
 * same way with no gesture to ride.
 */
export function requestPrepVoice(): PrepVoiceStart {
  if (!hasNativeSpeech()) return "none";
  if (callIsOpen()) return "joined";
  return requestCall(createMealsPrepCall) ? "call" : "none";
}
